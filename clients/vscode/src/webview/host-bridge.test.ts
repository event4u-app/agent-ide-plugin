import { describe, expect, it, vi } from 'vitest';
import {
  createJcefBridge,
  createVsCodeBridge,
  detectHostBridge,
  type HostGlobals,
} from './host-bridge.js';

function fakeWindow(): Window & {
  listeners: Map<string, Set<EventListener>>;
  emit(type: string, event: Event): void;
} {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    listeners,
    addEventListener(type: string, listener: EventListener): void {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type: string, listener: EventListener): void {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string, event: Event): void {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  } as unknown as Window & {
    listeners: Map<string, Set<EventListener>>;
    emit(type: string, event: Event): void;
  };
}

describe('createVsCodeBridge', () => {
  it('posts through the vscode api and relays window messages', () => {
    const postMessage = vi.fn();
    const win = fakeWindow();
    const bridge = createVsCodeBridge({ postMessage }, win);

    bridge.post({ kind: 'send', text: 'hi' });
    expect(postMessage).toHaveBeenCalledWith({ kind: 'send', text: 'hi' });

    const received: unknown[] = [];
    const unsubscribe = bridge.onMessage((m) => received.push(m));
    win.emit('message', { data: { kind: 'snapshot' } } as unknown as Event);
    expect(received).toEqual([{ kind: 'snapshot' }]);

    unsubscribe();
    win.emit('message', { data: { kind: 'snapshot' } } as unknown as Event);
    expect(received).toHaveLength(1);
  });
});

describe('createJcefBridge', () => {
  it('serializes outbound posts to the injected JCEF hook', () => {
    const posts: string[] = [];
    const globals: HostGlobals = { __e4uJcefPost: (json) => posts.push(json) };
    const bridge = createJcefBridge(globals);

    bridge.post({ kind: 'stop' });
    expect(posts).toEqual(['{"kind":"stop"}']);
  });

  it('installs __e4uHostMessage and parses inbound JSON', () => {
    const globals: HostGlobals = { __e4uJcefPost: () => undefined };
    const bridge = createJcefBridge(globals);

    const received: unknown[] = [];
    bridge.onMessage((m) => received.push(m));
    globals.__e4uHostMessage?.('{"kind":"snapshot","snapshot":{"messages":[]}}');
    expect(received).toEqual([{ kind: 'snapshot', snapshot: { messages: [] } }]);
  });

  it('drops malformed inbound JSON instead of throwing', () => {
    const globals: HostGlobals = { __e4uJcefPost: () => undefined };
    const bridge = createJcefBridge(globals);

    const received: unknown[] = [];
    bridge.onMessage((m) => received.push(m));
    expect(() => globals.__e4uHostMessage?.('{not json')).not.toThrow();
    expect(received).toHaveLength(0);
  });

  it('supports unsubscribe', () => {
    const globals: HostGlobals = { __e4uJcefPost: () => undefined };
    const bridge = createJcefBridge(globals);

    const received: unknown[] = [];
    const unsubscribe = bridge.onMessage((m) => received.push(m));
    unsubscribe();
    globals.__e4uHostMessage?.('{"kind":"snapshot"}');
    expect(received).toHaveLength(0);
  });
});

describe('detectHostBridge', () => {
  it('prefers the VS Code api when present', () => {
    const postMessage = vi.fn();
    const globals: HostGlobals = {
      acquireVsCodeApi: () => ({ postMessage }),
      __e4uJcefPost: () => {
        throw new Error('must not be used when vscode api is present');
      },
    };
    const bridge = detectHostBridge(globals, fakeWindow());
    bridge?.post({ kind: 'ready' });
    expect(postMessage).toHaveBeenCalledWith({ kind: 'ready' });
  });

  it('falls back to the JCEF hooks', () => {
    const posts: string[] = [];
    const globals: HostGlobals = { __e4uJcefPost: (json) => posts.push(json) };
    const bridge = detectHostBridge(globals, fakeWindow());
    bridge?.post({ kind: 'ready' });
    expect(posts).toEqual(['{"kind":"ready"}']);
  });

  it('returns null when no host is detected', () => {
    expect(detectHostBridge({}, fakeWindow())).toBeNull();
  });
});
