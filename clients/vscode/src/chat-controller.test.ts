import { describe, expect, it } from 'vitest';
import type { Envelope } from '@event4u-agent/protocol';
import { ChatController, type WebviewLike } from './chat-controller.js';
import type { AssistantMessage, ChatModelSnapshot } from './webview/chat-model.js';

interface SidecarLike {
  requestStream(
    messageType: string,
    data: unknown,
    onToken: (envelope: Envelope) => void,
  ): Promise<Envelope>;
  request(messageType: string, data: unknown): Promise<Envelope>;
}

function tokenFrame(token: string): Envelope {
  return { messageId: 'm', messageType: 'chatSend', data: { token }, done: false };
}

class CapturingWebview implements WebviewLike {
  readonly snapshots: ChatModelSnapshot[] = [];
  postMessage(message: unknown): void {
    const m = message as { kind: string; snapshot: ChatModelSnapshot };
    if (m.kind === 'snapshot') this.snapshots.push(m.snapshot);
  }
  last(): ChatModelSnapshot {
    return this.snapshots[this.snapshots.length - 1]!;
  }
}

describe('ChatController', () => {
  it('streams tokens then applies the terminal text + cost', async () => {
    let sentData: { providerId?: string; conversationId?: string } = {};
    const sidecar: SidecarLike = {
      requestStream(_type, data, onToken) {
        sentData = data as typeof sentData;
        onToken(tokenFrame('Hel'));
        onToken(tokenFrame('lo'));
        return Promise.resolve({
          messageId: 'm',
          messageType: 'chatSend',
          data: {
            text: 'Hello',
            usage: { inputTokens: 5, outputTokens: 2 },
            cost: { model: 'claude-sonnet-4-6', mode: 'api', totalUsd: 0.01, isEstimate: false },
            cancelled: false,
            stopReason: 'end_turn',
          },
          done: true,
        });
      },
      request: () =>
        Promise.resolve({ messageId: 'c', messageType: 'chatCancel', data: {}, done: true }),
    };
    const web = new CapturingWebview();
    const controller = new ChatController(sidecar, web, true, 'api');

    controller.handle({ kind: 'send', text: 'hi' });
    await Promise.resolve();
    await Promise.resolve();

    expect(sentData.providerId).toBeUndefined(); // API mode → sidecar default
    const final = web.last();
    expect(final.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
    const assistant = final.messages[1] as AssistantMessage;
    expect(assistant.text).toBe('Hello');
    expect(assistant.streaming).toBe(false);
    expect(assistant.costFooter?.usd).toBe(0.01);
    expect(assistant.costFooter?.outputTokens).toBe(2);
    expect(final.streamingSummary).toBeNull();
  });

  it('CLI mode sends providerId claude-cli', async () => {
    let sentData: { providerId?: string } = {};
    const sidecar: SidecarLike = {
      requestStream(_type, data) {
        sentData = data as typeof sentData;
        return Promise.resolve({
          messageId: 'm',
          messageType: 'chatSend',
          data: { text: 'ok' },
          done: true,
        });
      },
      request: () =>
        Promise.resolve({ messageId: 'c', messageType: 'chatCancel', data: {}, done: true }),
    };
    const controller = new ChatController(sidecar, new CapturingWebview(), true, 'api');
    controller.handle({ kind: 'toggle-mode' });
    controller.handle({ kind: 'send', text: 'hi' });
    await Promise.resolve();
    expect(sentData.providerId).toBe('claude-cli');
  });

  it('probes provider availability on ready and pushes a red dot when unavailable', async () => {
    const sidecar: SidecarLike = {
      requestStream: () =>
        Promise.resolve({ messageId: 'm', messageType: 'chatSend', data: {}, done: true }),
      request: () =>
        Promise.resolve({ messageId: 'c', messageType: 'chatCancel', data: {}, done: true }),
    };
    const web = new CapturingWebview();
    const seen: string[] = [];
    const controller = new ChatController(sidecar, web, true, 'cli', (mode) => {
      seen.push(mode);
      return false; // claude binary missing
    });
    controller.handle({ kind: 'ready' });
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(['cli']);
    expect(web.last().providerAvailable).toBe(false);
  });

  it('re-probes for the new mode on toggle', async () => {
    const sidecar: SidecarLike = {
      requestStream: () =>
        Promise.resolve({ messageId: 'm', messageType: 'chatSend', data: {}, done: true }),
      request: () =>
        Promise.resolve({ messageId: 'c', messageType: 'chatCancel', data: {}, done: true }),
    };
    const web = new CapturingWebview();
    // Available only in api mode; toggling to cli must flip the dot red.
    const controller = new ChatController(sidecar, web, true, 'api', (mode) => mode === 'api');
    controller.handle({ kind: 'ready' });
    await Promise.resolve();
    expect(web.last().providerAvailable).toBe(true);
    controller.handle({ kind: 'toggle-mode' });
    await Promise.resolve();
    await Promise.resolve();
    expect(web.last().mode).toBe('cli');
    expect(web.last().providerAvailable).toBe(false);
  });

  it('renders an error terminal as a warning line', async () => {
    const sidecar: SidecarLike = {
      requestStream() {
        return Promise.resolve({
          messageId: 'm',
          messageType: 'error',
          data: { code: 'provider_not_configured', message: 'missing API key' },
          done: true,
        });
      },
      request: () =>
        Promise.resolve({ messageId: 'c', messageType: 'chatCancel', data: {}, done: true }),
    };
    const web = new CapturingWebview();
    const controller = new ChatController(sidecar, web, true, 'api');
    controller.handle({ kind: 'send', text: 'hi' });
    await Promise.resolve();
    const assistant = web.last().messages[1] as AssistantMessage;
    expect(assistant.text).toContain('provider_not_configured');
    expect(assistant.streaming).toBe(false);
  });

  it('stop sends chatCancel for the live turn', async () => {
    const cancels: Array<{ type: string; data: unknown }> = [];
    let resolveStream: (e: Envelope) => void = () => {};
    const sidecar: SidecarLike = {
      requestStream() {
        return new Promise<Envelope>((resolve) => {
          resolveStream = resolve;
        });
      },
      request(type, data) {
        cancels.push({ type, data });
        resolveStream({
          messageId: 'm',
          messageType: 'chatSend',
          data: { text: '', cancelled: true, stopReason: 'cancelled' },
          done: true,
        });
        return Promise.resolve({
          messageId: 'c',
          messageType: 'chatCancel',
          data: { cancelled: true },
          done: true,
        });
      },
    };
    const web = new CapturingWebview();
    const controller = new ChatController(sidecar, web, true, 'api');
    controller.handle({ kind: 'send', text: 'hi' });
    await Promise.resolve();
    expect(web.last().streamingSummary).not.toBeNull(); // streaming in flight

    controller.handle({ kind: 'stop' });
    await Promise.resolve();
    await Promise.resolve();
    expect(cancels).toEqual([{ type: 'chatCancel', data: { conversationId: expect.any(String) } }]);
    expect(web.last().streamingSummary).toBeNull(); // finished
  });
});
