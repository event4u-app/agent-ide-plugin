import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * T-304 — Permission gate v0.
 *
 * Hard-floor patterns from `docs/adr/ADR-004-permission-model.md` (Phase 0
 * Phase 6) deny destructive commands before the model can run them. Other
 * tools are classified `low` (auto-allow), `requires_diff_approval`
 * (write_file — shown via T-303), and `requires_approval` (everything else).
 *
 * "Always" decisions persist to a JSON file (default
 * `.event4u-agent/permissions.json`). No inline pattern editing in MVP —
 * that's v1.0 Sprint 6.
 */

export const PermissionLevelSchema = z.enum([
  'low',
  'requires_diff_approval',
  'requires_approval',
  'denied',
]);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

export const PermissionDecisionSchema = z.enum(['allow_once', 'always', 'deny']);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

export interface PermissionRequest {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolClassification {
  level: PermissionLevel;
  /** Optional human-readable reason — surfaced to the user on the dialog. */
  reason?: string;
}

/**
 * Hard-floor regex patterns + per-tool classifications. Mirrors the ADR-004
 * model. Patterns match the tool's *args* (stringified for matching) and the
 * tool name itself.
 */
const HARD_FLOOR_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\/(?!\S)/, // rm -rf /
  /\brm\s+-rf\s+\$HOME\b/,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  /\bgit\s+push\s+-{1,2}force(\b|-)/,
  /\bgit\s+reset\s+--hard\b/,
];

const DEFAULT_CLASSIFICATIONS: Record<string, ToolClassification> = {
  read_file: { level: 'low' },
  list_dir: { level: 'low' },
  glob: { level: 'low' },
  grep: { level: 'low' },
  write_file: { level: 'requires_diff_approval' },
  run_command: { level: 'requires_approval' },
};

export interface AlwaysRecord {
  tool: string;
  /** Optional argument scope hash. `undefined` matches every call. */
  scope?: string;
  granted_at: string; // ISO-8601
}

export const AlwaysRecordSchema = z.object({
  tool: z.string(),
  scope: z.string().optional(),
  granted_at: z.string(),
});

export const PermissionFileSchema = z.object({
  version: z.literal(1),
  always: z.array(AlwaysRecordSchema),
});
export type PermissionFile = z.infer<typeof PermissionFileSchema>;

const EMPTY_FILE: PermissionFile = { version: 1, always: [] };

export interface GateOptions {
  /** File path for "always" persistence; absent → in-memory only. */
  filePath?: string;
  /** Override the default classifications (used in tests). */
  classifications?: Record<string, ToolClassification>;
  /** Inject hard-floor patterns; defaults to the ADR-004 set. */
  hardFloorPatterns?: RegExp[];
}

export class PermissionGate {
  private file: PermissionFile = EMPTY_FILE;
  private loaded = false;
  private readonly classifications: Record<string, ToolClassification>;
  private readonly hardFloorPatterns: RegExp[];

  constructor(private readonly opts: GateOptions = {}) {
    this.classifications = opts.classifications ?? DEFAULT_CLASSIFICATIONS;
    this.hardFloorPatterns = opts.hardFloorPatterns ?? HARD_FLOOR_PATTERNS;
  }

  classify(tool: string): ToolClassification {
    return this.classifications[tool] ?? { level: 'requires_approval' };
  }

  /** First-pass check. Returns `'allow'` to proceed, otherwise a level marker. */
  async evaluate(request: PermissionRequest): Promise<
    | { result: 'allow'; reason: 'low' | 'always_granted' }
    | { result: 'block'; reason: 'hard_floor'; matched: string }
    | { result: 'ask'; level: 'requires_diff_approval' | 'requires_approval' }
  > {
    const argsBlob = `${request.tool} ${JSON.stringify(request.args)}`;
    for (const pattern of this.hardFloorPatterns) {
      if (pattern.test(argsBlob)) {
        return { result: 'block', reason: 'hard_floor', matched: pattern.source };
      }
    }
    const cls = this.classify(request.tool);
    if (cls.level === 'denied') {
      return { result: 'block', reason: 'hard_floor', matched: `tool:${request.tool}:denied` };
    }
    if (cls.level === 'low') return { result: 'allow', reason: 'low' };
    await this.load();
    const scope = scopeOf(request);
    const granted = this.file.always.find((r) => r.tool === request.tool && (!r.scope || r.scope === scope));
    if (granted) return { result: 'allow', reason: 'always_granted' };
    return { result: 'ask', level: cls.level };
  }

  /** Record an "always" decision for future identical / scoped calls. */
  async grantAlways(tool: string, scope?: string): Promise<void> {
    await this.load();
    this.file.always.push({ tool, scope, granted_at: new Date().toISOString() });
    await this.persist();
  }

  /** Drop every persisted "always" — used by tests + the user's reset button. */
  async revokeAll(): Promise<void> {
    this.file = { version: 1, always: [] };
    await this.persist();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.opts.filePath) return;
    const raw = await readFile(this.opts.filePath, 'utf8').catch(() => undefined);
    if (raw === undefined) {
      this.file = EMPTY_FILE;
      return;
    }
    const parsed = PermissionFileSchema.safeParse(JSON.parse(raw));
    this.file = parsed.success ? parsed.data : EMPTY_FILE;
  }

  private async persist(): Promise<void> {
    if (!this.opts.filePath) return;
    await writeFile(this.opts.filePath, JSON.stringify(this.file, null, 2), 'utf8');
  }
}

function scopeOf(request: PermissionRequest): string {
  // Simple scope hash: tool name + path argument if present. Deliberately
  // not using crypto here — collisions are not a security issue (the gate
  // already classifies, the scope is just an opt-in narrowing).
  const path = request.args.path ?? request.args.cwd ?? request.args.target;
  return typeof path === 'string' ? path : '*';
}
