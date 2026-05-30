import { createRequire } from 'node:module';
import { extname } from 'node:path';
import Parser from 'web-tree-sitter';

/**
 * T-602 — Tree-sitter grammar registry.
 *
 * Maps file extensions to the prebuilt WASM grammars shipped by
 * `tree-sitter-wasms`, lazily loading and caching one `Parser` per language.
 * web-tree-sitter is pinned to 0.21.x because the `tree-sitter-wasms` grammars
 * are built against that ABI — newer runtimes reject them with a dylink error.
 *
 * Grammar WASM resolution uses `createRequire` so it works from source (tests)
 * today; bundling the `.wasm` files into the packaged sidecar is a packaging
 * concern (T-406), same as `prices.yml`.
 */

const require = createRequire(import.meta.url);

/** Extension → `tree-sitter-wasms` grammar name. Markdown falls back to naive. */
const EXTENSION_GRAMMAR: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.php': 'php',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.go': 'go',
  '.py': 'python',
  '.rs': 'rust',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

/** Grammar name for a file path, or `undefined` when none applies. */
export function grammarForFile(filePath: string): string | undefined {
  return EXTENSION_GRAMMAR[extname(filePath).toLowerCase()];
}

export class LanguageRegistry {
  private initialized = false;
  private readonly parsers = new Map<string, Parser>();
  private readonly failed = new Set<string>();

  /** Idempotent web-tree-sitter runtime init. */
  async init(): Promise<void> {
    if (this.initialized) return;
    await Parser.init();
    this.initialized = true;
  }

  /**
   * Resolve a cached parser for the file's language, loading the grammar on
   * first use. Returns `undefined` for unknown extensions or grammars that fail
   * to load (the caller falls back to the naive line-window chunker).
   */
  async parserForFile(filePath: string): Promise<Parser | undefined> {
    const grammar = grammarForFile(filePath);
    if (!grammar) return undefined;
    return this.parserForGrammar(grammar);
  }

  async parserForGrammar(grammar: string): Promise<Parser | undefined> {
    if (this.failed.has(grammar)) return undefined;
    const cached = this.parsers.get(grammar);
    if (cached) return cached;
    await this.init();
    try {
      const wasmPath = require.resolve(`tree-sitter-wasms/out/tree-sitter-${grammar}.wasm`);
      const language = await Parser.Language.load(wasmPath);
      const parser = new Parser();
      parser.setLanguage(language);
      this.parsers.set(grammar, parser);
      return parser;
    } catch {
      this.failed.add(grammar);
      return undefined;
    }
  }
}
