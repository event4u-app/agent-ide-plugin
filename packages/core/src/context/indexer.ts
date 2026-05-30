import type Parser from 'web-tree-sitter';
import { chunkTree, naiveChunker } from './chunk-tree.js';
import type { LanguageRegistry } from './languages.js';
import type { Snippet } from './snippet.js';

/**
 * T-602 — Symbol + chunk indexer. One tree-sitter parse yields two outputs:
 * top-level symbols (for the BM25 name index) and content chunks (for context
 * injection). Files with no grammar fall back to the naive line-window chunker
 * and contribute no symbols.
 */

export interface SymbolEntry {
  name: string;
  kind: string;
  filePath: string;
  /** 0-based start line. */
  startLine: number;
  /** 0-based exclusive end line. */
  endLine: number;
}

export interface IndexedFile {
  filePath: string;
  symbols: SymbolEntry[];
  chunks: Snippet[];
}

/**
 * Declaration node types across the shipped grammars (TS/JS/PHP/Kotlin/Go/
 * Python/Rust). Broad on purpose — recall matters more than precision for the
 * symbol index.
 */
const DECLARATION_TYPES = [
  'function_declaration',
  'function_definition',
  'function_item',
  'method_definition',
  'method_declaration',
  'class_declaration',
  'class_definition',
  'class_specifier',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'enum_item',
  'struct_item',
  'trait_item',
  'impl_item',
  'mod_item',
  'object_declaration',
  'type_declaration',
  'type_spec',
];

export class CodeIndexer {
  constructor(private readonly registry: LanguageRegistry) {}

  async indexFile(filePath: string, content: string): Promise<IndexedFile> {
    const parser = await this.registry.parserForFile(filePath);
    if (!parser) {
      return { filePath, symbols: [], chunks: naiveChunker(filePath, content) };
    }
    const tree = parser.parse(content);
    const root = tree.rootNode;
    const buffer = Buffer.from(content, 'utf8');
    const symbols = extractSymbols(root, filePath, content, buffer);
    const chunks = chunkTree(root, filePath, content);
    return { filePath, symbols, chunks };
  }
}

function extractSymbols(
  root: Parser.SyntaxNode,
  filePath: string,
  content: string,
  buffer: Buffer,
): SymbolEntry[] {
  const nodes = root.descendantsOfType(DECLARATION_TYPES);
  const symbols: SymbolEntry[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const name = symbolName(node, buffer);
    if (!name) continue;
    const startLine = node.startPosition.row;
    const endLine = node.endPosition.row + 1;
    const key = `${name}:${startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    symbols.push({ name, kind: node.type, filePath, startLine, endLine });
  }
  return symbols;
}

function symbolName(node: Parser.SyntaxNode, buffer: Buffer): string | undefined {
  const named = node.childForFieldName('name');
  if (named) return nodeText(named, buffer);
  // Fallback: first identifier-ish child.
  for (const child of node.children) {
    if (/identifier|name/.test(child.type)) return nodeText(child, buffer);
  }
  return undefined;
}

function nodeText(node: Parser.SyntaxNode, buffer: Buffer): string {
  return buffer.subarray(node.startIndex, node.endIndex).toString('utf8');
}
