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

export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/**
 * T-PRD05 — derive the permission card's risk badge from the classification.
 *
 * This is a presentation hint, NOT a security boundary (per ADR-004 the
 * boundary is the human at the confirmation button). It is deliberately a pure
 * mapping off {@link PermissionLevel}, never persisted, so the badge can never
 * be mistaken for an objective severity score:
 *   low → low · requires_diff_approval → medium · requires_approval/denied → high
 */
export function classifyRisk(level: PermissionLevel): RiskLevel {
  switch (level) {
    case 'low':
      return 'low';
    case 'requires_diff_approval':
      return 'medium';
    case 'requires_approval':
    case 'denied':
      return 'high';
  }
}

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
 *
 * IMPORTANT: this deny-list is a convenience *tripwire*, NOT the security
 * boundary. The boundary is the `requires_approval` default plus the human at
 * the confirmation button (Layer 3). A command that slips past these patterns
 * still has to be confirmed by a human. Do not "trust the list" — see
 * `docs/adr/ADR-004-permission-model.md` § "What the deny-list is — and is not
 * (boundary vs. tripwire)" for the known bypass classes.
 */
const HARD_FLOOR_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\/(?!\S)/, // rm -rf /
  /\brm\s+-rf\s+\$HOME\b/,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  /\bgit\s+push\s+-{1,2}force(\b|-)/,
  /\bgit\s+reset\s+--hard\b/,
];

/**
 * Normalize a stringified args blob before hard-floor matching to raise the
 * bar against trivial token-splitting obfuscation (ADR-004 § boundary vs.
 * tripwire). Additive only — the raw blob is matched too, so this never
 * weakens an existing match, it only catches a few more obvious dodges:
 *
 *   `rm${IFS}-rf${IFS}/`  → `rm -rf /`
 *   `git push --fo''rce`   → `git push --force`
 *
 * Not exhaustive by design: alternate spellings, equivalent tools, and
 * unlisted commands still fall through to the human-approval boundary.
 */
export function normalizeArgsBlob(blob: string): string {
  return blob
    .replace(/\\(["'`])/g, '$1') // unescape JSON-escaped quotes
    .replace(/\$\{?IFS\}?/g, ' ') // $IFS / ${IFS} word-splitting trick → space
    .replace(/['"`]/g, '') // drop quotes used to break up tokens
    .replace(/\\\r?\n/g, ' ') // shell line-continuation → space
    .replace(/\s+/g, ' ') // collapse runs of whitespace
    .trim();
}

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

// Factory, NOT a shared const: `grantAlways` mutates `this.file.always` in
// place, so a single shared object would leak grants across every gate
// instance that started from it (a real cross-instance leak for an in-memory
// gate). Each caller gets its own fresh array.
function emptyFile(): PermissionFile {
  return { version: 1, always: [] };
}

export interface GateOptions {
  /** File path for "always" persistence; absent → in-memory only. */
  filePath?: string;
  /** Override the default classifications (used in tests). */
  classifications?: Record<string, ToolClassification>;
  /** Inject hard-floor patterns; defaults to the ADR-004 set. */
  hardFloorPatterns?: RegExp[];
}

export class PermissionGate {
  private file: PermissionFile = emptyFile();
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
  async evaluate(
    request: PermissionRequest,
  ): Promise<
    | { result: 'allow'; reason: 'low' | 'always_granted' }
    | { result: 'block'; reason: 'hard_floor'; matched: string }
    | { result: 'ask'; level: 'requires_diff_approval' | 'requires_approval' }
  > {
    const argsBlob = `${request.tool} ${JSON.stringify(request.args)}`;
    const normalizedBlob = normalizeArgsBlob(argsBlob);
    for (const pattern of this.hardFloorPatterns) {
      // Match the raw blob (preserves every existing match) AND a normalized
      // variant that defeats trivial token-splitting obfuscation. The regex
      // set carries no `g` flag, so `.test` stays stateless across both calls.
      if (pattern.test(argsBlob) || pattern.test(normalizedBlob)) {
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
    const granted = this.file.always.find(
      (r) => r.tool === request.tool && (!r.scope || r.scope === scope),
    );
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
      this.file = emptyFile();
      return;
    }
    const parsed = PermissionFileSchema.safeParse(JSON.parse(raw));
    this.file = parsed.success ? parsed.data : emptyFile();
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
