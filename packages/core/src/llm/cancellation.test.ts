import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CancellationToken } from './cancellation.js';

describe('CancellationToken', () => {
  it('flips signal.aborted after requestCancel', async () => {
    const token = new CancellationToken();
    expect(token.signal.aborted).toBe(false);
    await token.requestCancel();
    expect(token.signal.aborted).toBe(true);
    expect(token.isCancelled).toBe(true);
  });

  it('idempotent on repeated requestCancel', async () => {
    const token = new CancellationToken();
    await token.requestCancel();
    await token.requestCancel();
    expect(token.signal.aborted).toBe(true);
  });

  it('SIGTERMs registered children on cancel', async () => {
    const token = new CancellationToken({ gracePeriodMs: 100 });
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)']);
    token.registerChild(child);
    const start = Date.now();
    await token.requestCancel();
    const elapsed = Date.now() - start;
    expect(child.killed || child.exitCode !== null).toBe(true);
    expect(elapsed).toBeLessThan(4000);
  });

  it('SIGKILLs a SIGTERM-resistant child within the grace period', async () => {
    const token = new CancellationToken({ gracePeriodMs: 200 });
    const child = spawn(process.execPath, [
      '-e',
      'process.on("SIGTERM",()=>{}); setInterval(()=>{}, 1000)',
    ]);
    token.registerChild(child);
    const start = Date.now();
    await token.requestCancel();
    // Wait a tick for the SIGKILL timer + exit event to land
    await new Promise<void>((r) => {
      if (child.exitCode !== null || child.killed) r();
      else child.once('exit', () => r());
    });
    const elapsed = Date.now() - start;
    expect(child.exitCode !== null || child.killed).toBe(true);
    expect(elapsed).toBeLessThan(4000);
  });

  it('immediately kills children registered post-cancel', async () => {
    const token = new CancellationToken({ gracePeriodMs: 100 });
    await token.requestCancel();
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)']);
    token.registerChild(child);
    await new Promise<void>((r) => {
      if (child.exitCode !== null || child.killed) r();
      else child.once('exit', () => r());
    });
    expect(child.exitCode !== null || child.killed).toBe(true);
  });
});
