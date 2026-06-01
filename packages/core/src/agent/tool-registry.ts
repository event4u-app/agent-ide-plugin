import type { CodeSuggestionAnnotation, ToolDefinition, ToolReview } from '@event4u-agent/protocol';
import { makeReadTools, type ToolHandler } from '../tools/read-tools.js';
import {
  RunShellArgsSchema,
  RunShellTool,
  runShellToolDefinition,
  type RunShellResult,
} from '../tools/run-shell.js';
import {
  WriteFilesArgsSchema,
  WriteFilesTool,
  writeFilesToolDefinition,
  type WriteFilesArgs,
  type WriteFilesPlan,
} from '../tools/write-files.js';
import {
  validateEdit,
  type Diagnostic,
  type DiagnosticProvider,
  type SyntaxIssue,
} from '../tools/validate-edit.js';
import type { LanguageRegistry } from '../context/languages.js';
import type { TerminalSessionManager } from '../terminal/manager.js';
import { buildCodeSuggestions } from './suggestions.js';

/**
 * Tool registry for the agentic chat turn (AI council 2026-06-01, fork 3A).
 *
 * The {@link AgentTurnHandler} loop is tool-agnostic: it asks the registry for
 * the tool definitions to advertise to the model, then for each tool-call it
 * `prepare`s the call (parsing args, computing an optional approval-review diff)
 * and gets back an `execute` thunk. Splitting prepare / execute is what lets a
 * `write_files` diff render at approval time and the write happen only after the
 * user approves — the prepared `WriteFilesPlan` is captured in the closure.
 *
 * Every tool is injectable so the loop is unit-testable with a fake registry;
 * {@link buildDefaultToolRegistry} wires the shipped read tools + `write_files`
 * for the production sidecar.
 */

const PREVIEW_LIMIT = 200;

/** The outcome of executing a prepared tool-call. */
export interface ToolExecution {
  ok: boolean;
  /** Structured output fed back to the model as a `tool_result`. */
  output: unknown;
  /** Truncated, human-readable preview for the result card. */
  outputPreview: string;
  /** Workspace-relative paths this call wrote, if any (first-seen order). */
  changedFiles?: string[];
}

/** A tool-call that has been parsed + planned and is ready to run. */
export interface PreparedTool {
  /** Optional approval-review payload (e.g. a multi-file diff) shown before exec. */
  review?: ToolReview;
  /**
   * Optional durable `code-suggestion` annotations for the edits this call
   * proposes, in `edits` order (built from the resolved plan at prepare time).
   * The {@link AgentTurnHandler} namespaces the ids per call, drives them to a
   * terminal state from the execution outcome, and folds them onto the turn
   * response. Read-only tools leave it unset.
   */
  suggestions?: CodeSuggestionAnnotation[];
  /** Execute the prepared work. Receives the turn's abort signal. */
  execute(signal?: AbortSignal): Promise<ToolExecution>;
}

/** A tool the agent can call: its wire definition + a prepare step. */
export interface RegisteredTool {
  definition: ToolDefinition;
  /**
   * Whether this tool writes to the workspace. Read tools are `false`; the
   * `write_files` editor is `true`. The {@link AgentTurnHandler} reads this
   * (NOT a hard-coded tool name — AI council 2026-06-03 fork C1) to both filter
   * mutating tools out of the advertised set AND refuse a mutating call at
   * runtime when the resolved mode is read-only. A future mutating tool (e.g.
   * `run_shell`) is gated automatically by setting `mutates: true`.
   */
  mutates: boolean;
  /**
   * Parse `input`, compute the optional review payload, and return a thunk that
   * runs the work. May throw on invalid input — the loop turns a throw into an
   * `is_error` tool_result so the model can correct itself.
   */
  prepare(input: unknown): Promise<PreparedTool>;
}

/** Filter for {@link ToolRegistry.definitions}. */
export interface DefinitionsFilter {
  /** When `false`, mutating tools are excluded; omitted/`true` = all tools. */
  mutating?: boolean;
}

export interface ToolRegistry {
  /**
   * Tool definitions advertised to the model. With `{ mutating: false }` the
   * mutating tools are omitted (read-only modes — the model never sees an
   * editor to call); omitted filter = every tool.
   */
  definitions(filter?: DefinitionsFilter): ToolDefinition[];
  /** Look up a tool by name; `undefined` for an unknown tool. */
  get(name: string): RegisteredTool | undefined;
}

/** A registry backed by a fixed list of tools, keyed by `definition.name`. */
export class MapToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(tools: RegisteredTool[]) {
    for (const tool of tools) this.tools.set(tool.definition.name, tool);
  }

  definitions(filter?: DefinitionsFilter): ToolDefinition[] {
    const includeMutating = filter?.mutating ?? true;
    return [...this.tools.values()]
      .filter((tool) => includeMutating || !tool.mutates)
      .map((tool) => tool.definition);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }
}

export interface BuildToolRegistryOptions {
  /** Absolute path every tool resolves inputs against. */
  workspaceRoot: string;
  /** Override the filesystem walk for the read tools (unit tests). */
  walk?: (dir: string) => Promise<string[]>;
  /**
   * Shared terminal session manager. When provided, the mutating `run_shell`
   * tool is registered and spawns into THIS manager — the same one the
   * `terminalSubscribe` handler reads, so a chat-spawned command streams into
   * the IDE terminal panel end-to-end (AI council 2026-06-01 fork A1). Omitted
   * (e.g. unit tests that do not exercise shell) ⇒ no `run_shell` tool.
   */
  terminalManager?: TerminalSessionManager;
  /**
   * Optional tree-sitter registry enabling the SYNTAX layer of the post-write
   * delta-gate (T-702b, AI council 2026-06-01 fork F1). Omitted (unit tests) ⇒
   * the syntax check is skipped; the leftover-marker layer still runs.
   */
  languageRegistry?: LanguageRegistry;
  /**
   * Optional diagnostics source (tsc/eslint, IDE-supplied) enabling the
   * newly-introduced-diagnostics layer of the delta-gate (fork D1). Absent in
   * the pure sidecar (no native deps, no shelling out) ⇒ that layer is skipped;
   * the IDE wires a real provider later.
   */
  diagnostics?: DiagnosticProvider;
}

/**
 * The production tool set: the four read tools (`read_file`, `list_dir`,
 * `glob`, `grep` — gate level `low`, auto-allowed), the `write_files` editor
 * and the `run_shell` command runner (both gate level `requires_approval`,
 * gated through the approval flow). `run_shell` is registered only when a
 * shared terminal manager is supplied.
 */
export function buildDefaultToolRegistry(opts: BuildToolRegistryOptions): ToolRegistry {
  const read = makeReadTools({
    workspaceRoot: opts.workspaceRoot,
    ...(opts.walk ? { walk: opts.walk } : {}),
  });
  const tools: RegisteredTool[] = [
    readToolEntry(read.read_file),
    readToolEntry(read.list_dir),
    readToolEntry(read.glob),
    readToolEntry(read.grep),
    writeFilesEntry({
      workspaceRoot: opts.workspaceRoot,
      ...(opts.languageRegistry ? { languageRegistry: opts.languageRegistry } : {}),
      ...(opts.diagnostics ? { diagnostics: opts.diagnostics } : {}),
    }),
  ];
  if (opts.terminalManager) {
    tools.push(runShellEntry(opts.workspaceRoot, opts.terminalManager));
  }
  return new MapToolRegistry(tools);
}

/** Wrap a read-only {@link ToolHandler} (string output) as a registry entry. */
function readToolEntry<A>(handler: ToolHandler<A, string>): RegisteredTool {
  return {
    definition: handler.definition,
    mutates: false,
    async prepare(input: unknown): Promise<PreparedTool> {
      const args = handler.args.parse(input);
      return {
        async execute(): Promise<ToolExecution> {
          try {
            const output = await handler.run(args);
            return { ok: true, output, outputPreview: truncate(output) };
          } catch (err) {
            const message = errorMessage(err);
            return { ok: false, output: message, outputPreview: truncate(message) };
          }
        },
      };
    },
  };
}

interface WriteFilesEntryOptions {
  workspaceRoot: string;
  languageRegistry?: LanguageRegistry;
  diagnostics?: DiagnosticProvider;
}

/** Wrap the multi-file `write_files` tool as a registry entry. */
function writeFilesEntry(opts: WriteFilesEntryOptions): RegisteredTool {
  const { workspaceRoot, languageRegistry, diagnostics } = opts;
  return {
    definition: writeFilesToolDefinition,
    mutates: true,
    async prepare(input: unknown): Promise<PreparedTool> {
      const args = WriteFilesArgsSchema.parse(input);
      const tool = new WriteFilesTool(workspaceRoot);
      const plan = await tool.propose(args);
      // The model-generated replacement text per resolved file — the
      // leftover-marker scan runs on what the model WROTE, never on pre-existing
      // file content (AI council 2026-06-01 fork C1; append-mode safe).
      const generated = generatedCodeByFile(args, plan);
      // Delta-gate baseline (T-702b, fork G): capture diagnostics BEFORE the
      // write, only when a provider is injected (IDE-supplied; the pure sidecar
      // has none ⇒ the diff layer reports nothing — fork D1).
      const baseline = diagnostics
        ? await diagnostics.diagnostics(plan.files.map((file) => file.path))
        : [];
      return {
        review: { kind: 'diff', files: plan.files.map(toReviewFile) },
        suggestions: buildCodeSuggestions(plan),
        async execute(): Promise<ToolExecution> {
          // `apply` is atomic: an unresolved edit refuses the whole batch and
          // writes nothing, so `changedFiles`/`applied` reflect actual writes.
          const result = await tool.apply(plan);
          const unresolved = unresolvedEdits(plan);
          if (!result.ok) {
            const output = { applied: [], unresolved, error: result.error };
            return {
              ok: false,
              output,
              outputPreview: truncate(JSON.stringify(output)),
              changedFiles: [],
            };
          }
          const applied = plan.files.map((file) => file.path);
          // Post-write delta-gate (fork A1): the atomic write SUCCEEDED, so the
          // validation is advisory feedback folded into the tool_result for the
          // model to self-correct next iteration — it never flips `ok` (fork B1)
          // and never rolls the write back.
          const validation = await validatePlan({
            plan,
            generated,
            baseline,
            ...(languageRegistry ? { languageRegistry } : {}),
            ...(diagnostics ? { diagnostics } : {}),
          });
          const output = { applied, unresolved, ...(validation ? { validation } : {}) };
          return {
            ok: true,
            output,
            outputPreview: truncate(writeFilesPreview(applied, validation)),
            changedFiles: applied,
          };
        },
      };
    },
  };
}

/** Newly-introduced issues for one edited file (T-702b, `ok`/file aside). */
interface FileValidation {
  file: string;
  newDiagnostics: Diagnostic[];
  syntax?: SyntaxIssue;
  leftover?: string;
}

interface ValidatePlanInput {
  plan: WriteFilesPlan;
  generated: Map<string, string>;
  baseline: Diagnostic[];
  languageRegistry?: LanguageRegistry;
  diagnostics?: DiagnosticProvider;
}

/**
 * Run the T-702b delta-gate per applied file and return ONLY the files with
 * issues (per-file paths preserved so the model knows where to fix — council
 * multi-file trap), or `undefined` when every file is clean.
 */
async function validatePlan(input: ValidatePlanInput): Promise<FileValidation[] | undefined> {
  const { plan, generated, baseline, languageRegistry, diagnostics } = input;
  const after = diagnostics
    ? await diagnostics.diagnostics(plan.files.map((file) => file.path))
    : [];
  const problems: FileValidation[] = [];
  for (const file of plan.files) {
    const result = await validateEdit(
      {
        file: file.path,
        // Fall back to full content for a file with no resolved generated block
        // (should not happen for a planned file, but keeps the scan total).
        newCode: generated.get(file.path) ?? file.newContent,
        newContent: file.newContent,
        baseline: baseline.filter((d) => d.file === file.path),
        after: after.filter((d) => d.file === file.path),
      },
      languageRegistry,
    );
    if (!result.ok) {
      problems.push({
        file: file.path,
        newDiagnostics: result.newDiagnostics,
        ...(result.syntax ? { syntax: result.syntax } : {}),
        ...(result.leftover ? { leftover: result.leftover } : {}),
      });
    }
  }
  return problems.length > 0 ? problems : undefined;
}

/** Concatenate the resolved edits' `newCode` per file (fork C1 leftover input). */
function generatedCodeByFile(args: WriteFilesArgs, plan: WriteFilesPlan): Map<string, string> {
  const byFile = new Map<string, string>();
  for (const edit of plan.edits) {
    if (edit.status !== 'resolved') continue;
    const code = args.edits[edit.index]?.newCode ?? '';
    const prior = byFile.get(edit.file);
    byFile.set(edit.file, prior === undefined ? code : `${prior}\n${code}`);
  }
  return byFile;
}

/** A compact preview line that names the validation issues, if any. */
function writeFilesPreview(applied: string[], validation?: FileValidation[]): string {
  const base = JSON.stringify({ applied });
  if (!validation) return base;
  const summary = validation
    .map((v) => {
      const parts: string[] = [];
      if (v.leftover) parts.push('leftover marker');
      if (v.syntax) parts.push('syntax error');
      if (v.newDiagnostics.length > 0) parts.push(`${v.newDiagnostics.length} new diagnostic(s)`);
      return `${v.file}: ${parts.join(', ')}`;
    })
    .join('; ');
  return `${base} · validation issues — ${summary}`;
}

/**
 * Wrap the `run_shell` command runner as a registry entry. `mutates: true`
 * routes it through approval and filters it out of read-only agent modes; the
 * approval card shows the command via the default `argsPreview` (a structured
 * shell-review payload is the deferred IDE-render follow-up, see ADR-030).
 */
function runShellEntry(workspaceRoot: string, manager: TerminalSessionManager): RegisteredTool {
  return {
    definition: runShellToolDefinition,
    mutates: true,
    async prepare(input: unknown): Promise<PreparedTool> {
      const args = RunShellArgsSchema.parse(input);
      const tool = new RunShellTool({ manager, workspaceRoot });
      return {
        async execute(signal?: AbortSignal): Promise<ToolExecution> {
          const result = await tool.run(args, signal);
          const ok = result.status === 'exited' && result.exitCode === 0;
          return { ok, output: result, outputPreview: truncate(runShellPreview(result)) };
        },
      };
    },
  };
}

function runShellPreview(result: RunShellResult): string {
  const head =
    result.status === 'exited'
      ? `exit ${result.exitCode}`
      : result.status === 'error'
        ? `error: ${result.message ?? ''}`
        : result.status;
  return result.outputTail ? `[${head}]\n${result.outputTail}` : `[${head}]`;
}

function toReviewFile(file: WriteFilesPlan['files'][number]): ToolReview['files'][number] {
  return { path: file.path, diff: file.diff, isNewFile: file.isNewFile };
}

/** Edits that did not resolve, so the model can retry them next iteration. */
function unresolvedEdits(
  plan: WriteFilesPlan,
): Array<{ file: string; status: string; message?: string }> {
  return plan.edits
    .filter((edit) => edit.status !== 'resolved' && edit.status !== 'suggestion')
    .map((edit) => ({
      file: edit.file,
      status: edit.status,
      ...(edit.message ? { message: edit.message } : {}),
    }));
}

function truncate(text: string): string {
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
