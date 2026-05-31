import { describe, expect, it } from 'vitest';
import { stripAnsi } from './ansi.js';
import { looksLikeInputPrompt, WaitingForInputTracker } from './waiting-input.js';

describe('stripAnsi', () => {
  it('removes CSI colour codes', () => {
    expect(stripAnsi('\x1b[32mPassword:\x1b[0m')).toBe('Password:');
  });
  it('leaves plain text untouched', () => {
    expect(stripAnsi('plain text: ')).toBe('plain text: ');
  });
});

describe('looksLikeInputPrompt', () => {
  it.each([
    'Proceed? (y/n) ',
    'Overwrite? [Y/n] ',
    'Password: ',
    'Database host (default: localhost): ',
    'Continue? ',
    '>>> ',
  ])('matches prompt tail: %j', (s) => {
    expect(looksLikeInputPrompt(s)).toBe(true);
  });

  it('matches a coloured Password: prompt (ANSI-stripped)', () => {
    expect(looksLikeInputPrompt('\x1b[1;32mPassword:\x1b[0m ')).toBe(true);
  });

  it('does not match ordinary output ending in a word', () => {
    expect(looksLikeInputPrompt('Building project files now')).toBe(false);
  });

  it('only inspects the tail ~200 bytes', () => {
    const longLine = 'x'.repeat(500) + '\nPassword: ';
    expect(looksLikeInputPrompt(longLine)).toBe(true);
  });
});

describe('WaitingForInputTracker', () => {
  it('a heuristic hint only raises tentative, not confirmed', () => {
    const t = new WaitingForInputTracker();
    expect(t.onOutput('Password: ', 0)).toBe('tentative');
    expect(t.state).toBe('tentative');
  });

  it('idle timeout confirms a tentative hint', () => {
    const t = new WaitingForInputTracker({ idleMs: 800 });
    t.onOutput('Password: ', 0);
    expect(t.poll(700)).toBe('tentative'); // not idle long enough
    expect(t.poll(800)).toBe('confirmed'); // 800ms since last output
  });

  it('new non-prompt output clears the waiting state', () => {
    const t = new WaitingForInputTracker();
    t.onOutput('Password: ', 0);
    t.poll(1000); // confirmed
    expect(t.state).toBe('confirmed');
    expect(t.onOutput('Connecting to db...', 1100)).toBe('idle');
  });

  it('read-idle confirms a tentative hint immediately (strategy b)', () => {
    const t = new WaitingForInputTracker();
    t.onOutput('(y/n) ', 0); // tentative
    expect(t.onReadIdle()).toBe('confirmed');
  });

  it('read-idle without a prior hint only goes tentative', () => {
    const t = new WaitingForInputTracker();
    expect(t.onReadIdle()).toBe('tentative');
  });

  it('captures the matched prompt text for the banner', () => {
    const t = new WaitingForInputTracker();
    t.onOutput('• Setting up\nDatabase host (default: localhost): ', 0);
    expect(t.lastPromptText).toBe('Database host (default: localhost):');
  });

  it('clear() resets to idle', () => {
    const t = new WaitingForInputTracker();
    t.onOutput('Password: ', 0);
    t.poll(1000);
    t.clear();
    expect(t.state).toBe('idle');
    expect(t.lastPromptText).toBe('');
  });
});
