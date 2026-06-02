import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTurnResponse, Envelope, LlmStreamEvent } from '@event4u-agent/protocol';
import { InMemoryConversationStore } from '../chat/store.js';
import { CalibrationLog, type ReconcileInput } from '../cost/reconcile.js';
import type { LlmBackend } from '../llm/backend.js';
import { PermissionGate } from '../permissions/gate.js';
import { PricingBook } from '../pricing/loader.js';
import { buildDefaultToolRegistry } from './tool-registry.js';
import { AgentTurnHandler } from './turn-handler.js';

/**
 * T-706 wiring — calibration-drift reconciliation into the AGENT turn (ADR-037).
 *
 * Covers the AI-council 2026-06-02 decision (UNANIMOUS Q0=A): the agent turn
 * emits a pre-flight estimate (preview value) and reconciles its aggregated real
 * cost against that estimate at the finalize point, but ONLY when the turn ran
 * exactly one streamed LLM request (`iterations === 1`). A multi-iteration loop
 * is structurally a different cost object (growing input history + per-iteration
 * output) and is NOT a fair test of a single-iteration estimate, so it is
 * skipped — exactly mirroring the ADR-036 A5 skip of a cancelled turn. Drift
 * covers cli shadow cost too (A4); a turn with no estimate is skipped (A6); a
 * reconcile error is fail-open.
 *
 * Pricing has no cache rates → upper bound = inputFull + maxOut(2048)·outRate.
 * With `countInputTokens: 1` the upper bound ≈ $0.0307 → its ×1.5 drift
 * threshold ≈ $0.046; a turn whose output is 100k tokens costs ≈ $1.50 and
 * reliably trips it. The default `{10,5}` usage costs ≈ $0.0001 and stays in
 * range.
 */

const PRICES = `
version: 1
last_updated: '2026-06-02'
currency: USD
models:
  - id: test-model
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
`;

const CLOCK = () => '2026-06-02T12:00:00.000Z';
const DRIFT_USAGE = { input_tokens: 1, output_tokens: 100_000 }; // ≈ $1.50 real

/** A single-iteration backend: text + stop, with an optional input-token counter. */
function singleTurnBackend(opts: {
  usage?: { input_tokens: number; output_tokens: number };
  mode?: 'api' | 'cli';
  countInputTokens?: number | undefined;
}): LlmBackend {
  const usage = opts.usage ?? { input_tokens: 10, output_tokens: 5 };
  const backend: LlmBackend = {
    id: 'fake',
    mode: opts.mode ?? 'api',
    async *stream(): AsyncIterable<LlmStreamEvent> {
      yield { kind: 'text_delta', text: 'hi' };
      yield { kind: 'stop', reason: 'end_turn', usage };
    },
  };
  if (opts.countInputTokens !== undefined) {
    backend.countInputTokens = async () => opts.countInputTokens;
  }
  return backend;
}

/**
 * A TWO-iteration backend: iteration 1 calls `write_files`, iteration 2 ends the
 * turn. Both stops carry `usage` so the aggregated cost can trip drift while the
 * iteration count stays 2 (the case Q0=A skips).
 */
function writeThenDoneBackend(
  input: unknown,
  usage: { input_tokens: number; output_tokens: number },
): LlmBackend {
  const turns: LlmStreamEvent[][] = [
    [
      { kind: 'tool_use_start', id: 'tc1', name: 'write_files' },
      { kind: 'tool_use_input_delta', id: 'tc1', json_delta: JSON.stringify(input) },
      { kind: 'tool_use_end', id: 'tc1', name: 'write_files', input: undefined },
      { kind: 'stop', reason: 'tool_use', usage },
    ],
    [
      { kind: 'text_delta', text: 'Done.' },
      { kind: 'stop', reason: 'end_turn', usage },
    ],
  ];
  let i = 0;
  const backend: LlmBackend = {
    id: 'fake',
    mode: 'api',
    async *stream(): AsyncIterable<LlmStreamEvent> {
      const events = turns[Math.min(i, turns.length - 1)] ?? [];
      i += 1;
      for (const event of events) yield event;
    },
    countInputTokens: async () => 1,
  };
  return backend;
}

/** Spy standing in for CalibrationLog so skip / throw paths are assertable. */
function spyCalibration(opts: { throwOnReconcile?: boolean } = {}): {
  calibration: CalibrationLog;
  calls: ReconcileInput[];
} {
  const calls: ReconcileInput[] = [];
  const fake = {
    async reconcile(input: ReconcileInput) {
      calls.push(input);
      if (opts.throwOnReconcile) throw new Error('disk full');
      return undefined;
    },
  };
  return { calibration: fake as unknown as CalibrationLog, calls };
}

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-calib-ws-'));
}

function buildHandler(
  backend: LlmBackend,
  workspaceRoot: string,
  opts: { calibration?: CalibrationLog; pricing?: boolean } = {},
): AgentTurnHandler {
  return new AgentTurnHandler({
    resolveBackend: () => backend,
    resolveModel: () => 'test-model',
    store: new InMemoryConversationStore(),
    gate: new PermissionGate({}),
    decide: () => Promise.resolve('allow_once'),
    registry: buildDefaultToolRegistry({ workspaceRoot }),
    pricing: opts.pricing === false ? undefined : PricingBook.parse(PRICES),
    ...(opts.calibration ? { calibration: opts.calibration } : {}),
  });
}

describe('AgentTurnHandler — calibration-drift reconciliation (T-706, ADR-037)', () => {
  let dir: string;
  let ws: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-calib-'));
    ws = await tempWorkspace();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(ws, { recursive: true, force: true });
  });

  it('logs a calibration event when a SINGLE-iteration turn overruns the estimate', async () => {
    const log = new CalibrationLog({ baseDir: dir, now: CLOCK });
    const handler = buildHandler(
      singleTurnBackend({ countInputTokens: 1, usage: DRIFT_USAGE }),
      ws,
      { calibration: log },
    );

    const final = await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, () => {});
    const res = final.data as AgentTurnResponse;
    expect(res.iterations).toBe(1);

    const day = await log.readDay('2026-06-02');
    expect(day).toHaveLength(1);
    expect(day[0]!.conversation_id).toBe('c1');
    expect(day[0]!.model).toBe('test-model');
    expect(day[0]!.real_usd).toBeCloseTo(res.cost.totalUsd, 9);
    expect(day[0]!.drift_ratio).toBeGreaterThan(1.5);
  });

  it('writes NO event when a single-iteration turn stays within the estimate', async () => {
    const log = new CalibrationLog({ baseDir: dir, now: CLOCK });
    const handler = buildHandler(singleTurnBackend({ countInputTokens: 1000 }), ws, {
      calibration: log,
    });

    await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, () => {});

    expect(await log.readDay('2026-06-02')).toHaveLength(0);
  });

  it('SKIPS a multi-iteration turn even when aggregated cost would trip drift (Q0=A)', async () => {
    // Two iterations, each with DRIFT_USAGE → aggregated real cost ≈ $3.0, well
    // over threshold. The turn ran 2 streamed requests → NOT a fair test of the
    // single-iteration estimate → reconcile is skipped (no event).
    const spy = spyCalibration();
    const backend = writeThenDoneBackend(
      { edits: [{ file: 'note.txt', originalCode: '', newCode: 'hi\n' }] },
      DRIFT_USAGE,
    );
    const handler = buildHandler(backend, ws, { calibration: spy.calibration });

    const final = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'create note.txt' },
      () => {},
    );
    const res = final.data as AgentTurnResponse;

    expect(res.iterations).toBe(2); // confirms it really was multi-iteration
    expect(res.changedFiles).toEqual(['note.txt']);
    expect(spy.calls).toEqual([]); // multi-iteration → never reconciled
  });

  it('reconciles a CLI shadow single-iteration turn too — drift is accuracy, not billing (A4)', async () => {
    const log = new CalibrationLog({ baseDir: dir, now: CLOCK });
    const handler = buildHandler(
      singleTurnBackend({ mode: 'cli', countInputTokens: 1, usage: DRIFT_USAGE }),
      ws,
      { calibration: log },
    );

    const final = await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, () => {});
    const res = final.data as AgentTurnResponse;
    expect(res.cost.isEstimate).toBe(true); // CLI shadow cost

    const day = await log.readDay('2026-06-02');
    expect(day).toHaveLength(1); // shadow cost still reconciled
    expect(day[0]!.real_usd).toBeCloseTo(res.cost.totalUsd, 9);
  });

  it('skips a turn that produced no pre-flight estimate (A6)', async () => {
    // No countInputTokens → no estimate range, despite a huge real cost.
    const spy = spyCalibration();
    const handler = buildHandler(
      singleTurnBackend({ countInputTokens: undefined, usage: DRIFT_USAGE }),
      ws,
      { calibration: spy.calibration },
    );

    await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, () => {});

    expect(spy.calls).toEqual([]); // no estimate → nothing to reconcile against
  });

  it('fails open when reconcile throws — the turn still completes', async () => {
    const spy = spyCalibration({ throwOnReconcile: true });
    const handler = buildHandler(
      singleTurnBackend({ countInputTokens: 1, usage: DRIFT_USAGE }),
      ws,
      { calibration: spy.calibration },
    );

    const final = await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, () => {});
    const res = final.data as AgentTurnResponse;

    expect(final.messageType).toBe('agentTurn'); // not an error — the turn ran
    expect(res.iterations).toBe(1);
    expect(spy.calls).toHaveLength(1); // reconcile was attempted
  });

  it('emits the pre-flight estimate as an early done:false envelope before the loop', async () => {
    const envs: Envelope[] = [];
    const handler = buildHandler(singleTurnBackend({ countInputTokens: 1 }), ws);

    await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, (e) => envs.push(e));

    const estimateEnv = envs.find(
      (e) => !e.done && (e.data as Record<string, unknown>).estimate !== undefined,
    );
    expect(estimateEnv).toBeDefined();
    expect(estimateEnv!.messageType).toBe('agentTurn');
    const estimate = (estimateEnv!.data as { estimate: { model: string; upperUsd: number } })
      .estimate;
    expect(estimate.model).toBe('test-model');
    expect(estimate.upperUsd).toBeGreaterThan(0);
    // Emitted BEFORE any text token (the preview shows while the turn runs).
    const tokenIdx = envs.findIndex((e) => (e.data as Record<string, unknown>).token !== undefined);
    const estIdx = envs.indexOf(estimateEnv!);
    expect(estIdx).toBeLessThan(tokenIdx);
  });

  it('is a no-op when no calibration log is injected', async () => {
    const handler = buildHandler(
      singleTurnBackend({ countInputTokens: 1, usage: DRIFT_USAGE }),
      ws,
    );
    const final = await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, () => {});
    expect(final.messageType).toBe('agentTurn');
    expect((final.data as AgentTurnResponse).iterations).toBe(1);
  });
});
