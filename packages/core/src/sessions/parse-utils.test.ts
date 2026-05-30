import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clampTitle,
  degradedSummary,
  discoverFiles,
  extractText,
  makeSessionId,
  normalizeRole,
  parseJsonlLines,
  stableHash,
  toMillis,
} from './parse-utils.js';

describe('parse-utils', () => {
  describe('toMillis', () => {
    it('passes through epoch ms', () => {
      expect(toMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
    });
    it('upconverts epoch seconds to ms', () => {
      expect(toMillis(1_700_000_000)).toBe(1_700_000_000_000);
    });
    it('parses ISO strings', () => {
      expect(toMillis('2024-05-30T12:00:00.000Z')).toBe(Date.parse('2024-05-30T12:00:00.000Z'));
    });
    it('returns undefined for junk', () => {
      expect(toMillis(undefined)).toBeUndefined();
      expect(toMillis('not a date')).toBeUndefined();
      expect(toMillis(null)).toBeUndefined();
    });
  });

  describe('clampTitle', () => {
    it('collapses whitespace and trims', () => {
      expect(clampTitle('  hello   world \n', 'fb')).toBe('hello world');
    });
    it('falls back when empty', () => {
      expect(clampTitle('   ', 'fallback')).toBe('fallback');
      expect(clampTitle(undefined, 'fallback')).toBe('fallback');
    });
    it('truncates with ellipsis past the cap', () => {
      const long = 'x'.repeat(200);
      const out = clampTitle(long, 'fb');
      expect(out.length).toBe(80);
      expect(out.endsWith('…')).toBe(true);
    });
  });

  describe('normalizeRole', () => {
    it('maps known synonyms', () => {
      expect(normalizeRole('human')).toBe('user');
      expect(normalizeRole('model')).toBe('assistant');
      expect(normalizeRole('AI')).toBe('assistant');
      expect(normalizeRole('tool_result')).toBe('tool');
      expect(normalizeRole('system')).toBe('system');
    });
    it('falls back to unknown', () => {
      expect(normalizeRole(42)).toBe('unknown');
      expect(normalizeRole('weird')).toBe('unknown');
    });
  });

  describe('extractText', () => {
    it('returns plain strings as-is', () => {
      expect(extractText('hi')).toBe('hi');
    });
    it('flattens content-part arrays', () => {
      expect(extractText([{ type: 'text', text: 'a' }, 'b', { content: 'c' }])).toBe('a\nb\nc');
    });
    it('returns empty for unknown shapes', () => {
      expect(extractText(123)).toBe('');
    });
  });

  describe('parseJsonlLines', () => {
    it('parses good lines and counts bad ones', () => {
      const { records, parseErrors } = parseJsonlLines('{"a":1}\n\nnot json\n{"b":2}\n[1,2]');
      expect(records).toEqual([{ a: 1 }, { b: 2 }]);
      expect(parseErrors).toBe(2); // "not json" + the bare array
    });
  });

  describe('stableHash / makeSessionId', () => {
    it('is deterministic and short', () => {
      expect(stableHash('abc')).toBe(stableHash('abc'));
      expect(stableHash('abc')).toHaveLength(12);
    });
    it('builds source-scoped ids', () => {
      expect(makeSessionId('claude-cli', 'uuid')).toBe('claude-cli:uuid');
    });
  });

  describe('discoverFiles', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'event4u-discover-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('finds matching files recursively with stat info', async () => {
      await mkdir(join(dir, 'sub'), { recursive: true });
      await writeFile(join(dir, 'a.jsonl'), 'x');
      await writeFile(join(dir, 'sub', 'b.jsonl'), 'yy');
      await writeFile(join(dir, 'sub', 'c.txt'), 'ignore');
      const found = await discoverFiles(dir, (n) => n.endsWith('.jsonl'));
      expect(found.map((f) => f.path.endsWith('a.jsonl') || f.path.endsWith('b.jsonl'))).toEqual([
        true,
        true,
      ]);
      expect(found.every((f) => f.mtimeMs > 0 && f.sizeBytes >= 1)).toBe(true);
    });

    it('returns [] for a missing root (fail-open)', async () => {
      expect(await discoverFiles(join(dir, 'nope'), () => true)).toEqual([]);
    });
  });

  describe('degradedSummary', () => {
    it('builds an unknown-status summary from stat', () => {
      const s = degradedSummary({
        source: 'gemini-cli',
        provider: 'google',
        file: { path: '/x/y.json', mtimeMs: 200, birthtimeMs: 100, sizeBytes: 5 },
      });
      expect(s.status).toBe('unknown');
      expect(s.origin).toBe('unknown');
      expect(s.startedAt).toBe(100);
      expect(s.lastMessageAt).toBe(200);
      expect(s.id.startsWith('gemini-cli:')).toBe(true);
      expect(s.rawFilePath).toBe('/x/y.json');
    });
  });
});
