import { join } from 'node:path';
import { buildDefaultToolRegistry } from './agent/tool-registry.js';
import { AgentTurnHandler } from './agent/turn-handler.js';
import { ChatHandler } from './chat/handler.js';
import { FileConversationStore, type ConversationStore } from './chat/store.js';
import { DailyBudgetTracker, type BudgetRecorder } from './cost/budget.js';
import { CalibrationLog } from './cost/reconcile.js';
import { DefaultCostReporter, type CostReporter } from './cost/report.js';
import { TrackingDb } from './tracking/db.js';
import type { StepRecorder } from './tracking/step-recorder.js';
import { WorkspaceCoordinator } from './context/workspace-coordinator.js';
import { LanguageRegistry } from './context/languages.js';
import { FileGuidelinesStore, type GuidelinesStore } from './guidelines/guidelines.js';
import { GitHandler } from './git/handler.js';
import { ProviderRegistry } from './llm/provider-registry.js';
import { PermissionGate } from './permissions/gate.js';
import type { PricingBook } from './pricing/loader.js';
import { PLUGIN_STATE_DIR } from './sessions/locations.js';
import { TerminalHandler } from './terminal/handler.js';
import { TerminalSessionManager } from './terminal/manager.js';
import { Dispatcher } from './server.js';

/**
 * Composition root for the sidecar (T-PRD17 core wiring).
 *
 * Builds a {@link Dispatcher} wired with a real {@link ChatHandler} so the
 * shipped sidecar answers `chatSend` for any configured provider instead of
 * returning `chat_not_configured`. Extracted from `main.ts` (per AI-council
 * fork 5) so a unit test can construct the exact production wiring with a fake
 * env / registry / store and drive `chatSend` without spawning a process.
 *
 * All edge concerns — `process.env`, the filesystem store path, pricing — are
 * injectable (council trap: keep them outside the pure registry/handler seam).
 */
export interface BuildCoreOptions {
  /** Env for provider resolution; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Workspace root for conversation persistence; defaults to `process.cwd()`. */
  cwd?: string;
  /** Pricing book for real turn cost. Absent → the handler emits a `$0` estimate. */
  pricing?: PricingBook;
  /** Provider registry override (tests). Defaults to one built from `env`. */
  registry?: ProviderRegistry;
  /** Conversation store override (tests). Defaults to a {@link FileConversationStore} under `cwd`. */
  store?: ConversationStore;
  /**
   * Daily-budget config (T-PRD06). When set, a {@link DailyBudgetTracker} is
   * built under `<cwd>/<state>/cost` and injected so the handler records spend
   * and surfaces a budget status. Omitted → no budget behaviour (the production
   * wiring from `.agent-settings.yml`'s `cost` key is an IDE-runtime follow-up,
   * like the pricing book).
   */
  cost?: { dailyBudgetUsd?: number | null; warningThresholdRatio?: number };
  /** Budget recorder override (tests). Takes precedence over `cost`. */
  budget?: BudgetRecorder;
  /**
   * Step-event recorder override (tests). Defaults to a {@link TrackingDb} under
   * `<cwd>/<state>/tracking`; both turn handlers persist one priced step per
   * turn to it (T-408 wiring, ADR-035). Recording no-ops without a pricing book.
   */
  step?: StepRecorder;
  /**
   * Cost reporter override (tests). Defaults to a {@link DefaultCostReporter}
   * over the same tracking trail + pricing book, answering the `costReport`
   * read method (T-707 backend).
   */
  costReporter?: CostReporter;
  /**
   * Calibration-drift log override (tests). Defaults to a {@link CalibrationLog}
   * under the SAME `<cwd>/<state>/tracking` dir as the step trail (T-706 wiring,
   * ADR-036); the chat handler reconciles each turn's real cost against its
   * pre-flight estimate and appends a calibration event on over-threshold drift.
   */
  calibration?: CalibrationLog;
  /**
   * Workspace-guidelines store override (tests). Defaults to a
   * {@link FileGuidelinesStore} at `<cwd>/.event4u-agent` (reads
   * `guidelines.md`). Both turn handlers fold its content into the per-turn
   * system prompt (T-1307).
   */
  guidelines?: GuidelinesStore;
}

/** Top-k context snippets retrieved per chat turn (T-MR13). */
const CONTEXT_TOP_K = 8;

export function buildCoreDispatcher(options: BuildCoreOptions = {}): Dispatcher {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const registry = options.registry ?? new ProviderRegistry({ env });
  const store = options.store ?? new FileConversationStore(join(cwd, PLUGIN_STATE_DIR, 'chats'));
  const guidelines = options.guidelines ?? new FileGuidelinesStore(join(cwd, PLUGIN_STATE_DIR));
  const loadGuidelines = () => guidelines.load();

  const budget =
    options.budget ??
    (options.cost
      ? new DailyBudgetTracker({
          dir: join(cwd, PLUGIN_STATE_DIR, 'cost'),
          dailyBudgetUsd: options.cost.dailyBudgetUsd,
          warningThresholdRatio: options.cost.warningThresholdRatio,
        })
      : undefined);

  // Live step-event tracking (T-408 wiring, ADR-035). One TrackingDb under the
  // plugin state dir feeds BOTH sides of the cost data path: the turn handlers
  // write a priced step per turn (`step`), and the cost reporter reads the same
  // trail to answer `costReport` (the Cost Dashboard backend, T-707). Cheap to
  // construct (no I/O until a read/write); recording no-ops without pricing.
  const tracking = new TrackingDb({ baseDir: join(cwd, PLUGIN_STATE_DIR, 'tracking') });
  const step = options.step ?? tracking;
  const costReporter = options.costReporter ?? new DefaultCostReporter(tracking, options.pricing);
  // Calibration-drift reconciliation (T-706 wiring, ADR-036). Same `tracking`
  // dir as the step trail — both are the Cost Dashboard's append-only backend
  // (T-707). The chat handler reconciles real-vs-estimate at the finalize point;
  // no I/O until an over-threshold turn appends an event.
  const calibration =
    options.calibration ?? new CalibrationLog({ baseDir: join(cwd, PLUGIN_STATE_DIR, 'tracking') });

  // One coordinator instance drives BOTH the dispatcher's workspace lifecycle
  // and the chat handler's scoped retrieval (T-MR13) — they MUST share state so
  // a turn retrieves against the same live index the connect handshake built.
  const coordinator = new WorkspaceCoordinator();

  const chatHandler = new ChatHandler({
    resolveBackend: (providerId) => registry.resolveBackend(providerId),
    resolveModel: (providerId) => registry.resolveModel(providerId),
    store,
    pricing: options.pricing,
    loadGuidelines,
    // Scoped-context retrieval (T-MR13): forward the turn's scope to the shared
    // coordinator, which resolves it against the live enabled roots.
    retrieveContext: (query, scope, signal) =>
      coordinator.retrieveContextSnippets(query, CONTEXT_TOP_K, scope, signal),
    ...(budget ? { budget } : {}),
    step,
    calibration,
  });

  // Git-loop handler — shares the registry; the diff/log are read from the
  // request's `cwd` (default: this composition root's `cwd`).
  const gitHandler = new GitHandler({
    resolveBackend: (providerId) => registry.resolveBackend(providerId),
    resolveModel: (providerId) => registry.resolveModel(providerId),
    defaultCwd: cwd,
  });

  // One terminal session manager, shared between the `run_shell` agent tool
  // (the spawn path) and the `terminalSubscribe` handler (the read path), so a
  // chat-spawned command streams into the IDE terminal panel end-to-end (AI
  // council 2026-06-01 fork A1). The real env-gated `node-pty` factory and the
  // xterm.js renderers stay native-/IDE-gated; with the default Fake terminal
  // the manager holds no real PTYs until a tool starts one.
  const terminalManager = new TerminalSessionManager();

  // Agentic tool-loop turn (chat that edits files). The read tools auto-allow
  // (gate level `low`); `write_files` and `run_shell` require approval. The IDE
  // approval round-trip that drives `decide` is an IDE-runtime follow-up, so
  // until it is wired the default `decide` DENIES every `ask` — the agent can
  // read freely but never writes/runs unattended. The gate persists "always"
  // grants under the plugin state dir, matching the audit/cost stores.
  const agentTurnHandler = new AgentTurnHandler({
    resolveBackend: (providerId) => registry.resolveBackend(providerId),
    resolveModel: (providerId) => registry.resolveModel(providerId),
    store,
    gate: new PermissionGate({ filePath: join(cwd, PLUGIN_STATE_DIR, 'permissions.json') }),
    // The post-write delta-gate (T-702b): a shared fail-soft tree-sitter
    // registry enables the leftover-marker + syntax layers. The richer
    // newly-introduced-diagnostics layer stays unwired until the IDE supplies a
    // `DiagnosticProvider` over the protocol (no tsc/eslint shelling in core).
    registry: buildDefaultToolRegistry({
      workspaceRoot: cwd,
      terminalManager,
      languageRegistry: new LanguageRegistry(),
    }),
    decide: () => Promise.resolve('deny'),
    pricing: options.pricing,
    loadGuidelines,
    // Scoped-context retrieval (T-MR13): same shared-coordinator callback as the
    // chat handler — the agent turn that EDITS files benefits most from grounding.
    retrieveContext: (query, scope, signal) =>
      coordinator.retrieveContextSnippets(query, CONTEXT_TOP_K, scope, signal),
    ...(budget ? { budget } : {}),
    step,
  });

  // Live-terminal handler (T-PRD03) — the read path over the SAME manager the
  // `run_shell` tool spawns into.
  const terminalHandler = new TerminalHandler({ manager: terminalManager });

  // `undefined` keeps the default live onboarding probes (6th ctor arg); the
  // cost reporter is the 7th (ADR-035).
  return new Dispatcher(
    coordinator,
    chatHandler,
    gitHandler,
    agentTurnHandler,
    terminalHandler,
    undefined,
    costReporter,
  );
}
