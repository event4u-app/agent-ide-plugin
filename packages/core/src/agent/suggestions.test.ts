import { describe, expect, it } from 'vitest';
import type { CodeSuggestionAnnotation } from '@event4u-agent/protocol';

import type { PlannedFile, WriteFilesPlan } from '../tools/write-files.js';
import {
  buildCodeSuggestions,
  DIFF_PREVIEW_MAX_CHARS,
  DIFF_PREVIEW_MAX_LINES,
  initialStateForEdit,
  transitionCodeSuggestion,
} from './suggestions.js';

function plannedFile(path: string, diff: string): PlannedFile {
  return {
    path,
    absPath: `/repo/${path}`,
    oldContent: 'a',
    newContent: 'b',
    isNewFile: false,
    diff,
  };
}

function suggestion(overrides: Partial<CodeSuggestionAnnotation> = {}): CodeSuggestionAnnotation {
  return {
    kind: 'code-suggestion',
    suggestionId: 'edit-0',
    filePath: 'src/auth.ts',
    state: 'pending',
    diffPreview: '@@ -1 +1 @@\n-a\n+b',
    ...overrides,
  };
}

describe('initialStateForEdit', () => {
  it('maps located statuses to pending and unresolved to error', () => {
    expect(initialStateForEdit('resolved')).toBe('pending');
    expect(initialStateForEdit('suggestion')).toBe('pending');
    expect(initialStateForEdit('not_found')).toBe('error');
    expect(initialStateForEdit('ambiguous')).toBe('error');
    expect(initialStateForEdit('error')).toBe('error');
  });
});

describe('buildCodeSuggestions', () => {
  it('emits one annotation per edit, in order, with stable ids', () => {
    const plan: WriteFilesPlan = {
      files: [plannedFile('a.ts', 'diffA'), plannedFile('b.ts', 'diffB')],
      edits: [
        { index: 0, file: 'a.ts', status: 'resolved' },
        { index: 1, file: 'b.ts', status: 'resolved' },
      ],
      ok: true,
    };
    const out = buildCodeSuggestions(plan);
    expect(out.map((s) => s.suggestionId)).toEqual(['edit-0', 'edit-1']);
    expect(out.map((s) => s.filePath)).toEqual(['a.ts', 'b.ts']);
    expect(out.every((s) => s.state === 'pending')).toBe(true);
    expect(out[0]!.diffPreview).toBe('diffA');
  });

  it('marks unresolved edits as error with the locate diagnostic and no diff', () => {
    const plan: WriteFilesPlan = {
      files: [],
      edits: [{ index: 0, file: 'missing.ts', status: 'not_found', message: 'block not found' }],
      ok: false,
    };
    const [s] = buildCodeSuggestions(plan);
    expect(s!.state).toBe('error');
    expect(s!.errorMessage).toBe('block not found');
    expect(s!.diffPreview).toBe('');
  });

  it('omits errorMessage entirely for a pending edit', () => {
    const plan: WriteFilesPlan = {
      files: [plannedFile('a.ts', 'd')],
      edits: [{ index: 0, file: 'a.ts', status: 'resolved' }],
      ok: true,
    };
    expect('errorMessage' in buildCodeSuggestions(plan)[0]!).toBe(false);
  });

  it('shares a file diff across multiple edits to that file', () => {
    const plan: WriteFilesPlan = {
      files: [plannedFile('a.ts', 'sharedDiff')],
      edits: [
        { index: 0, file: 'a.ts', status: 'resolved' },
        { index: 1, file: 'a.ts', status: 'resolved' },
      ],
      ok: true,
    };
    const out = buildCodeSuggestions(plan);
    expect(out[0]!.diffPreview).toBe('sharedDiff');
    expect(out[1]!.diffPreview).toBe('sharedDiff');
  });

  it('bounds the diff preview by lines then chars', () => {
    const bigDiff = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const plan: WriteFilesPlan = {
      files: [plannedFile('a.ts', bigDiff)],
      edits: [{ index: 0, file: 'a.ts', status: 'resolved' }],
      ok: true,
    };
    const [byLines] = buildCodeSuggestions(plan, { diffPreviewMaxLines: 5 });
    expect(byLines!.diffPreview.split('\n')).toHaveLength(5);

    const longLine = 'x'.repeat(50);
    const planChars: WriteFilesPlan = {
      files: [plannedFile('a.ts', longLine)],
      edits: [{ index: 0, file: 'a.ts', status: 'resolved' }],
      ok: true,
    };
    const [byChars] = buildCodeSuggestions(planChars, { diffPreviewMaxChars: 10 });
    expect(byChars!.diffPreview).toHaveLength(10);
  });

  it('exposes sane default bounds', () => {
    expect(DIFF_PREVIEW_MAX_LINES).toBeGreaterThan(0);
    expect(DIFF_PREVIEW_MAX_CHARS).toBeGreaterThan(0);
  });
});

describe('transitionCodeSuggestion', () => {
  it('walks the happy path pending -> processing -> done', () => {
    const a = transitionCodeSuggestion(suggestion({ state: 'pending' }), { type: 'start' });
    expect(a).toEqual({ next: suggestion({ state: 'processing' }), changed: true });
    const b = transitionCodeSuggestion(a.next, { type: 'complete' });
    expect(b.next.state).toBe('done');
    expect(b.changed).toBe(true);
  });

  it('fails from pending or processing into error with the reason', () => {
    const fromPending = transitionCodeSuggestion(suggestion({ state: 'pending' }), {
      type: 'fail',
      error: 'apply rejected',
    });
    expect(fromPending.next.state).toBe('error');
    expect(fromPending.next.errorMessage).toBe('apply rejected');
    expect(fromPending.changed).toBe(true);

    const fromProcessing = transitionCodeSuggestion(suggestion({ state: 'processing' }), {
      type: 'fail',
      error: 'io error',
    });
    expect(fromProcessing.next.state).toBe('error');
  });

  it('treats terminal states as immutable no-ops', () => {
    for (const state of ['done', 'error'] as const) {
      const current = suggestion({ state });
      for (const event of [
        { type: 'start' },
        { type: 'complete' },
        { type: 'fail', error: 'x' },
      ] as const) {
        const r = transitionCodeSuggestion(current, event);
        expect(r.changed).toBe(false);
        expect(r.next).toBe(current);
      }
    }
  });

  it('is a no-op on invalid edges (complete from pending, start from processing)', () => {
    const a = transitionCodeSuggestion(suggestion({ state: 'pending' }), { type: 'complete' });
    expect(a.changed).toBe(false);
    expect(a.next.state).toBe('pending');

    const b = transitionCodeSuggestion(suggestion({ state: 'processing' }), { type: 'start' });
    expect(b.changed).toBe(false);
    expect(b.next.state).toBe('processing');
  });

  it('never mutates the input annotation', () => {
    const current = suggestion({ state: 'pending' });
    transitionCodeSuggestion(current, { type: 'start' });
    expect(current.state).toBe('pending');
  });
});
