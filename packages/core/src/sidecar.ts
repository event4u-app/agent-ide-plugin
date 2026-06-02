import { join } from 'node:path';
import { buildDefaultToolRegistry } from './agent/tool-registry.js';
import { AgentTurnHandler } from './agent/turn-handler.js';
import { ChatHandler } from './chat/handler.js';
import { FileConversationStore, type ConversationStore } from './chat/store.js';
import type { LoadRules } from './chat/system-prompt.js';
import { createRulesLoader } from './commands/rules-loader.js';
import { DailyBudgetTracker, type BudgetRecorder } from './cost/budget.js';
import { CalibrationLog } from './cost/reconcile.js';
import { DefaultCostReporter, type CostReporter } from './cost/report.js';
import { CapsEvaluator, type CapsSettings } from './tracking/caps.js';
import { TrackingDb } from './tracking/db.js';
import type { StepRecorder } from './tracking/step-recorder.js';
import { WorkspaceCoordinator } from './context/workspace-coordinator.js';
import { resolveActiveEmbedder, type EmbeddingsConfig } from './context/remote-embedder.js';
import { LanguageRegistry } from './context/languages.js';
import { FileGuidelinesStore, type GuidelinesStore } from './guidelines/guidelines.js';
import { GitHandler } from './git/handler.js';
import { ProviderRegistry } from './llm/provider-registry.js';
import { AuditLog, type AuditRecorder } from './permissions/audit.js';
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
   * Cost-cap settings (T-411a host integration, ADR-041). When set AND a
   * {@link pricing} book is present, a {@link CapsEvaluator} is built over the
   * same tracking trail and injected into both turn handlers so a `block` cap
   * refuses a turn pre-send (`hard_block_above_usd`) and `warn`/`confirm` ride
   * the pre-send estimate event. Read from `.agent-settings.yml :: tracking.caps`
   * by the IDE-runtime wiring. Omitted / no pricing → no cap gate.
   */
  caps?: CapsSettings;
  /** Caps-evaluator override (tests). Takes precedence over `caps`. */
  capsEvaluator?: CapsEvaluator;
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
  /**
   * Always-active RULES loader override (tests). Defaults to a
   * {@link createRulesLoader} that walks the agent-config tree under `<cwd>`
   * once and renders the always-active rules (T-404, ADR-043). Both turn
   * handlers fold its content AHEAD of guidelines into the per-turn system
   * prompt so the agent's rules reach the model.
   */
  loadRules?: LoadRules;
  /**
   * Permission-audit recorder override (tests). Defaults to an {@link AuditLog}
   * under `<cwd>/<state>/audit` (date-rotated `audit-<YYYY-MM-DD>.jsonl`, T-PRD05,
   * ADR-038). Injected into the agent turn so the approval orchestrator records
   * every hard-floor block + user decision (`grant_once` / `grant_always` /
   * `deny_user` / `deny_hard_floor`); writes are fail-open. The chat turn has no
   * approval path, so it gets no recorder. Constructed once per dispatcher.
   */
  audit?: AuditRecorder;
  /**
   * Embeddings config for hybrid context retrieval (T-806 wiring, ADR-044).
   * Read from `.agent-settings.yml :: context.embeddings` by `main.ts`. When it
   * selects a REAL embedder (a keyed `voyage`/`openai`, or `local`), the shared
   * {@link WorkspaceCoordinator}'s {@link ContextEngine} gets it via
   * {@link resolveActiveEmbedder} and the vector half of every turn's hybrid
   * retrieval goes live; `fake` / keyless / absent stays BM25-only. The whole
   * vector subsystem (VectorStore, EmbeddingCache, embed-on-index) shipped
   * tested but no composition root ever built an embedder, so it was dead in
   * production. The `context.embeddings.apiKey` never crosses the protocol wire
   * (it lives only in this in-process embedder) and is never logged.
   */
  embeddings?: EmbeddingsConfig;
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
  // Always-active RULES prepend (T-404 wiring, ADR-043). `walkAgentConfig` +
  // `buildSystemPrompt` shipped tested but no composition root ever walked the
  // config for rules → the agent's always-active rules never reached the model
  // (the direct sibling of the guidelines wiring, ADR-024/PR #36). The loader
  // walks the agent-config tree under `cwd` ONCE and caches (rules are
  // session-static → cache-friendly prefix; AI council 2026-06-02 Q2=A);
  // fail-open. Both handlers fold it ahead of guidelines + context.
  const loadRules = options.loadRules ?? createRulesLoader(cwd);

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

  // Permission-audit trail (T-PRD05 wiring, ADR-038). Constructed ONCE here —
  // its own sibling dir under the plugin state dir (audit is neither cost nor
  // generic tracking; AI council 2026-06-02 Q1=A). The recorder + its four
  // call sites in `runToolCallWithApproval` shipped tested (ADR-014); only this
  // composition root never built one, so the production trail was dead. Writes
  // are fail-open (a torn append must never break a turn); no I/O until the
  // first recorded decision. Injected into the agent turn only (the chat turn
  // has no approval path).
  const audit = options.audit ?? new AuditLog({ dir: join(cwd, PLUGIN_STATE_DIR, 'audit') });

  // Pre-send cost-cap evaluator (T-411a host integration, ADR-041). The
  // evaluator + its review-pipeline consumer shipped tested but no composition
  // root ever built one for the chat/agent send path → the whole cap subsystem
  // was dead. Built only when caps settings AND a pricing book are present
  // (the projection needs `requireModel`); reads the SAME `tracking` trail for
  // the daily-window total. Injected into both turn handlers so a `block` cap
  // refuses a turn pre-send and `warn`/`confirm` ride the estimate event. With
  // no caps configured (the default) the evaluator returns `allow` — inert.
  const capsEvaluator =
    options.capsEvaluator ??
    (options.caps && options.pricing
      ? new CapsEvaluator(options.caps, options.pricing, tracking)
      : undefined);

  // Hybrid-retrieval embedder (T-806 wiring, ADR-044). `resolveActiveEmbedder`
  // returns one ONLY for a real provider (keyed voyage/openai, or local) so a
  // missing/`fake`/keyless config leaves the engine BM25-only — fusing
  // FakeEmbedder hash-vectors into the live RRF is worse than lexical alone (AI
  // council 2026-06-02 Q2=A). Embedding the index is the coordinator's job; the
  // retrieve path fails soft, so a remote 401/network error degrades to lexical.
  const embedder = options.embeddings ? resolveActiveEmbedder(options.embeddings) : undefined;

  // One coordinator instance drives BOTH the dispatcher's workspace lifecycle
  // and the chat handler's scoped retrieval (T-MR13) — they MUST share state so
  // a turn retrieves against the same live index the connect handshake built.
  // With a real embedder the cache persists under `<state>/embeddings` so a
  // cold start does not re-pay the embed cost for unchanged code (T-805
  // persistence, ADR-047); no embedder ⇒ no vector path ⇒ nothing to persist.
  const coordinator = new WorkspaceCoordinator(
    embedder ? { embedder, embeddingCacheDir: join(cwd, PLUGIN_STATE_DIR, 'embeddings') } : {},
  );

  const chatHandler = new ChatHandler({
    resolveBackend: (providerId) => registry.resolveBackend(providerId),
    resolveModel: (providerId) => registry.resolveModel(providerId),
    store,
    pricing: options.pricing,
    loadGuidelines,
    loadRules,
    // Scoped-context retrieval (T-MR13): forward the turn's scope to the shared
    // coordinator, which resolves it against the live enabled roots.
    retrieveContext: (query, scope, signal) =>
      coordinator.retrieveContextSnippets(query, CONTEXT_TOP_K, scope, signal),
    ...(budget ? { budget } : {}),
    step,
    calibration,
    ...(capsEvaluator ? { capsEvaluator } : {}),
  });

  // Git-loop handler — shares the registry; the diff/log are read from the
  // request's `cwd` (default: this composition root's `cwd`).
  const gitHandler = new GitHandler({
    resolveBackend: (providerId) => registry.resolveBackend(providerId),
    resolveModel: (providerId) => registry.resolveModel(providerId),
    defaultCwd: cwd,
    // Share the live cost stack so `gitReviewSummary` records priced
    // `activity:"review"` step events and respects hard caps (T-CR-206). The
    // observer is built only when a pricing book is present (recording no-ops
    // otherwise — the same gate the chat/agent step recorder uses).
    tracking,
    ...(options.pricing ? { pricing: options.pricing } : {}),
    ...(capsEvaluator ? { caps: capsEvaluator } : {}),
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
    loadRules,
    // Scoped-context retrieval (T-MR13): same shared-coordinator callback as the
    // chat handler — the agent turn that EDITS files benefits most from grounding.
    retrieveContext: (query, scope, signal) =>
      coordinator.retrieveContextSnippets(query, CONTEXT_TOP_K, scope, signal),
    ...(budget ? { budget } : {}),
    step,
    // Same calibration log as the chat handler (T-706, ADR-037). The agent turn
    // reconciles only single-iteration turns (council Q0=A) — a multi-iteration
    // loop is not a fair test of a single-iteration pre-flight estimate.
    calibration,
    // Permission-audit recorder (T-PRD05, ADR-038). The approval orchestrator
    // records hard-floor blocks + user decisions; with the default deny-`decide`
    // every denied write/run already produces a `deny_user` / `deny_hard_floor`
    // row, so the trail is live the moment a tool is gated.
    audit,
    // Same cost-cap evaluator as the chat handler (T-411a, ADR-041). The agent
    // turn gates once before the loop on the iteration-1 projection — the bigger
    // spender, so the hard cap matters most here.
    ...(capsEvaluator ? { capsEvaluator } : {}),
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
