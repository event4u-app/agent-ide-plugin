import { describe, expect, it } from 'vitest';
import {
  collapseBlankLines,
  hasEmoji,
  stripAttributionLines,
  stripDecorativeEmoji,
} from './text-rules.js';

describe('stripDecorativeEmoji', () => {
  it('removes decorative emoji but keeps functional status markers by default', () => {
    expect(stripDecorativeEmoji('Ship it 🚀 now 🎉')).toBe('Ship it  now ');
    expect(stripDecorativeEmoji('Done ✅ and warned ⚠️')).toBe('Done ✅ and warned ⚠️');
  });

  it('removes ZWJ and skin-tone sequences', () => {
    expect(stripDecorativeEmoji('hi 👨‍💻 there 👍🏽')).toBe('hi  there ');
  });

  it('removes every emoji including status markers when keepStatus is false', () => {
    expect(stripDecorativeEmoji('Done ✅ ⚠️ 🚀', { keepStatus: false })).toBe('Done   ');
  });
});

describe('hasEmoji', () => {
  it('detects decorative emoji and ignores status markers by default', () => {
    expect(hasEmoji('plain text')).toBe(false);
    expect(hasEmoji('robot 🤖 here')).toBe(true);
    expect(hasEmoji('green ✅ check')).toBe(false);
  });

  it('counts status markers when ignoreStatus is false', () => {
    expect(hasEmoji('green ✅ check', { ignoreStatus: false })).toBe(true);
  });
});

describe('stripAttributionLines', () => {
  it('drops AI co-author trailers and generated-with footers', () => {
    const input = [
      'feat: add thing',
      '',
      'Co-authored-by: Claude <noreply@anthropic.com>',
      '🤖 Generated with Claude Code',
      'See https://augmentcode.com for details',
    ].join('\n');
    const { text, removed } = stripAttributionLines(input);
    expect(removed).toBe(3);
    expect(text).toContain('feat: add thing');
    expect(text).not.toMatch(/co-authored-by/i);
    expect(text).not.toMatch(/augmentcode\.com/i);
  });

  it('keeps a human co-author trailer and unrelated lines', () => {
    const input = 'Co-authored-by: Jane Dev <jane@example.com>\nfix things';
    const { text, removed } = stripAttributionLines(input);
    expect(removed).toBe(0);
    expect(text).toBe(input);
  });
});

describe('collapseBlankLines', () => {
  it('collapses 3+ newlines to a single blank line', () => {
    expect(collapseBlankLines('a\n\n\n\nb')).toBe('a\n\nb');
    expect(collapseBlankLines('a\n\nb')).toBe('a\n\nb');
  });
});
