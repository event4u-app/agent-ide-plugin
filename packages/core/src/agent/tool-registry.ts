import type { CodeSuggestionAnnotation, ToolDefinition, ToolReview } from '@event4u-agent/protocol';
import { makeReadTools, type ToolHandler } from '../tools/read-tools.js';
import {
  WriteFilesArgsSchema,
  WriteFilesTool,
  writeFilesToolDefinition,
  type WriteFilesPlan,
} from '../tools/write-files.js';
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
}

/**
 * The production tool set: the four read tools (`read_file`, `list_dir`,
 * `glob`, `grep` — gate level `low`, auto-allowed) and the `write_files`
 * editor (gate level `requires_approval`, gated through the approval flow).
 */
export function buildDefaultToolRegistry(opts: BuildToolRegistryOptions): ToolRegistry {
  const read = makeReadTools({
    workspaceRoot: opts.workspaceRoot,
    ...(opts.walk ? { walk: opts.walk } : {}),
  });
  return new MapToolRegistry([
    readToolEntry(read.read_file),
    readToolEntry(read.list_dir),
    readToolEntry(read.glob),
    readToolEntry(read.grep),
    writeFilesEntry(opts.workspaceRoot),
  ]);
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

/** Wrap the multi-file `write_files` tool as a registry entry. */
function writeFilesEntry(workspaceRoot: string): RegisteredTool {
  return {
    definition: writeFilesToolDefinition,
    mutates: true,
    async prepare(input: unknown): Promise<PreparedTool> {
      const args = WriteFilesArgsSchema.parse(input);
      const tool = new WriteFilesTool(workspaceRoot);
      const plan = await tool.propose(args);
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
          const output = { applied, unresolved };
          return {
            ok: true,
            output,
            outputPreview: truncate(JSON.stringify(output)),
            changedFiles: applied,
          };
        },
      };
    },
  };
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
