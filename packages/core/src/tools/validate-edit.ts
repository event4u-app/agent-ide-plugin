import type Parser from 'web-tree-sitter';
import type { LanguageRegistry } from '../context/languages.js';

/**
 * T-702b — lint/syntax delta-gating.
 *
 * The single highest-leverage validation pattern from SweepAI: never make the
 * model chase diagnostics the file already had. We capture a **baseline** set
 * of diagnostics before an edit, re-run after, and feed back only the
 * *newly-introduced* ones ({@link diffDiagnostics}, a port of
 * `CheckResults.is_worse_than_message`).
 *
 * Three layers, cheapest first:
 *   1. {@link findLeftoverMarkers} — a pure scan of `newCode` for truncated
 *      generations ("…", "rest of code", "TODO: implement").
 *   2. {@link checkSyntax} — a tree-sitter `.hasError` parse; on a parse error
 *      it walks to the deepest error node and returns the span with a caret.
 *   3. {@link diffDiagnostics} — the linter/type-checker delta, with the
 *      {@link DiagnosticProvider} injected so unit tests never shell out.
 *
 * The diagnostic key deliberately **excludes line/column**: an edit that adds
 * or removes lines shifts every diagnostic below it, and keying on line would
 * report all of them as "new". Keying on `source|code|severity|message`
 * (messages are position-free for tsc/eslint) keeps the delta stable under
 * line shift while still catching a genuinely new error.
 */

export interface Diagnostic {
  /** Producer: 'tsc' | 'eslint' | 'tree-sitter' | a project runner id. */
  source: string;
  /** Workspace-relative path. */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column, when known. */
  column?: number;
  /** Rule/error code, e.g. 'TS2304' or 'no-unused-vars'. */
  code?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface DiagnosticProvider {
  /** Diagnostics for the given workspace-relative files in their current state. */
  diagnostics(files: string[]): Promise<Diagnostic[]>;
}

/** Leftover-generation markers that signal a truncated/lazy edit. */
const LEFTOVER_PATTERNS: RegExp[] = [
  /\.\.\.\s*(rest of|existing|previous|the code|unchanged)/i,
  /…\s*(rest of|existing|previous|the code|unchanged)/i,
  /\b(rest of (the )?code)\b/i,
  /\b(unchanged|existing) code (here|below|above)\b/i,
  /\/\/\s*\.\.\.\s*$/m,
  /#\s*\.\.\.\s*$/m,
  /\bTODO:?\s*implement\b/i,
  /\bremaining (code|implementation)\b/i,
];

/** Scan `newCode` for a leftover marker; return the first matched text. */
export function findLeftoverMarkers(newCode: string): string | undefined {
  for (const re of LEFTOVER_PATTERNS) {
    const m = re.exec(newCode);
    if (m) return m[0].trim();
  }
  return undefined;
}

/** Stable key — intentionally line/column-free (see file header). */
export function diagnosticKey(d: Diagnostic): string {
  return [d.source, d.code ?? '', d.severity, normalizeMessage(d.message)].join('|');
}

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

/**
 * Newly-introduced diagnostics: those in `after` whose key occurs more often
 * than in `before`. Returns representative `after` entries (with real lines)
 * for the surplus count per key.
 */
export function diffDiagnostics(before: Diagnostic[], after: Diagnostic[]): Diagnostic[] {
  const beforeCounts = new Map<string, number>();
  for (const d of before)
    beforeCounts.set(diagnosticKey(d), (beforeCounts.get(diagnosticKey(d)) ?? 0) + 1);

  const seen = new Map<string, number>();
  const introduced: Diagnostic[] = [];
  for (const d of after) {
    const key = diagnosticKey(d);
    const used = seen.get(key) ?? 0;
    const allowed = beforeCounts.get(key) ?? 0;
    if (used >= allowed) introduced.push(d);
    seen.set(key, used + 1);
  }
  return introduced;
}

export interface SyntaxIssue extends Diagnostic {
  source: 'tree-sitter';
  /** A two-line excerpt: the offending source line + a caret under the column. */
  caret: string;
}

/**
 * Parse `content` for `file` and, if the tree has an error, return the deepest
 * error/missing node as a {@link SyntaxIssue}. Returns `undefined` when the
 * file has no grammar (caller skips the syntax layer) or parses clean.
 */
export async function checkSyntax(
  registry: LanguageRegistry,
  file: string,
  content: string,
): Promise<SyntaxIssue | undefined> {
  const parser = await registry.parserForFile(file);
  if (!parser) return undefined;
  const tree = parser.parse(content);
  if (!tree) return undefined;
  const root = tree.rootNode;
  if (!root.hasError()) return undefined;

  const errorNode = deepestErrorNode(root) ?? root;
  const line = errorNode.startPosition.row + 1;
  const column = errorNode.startPosition.column + 1;
  return {
    source: 'tree-sitter',
    file,
    line,
    column,
    severity: 'error',
    message: errorNode.isMissing()
      ? `syntax error: missing ${errorNode.type || 'token'}`
      : `syntax error near "${errorNode.type}"`,
    caret: caretExcerpt(content, errorNode.startPosition.row, errorNode.startPosition.column),
  };
}

/** Walk to the deepest ERROR or missing node (pre-order, deepest wins). */
function deepestErrorNode(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  let found: Parser.SyntaxNode | undefined;
  const visit = (n: Parser.SyntaxNode, depth: number, best: { depth: number }): void => {
    const isError = n.type === 'ERROR' || n.isMissing();
    if (isError && depth >= best.depth) {
      found = n;
      best.depth = depth;
    }
    for (const child of n.children) {
      if (child && (child.hasError() || child.type === 'ERROR' || child.isMissing())) {
        visit(child, depth + 1, best);
      }
    }
  };
  visit(node, 0, { depth: -1 });
  return found;
}

/** Build a `source-line` + `   ^` caret excerpt for an error position. */
function caretExcerpt(content: string, row: number, column: number): string {
  const lines = content.split('\n');
  const srcLine = lines[row] ?? '';
  const caret = `${' '.repeat(Math.max(0, column))}^`;
  return `${srcLine}\n${caret}`;
}

export interface EditValidationInput {
  file: string;
  newCode: string;
  /** Full new content of the file (for the syntax parse). */
  newContent: string;
  baseline: Diagnostic[];
  after: Diagnostic[];
}

export interface EditValidationResult {
  ok: boolean;
  /** Newly-introduced linter/type diagnostics. */
  newDiagnostics: Diagnostic[];
  /** Tree-sitter parse error, if any. */
  syntax?: SyntaxIssue;
  /** Leftover-generation marker text, if any. */
  leftover?: string;
}

/**
 * Run the full delta-gate for one edited file. `registry` is optional — pass
 * it to enable the tree-sitter layer; omit it (tests) to skip the parse.
 */
export async function validateEdit(
  input: EditValidationInput,
  registry?: LanguageRegistry,
): Promise<EditValidationResult> {
  const leftover = findLeftoverMarkers(input.newCode);
  const syntax = registry ? await checkSyntax(registry, input.file, input.newContent) : undefined;
  const newDiagnostics = diffDiagnostics(input.baseline, input.after);
  const ok = !leftover && !syntax && newDiagnostics.length === 0;
  return { ok, newDiagnostics, ...(syntax ? { syntax } : {}), ...(leftover ? { leftover } : {}) };
}
