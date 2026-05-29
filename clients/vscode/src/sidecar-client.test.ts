import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SidecarClient } from './sidecar-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', '..', '..', 'packages', 'core', 'dist', 'server.js');

// Integration test against the real built sidecar (T-105 RPC hello-world).
// Skips gracefully if the core bundle has not been built yet.
const describeIfBuilt = existsSync(serverPath) ? describe : describe.skip;

describeIfBuilt('SidecarClient against the real sidecar', () => {
  let client: SidecarClient;

  beforeAll(() => {
    client = new SidecarClient(serverPath);
    client.start();
  });

  afterAll(() => {
    client.dispose();
  });

  it('reports healthy on ping (pong)', async () => {
    expect(await client.healthy()).toBe(true);
  });

  it('round-trips an echo request', async () => {
    const res = await client.request('echo', { text: 'from vscode client' });
    expect(res.data).toEqual({ text: 'from vscode client' });
  });

  it('returns an error envelope for an unknown method', async () => {
    const res = await client.request('frobnicate', {});
    expect(res.messageType).toBe('error');
  });
});
