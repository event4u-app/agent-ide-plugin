import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HaltAnswer } from '@event4u-agent/protocol';
import {
  AgentDriver,
  type AgentHaltRequest,
  FileStateStore,
  type HaltGate,
  InMemoryStateStore,
  type PhaseRunners,
} from './loop.js';

/** Records every halt and answers from a scripted queue (by phase). */
class ScriptedGate implements HaltGate {
  readonly seen: AgentHaltRequest[] = [];
  constructor(private readonly answers: Record<string, HaltAnswer>) {}
  async request(halt: AgentHaltRequest): Promise<HaltAnswer> {
    this.seen.push(halt);
    return this.answers[halt.phase] ?? { halt_id: halt.id, option_id: 'proceed' };
  }
}

const runners = (over: Partial<PhaseRunners> = {}): PhaseRunners => ({
  refine: async () => ({ text: 'refined understanding' }),
  plan: async () => ({ text: '1. do a\n2. do b' }),
  implement: async () => ({ text: 'edited 2 files', changedFiles: ['a.ts', 'b.ts'] }),
  verify: async () => ({ ok: true, text: 'all green' }),
  report: async () => ({ text: 'done: changed a.ts, b.ts' }),
  ...over,
});

describe('AgentDriver — happy path', () => {
  it('drives refine→plan→implement→verify→report→done', async () => {
    const gate = new ScriptedGate({});
    const store = new InMemoryStateStore();
    const driver = new AgentDriver({
      conversationId: 'c1',
      runners: runners(),
      gate,
      store,
      now: () => '2026-05-30T00:00:00.000Z',
    });
    const final = await driver.run('add a feature');
    expect(final.done).toBe(true);
    expect(final.phase).toBe('done');
    expect(final.plan).toBe('1. do a\n2. do b');
    expect(final.changedFiles).toEqual(['a.ts', 'b.ts']);
    expect(final.report).toContain('done');
    // Halts only between refine and plan (implement has none, verify passed).
    expect(gate.seen.map((h) => h.phase)).toEqual(['refine', 'plan']);
  });
});

describe('AgentDriver — steering', () => {
  it('re-runs a phase on revise without advancing', async () => {
    const gate = new ScriptedGate({
      refine: { halt_id: 'refine-halt', text: 'no, focus on the API only' },
    });
    const store = new InMemoryStateStore();
    const driver = new AgentDriver({ conversationId: 'c2', runners: runners(), gate, store });
    const initial = {
      conversationId: 'c2',
      phase: 'refine' as const,
      task: 'x',
      history: [],
      changedFiles: [],
      done: false,
      updatedAt: '2026-05-30T00:00:00.000Z',
    };
    const { state, stopped } = await driver.step(initial);
    expect(stopped).toBe(false);
    expect(state.phase).toBe('refine'); // did NOT advance
    // History carries the assistant draft + the user's steer.
    expect(state.history.at(-1)).toEqual({ role: 'user', content: 'no, focus on the API only' });
  });

  it('stops the run when the user picks stop', async () => {
    const gate = new ScriptedGate({ refine: { halt_id: 'refine-halt', option_id: 'stop' } });
    const store = new InMemoryStateStore();
    const driver = new AgentDriver({ conversationId: 'c3', runners: runners(), gate, store });
    const final = await driver.run('do thing');
    expect(final.done).toBe(false);
    expect(final.phase).toBe('refine');
  });

  it('halts on verify failure and routes retry back to implement', async () => {
    let verifyCalls = 0;
    const gate = new ScriptedGate({
      verify: { halt_id: 'verify-halt', option_id: 'retry' },
    });
    const store = new InMemoryStateStore();
    const driver = new AgentDriver({
      conversationId: 'c4',
      runners: runners({
        verify: async () => {
          verifyCalls += 1;
          return verifyCalls === 1 ? { ok: false, text: 'tsc error' } : { ok: true, text: 'green' };
        },
      }),
      gate,
      store,
    });
    const final = await driver.run('fix bug');
    expect(final.done).toBe(true);
    expect(verifyCalls).toBe(2);
    expect(gate.seen.some((h) => h.phase === 'verify')).toBe(true);
  });
});

describe('FileStateStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-state-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a run and resumes from disk', async () => {
    const store = new FileStateStore(join(dir, '.work-state.json'));
    const gate = new ScriptedGate({});
    const driver = new AgentDriver({
      conversationId: 'persist-1',
      runners: runners(),
      gate,
      store,
      now: () => '2026-05-30T00:00:00.000Z',
    });
    const final = await driver.run('persist me');
    expect(final.done).toBe(true);

    const reloaded = await store.load('persist-1');
    expect(reloaded?.report).toContain('done');
    expect(reloaded?.changedFiles).toEqual(['a.ts', 'b.ts']);
  });

  it('does not return a state for a different conversation id', async () => {
    const store = new FileStateStore(join(dir, '.work-state.json'));
    const gate = new ScriptedGate({});
    const driver = new AgentDriver({
      conversationId: 'persist-2',
      runners: runners(),
      gate,
      store,
    });
    await driver.run('x');
    expect(await store.load('other-conversation')).toBeUndefined();
  });
});
