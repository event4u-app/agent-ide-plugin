import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteFilesTool } from '../tools/write-files.js';
import {
  EditLoop,
  type EditLoopAuditEvent,
  type ModelEditStep,
  type PlanValidator,
} from './edit-loop.js';

let root: string;
let writeFiles: WriteFilesTool;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'event4u-editloop-'));
  writeFiles = new WriteFilesTool(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const passValidator: PlanValidator = { validate: async () => ({ ok: true, feedback: '' }) };

/** Model that returns a scripted sequence of proposals, one per attempt. */
function scriptedModel(
  sequence: Array<{ edits: Parameters<WriteFilesTool['propose']>[0]['edits'] }>,
): ModelEditStep {
  let i = 0;
  return {
    async next() {
      const item = sequence[Math.min(i, sequence.length - 1)]!;
      i += 1;
      return { edits: item.edits, text: `attempt ${i}` };
    },
  };
}

describe('EditLoop — applied', () => {
  it('applies a valid edit on the first attempt and truncates history', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;\n');
    const model = scriptedModel([
      { edits: [{ file: 'a.ts', originalCode: 'const x = 1;', newCode: 'const x = 2;' }] },
    ]);
    const loop = new EditLoop({ model, writeFiles, validator: passValidator });
    const res = await loop.run({ file: 'a.ts', instruction: 'bump x' }, [
      { role: 'user', content: 'change x to 2' },
    ]);
    expect(res.status).toBe('applied');
    expect(res.attempts).toBe(1);
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('const x = 2;\n');
    expect(loop.completedChangesPerFile.get('a.ts')).toBe(1);
    // History is truncated to the task anchor + a file-state snapshot.
    expect(res.history).toHaveLength(2);
    expect(res.history[0]).toEqual({ role: 'user', content: 'change x to 2' });
    expect(res.history[1]!.content).toContain('const x = 2;');
  });

  it('retries after a not-found, then succeeds with feedback', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;\n');
    const seen: string[] = [];
    const model: ModelEditStep = {
      async next(input) {
        seen.push(input.feedback ?? 'no-feedback');
        return input.feedback
          ? { edits: [{ file: 'a.ts', originalCode: 'const x = 1;', newCode: 'const x = 9;' }] }
          : { edits: [{ file: 'a.ts', originalCode: 'MISSING', newCode: 'x' }] };
      },
    };
    const loop = new EditLoop({ model, writeFiles, validator: passValidator });
    const res = await loop.run({ file: 'a.ts', instruction: 'set x to 9' }, []);
    expect(res.status).toBe('applied');
    expect(res.attempts).toBe(2);
    expect(seen[0]).toBe('no-feedback');
    expect(seen[1]).toContain('not_found');
  });
});

describe('EditLoop — guards', () => {
  it('escalates after escalateAfter failed attempts', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;\n');
    const events: EditLoopAuditEvent[] = [];
    let escalatedFlag = false;
    // Model that keeps missing, but varies the needle so visitedSet differs.
    let n = 0;
    const model: ModelEditStep = {
      async next() {
        n += 1;
        return { edits: [{ file: 'a.ts', originalCode: `MISSING_${n}`, newCode: 'x' }] };
      },
    };
    const loop = new EditLoop({
      model,
      writeFiles,
      validator: passValidator,
      escalateAfter: 2,
      maxAttempts: 4,
      audit: (e) => void events.push(e),
      onEscalate: () => {
        escalatedFlag = true;
      },
    });
    const res = await loop.run({ file: 'a.ts', instruction: 'x' }, []);
    expect(res.status).toBe('skipped');
    expect(res.escalated).toBe(true);
    expect(escalatedFlag).toBe(true);
    expect(events.some((e) => e.kind === 'escalate')).toBe(true);
    expect(events.some((e) => e.kind === 'give_up')).toBe(true);
  });

  it('detects a repeated identical proposal and gives up after escalating', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;\n');
    const events: EditLoopAuditEvent[] = [];
    // Always proposes the exact same (failing) edit → visitedSet trips.
    const model = scriptedModel([
      { edits: [{ file: 'a.ts', originalCode: 'MISSING', newCode: 'x' }] },
    ]);
    const loop = new EditLoop({
      model,
      writeFiles,
      validator: passValidator,
      audit: (e) => void events.push(e),
    });
    const res = await loop.run({ file: 'a.ts', instruction: 'x' }, []);
    expect(res.status).toBe('skipped');
    expect(res.reason).toContain('repeated');
    expect(events.filter((e) => e.kind === 'repeat').length).toBeGreaterThanOrEqual(1);
  });

  it('skips when validation never passes', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;\n');
    let n = 0;
    const model: ModelEditStep = {
      async next() {
        n += 1;
        return {
          edits: [{ file: 'a.ts', originalCode: 'const x = 1;', newCode: `const x = ${n};` }],
        };
      },
    };
    const failValidator: PlanValidator = {
      validate: async () => ({ ok: false, feedback: 'introduced TS2304' }),
    };
    const loop = new EditLoop({ model, writeFiles, validator: failValidator, maxAttempts: 3 });
    const res = await loop.run({ file: 'a.ts', instruction: 'x' }, []);
    expect(res.status).toBe('skipped');
    expect(res.attempts).toBe(3);
    // The file must be untouched — apply never ran on a failed validation.
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('const x = 1;\n');
  });
});
