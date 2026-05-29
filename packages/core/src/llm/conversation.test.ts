import { describe, expect, it } from 'vitest';
import type { LlmBackend } from './backend.js';
import { ConversationState, resolveDefaultMode } from './conversation.js';

function fakeBackend(id: string, mode: 'api' | 'cli'): LlmBackend {
  return {
    id,
    mode,
    stream: () =>
      (async function* () {
        yield {
          kind: 'stop' as const,
          reason: 'end_turn' as const,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })(),
  };
}

describe('ConversationState', () => {
  it('starts in the requested mode when both backends are present', () => {
    const state = new ConversationState({
      conversationId: 'c',
      initialMode: 'cli',
      backends: { api: fakeBackend('a', 'api'), cli: fakeBackend('c', 'cli') },
    });
    expect(state.getMode()).toBe('cli');
    expect(state.currentBackend().id).toBe('c');
  });

  it('falls back to api when initialMode=cli but cli backend missing', () => {
    const state = new ConversationState({
      conversationId: 'c',
      initialMode: 'cli',
      backends: { api: fakeBackend('a', 'api') },
    });
    expect(state.getMode()).toBe('api');
  });

  it('refuses setMode("cli") when no cli backend', () => {
    const state = new ConversationState({
      conversationId: 'c',
      initialMode: 'api',
      backends: { api: fakeBackend('a', 'api') },
    });
    expect(state.setMode('cli')).toEqual({ ok: false, reason: 'cli backend not available' });
    expect(state.getMode()).toBe('api');
  });

  it('switches to cli when the backend is available', () => {
    const state = new ConversationState({
      conversationId: 'c',
      initialMode: 'api',
      backends: { api: fakeBackend('a', 'api'), cli: fakeBackend('c', 'cli') },
    });
    expect(state.setMode('cli')).toEqual({ ok: true });
    expect(state.currentBackend().id).toBe('c');
  });

  it('appendMessage + getHistory round-trip', () => {
    const state = new ConversationState({
      conversationId: 'c',
      initialMode: 'api',
      backends: { api: fakeBackend('a', 'api') },
    });
    state.appendMessage({ role: 'user', content: 'hi' });
    state.appendMessage({ role: 'assistant', content: 'hello' });
    expect(state.getHistory()).toHaveLength(2);
  });
});

describe('resolveDefaultMode', () => {
  it('respects an explicit api setting regardless of cli availability', () => {
    expect(resolveDefaultMode({ setting: 'api', cliAvailable: true })).toBe('api');
    expect(resolveDefaultMode({ setting: 'api', cliAvailable: false })).toBe('api');
  });

  it('forces cli only when available', () => {
    expect(resolveDefaultMode({ setting: 'cli', cliAvailable: true })).toBe('cli');
    expect(resolveDefaultMode({ setting: 'cli', cliAvailable: false })).toBe('api');
  });

  it('auto follows cli availability', () => {
    expect(resolveDefaultMode({ setting: 'auto', cliAvailable: true })).toBe('cli');
    expect(resolveDefaultMode({ setting: 'auto', cliAvailable: false })).toBe('api');
  });
});
