/**
 * Phase 9 — Live PTY terminal, pure-core barrel (T-901 interface / T-902 / T-905).
 *
 * Exports the Terminal interface + Fake, the dual-capped output ring buffer, the
 * waiting-for-input detection, and the session manager. The real node-pty
 * binding, the xterm.js renderers, and the IDE-terminal bridges stay deferred.
 */
export * from './types.js';
export { stripAnsi } from './ansi.js';
export { OutputRingBuffer, type RingBufferOptions } from './ring-buffer.js';
export { FakeTerminal, fakeTerminalFactory, loadNodePtyTerminal, PTY_ENABLE_ENV } from './pty.js';
export {
  looksLikeInputPrompt,
  INPUT_PROMPT_PATTERNS,
  WaitingForInputTracker,
  type WaitingState,
  type WaitingTrackerOptions,
} from './waiting-input.js';
export {
  TerminalSessionManager,
  type TerminalSession,
  type StartInput,
  type WriteInput,
  type WriteResult,
  type SubscribeInput,
  type SubscribeResult,
  type TerminalManagerOptions,
} from './manager.js';
