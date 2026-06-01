import { describe, expect, it } from 'vitest';
import { resolveSystemPrompt } from './system-prompt.js';

describe('resolveSystemPrompt — fold workspace guidelines into the system prompt (T-1307)', () => {
  it('returns the base unchanged when guidelines are empty', async () => {
    const out = await resolveSystemPrompt('You are a helper.', async () => '');
    expect(out).toBe('You are a helper.');
  });

  it('yields a falsy result when both base and guidelines are empty (callers omit `system`)', async () => {
    // base undefined + empty guidelines → undefined; base '' is returned as-is.
    // Both are falsy, so the request-building spread omits the `system` key.
    expect(await resolveSystemPrompt(undefined, async () => '')).toBeUndefined();
    expect(await resolveSystemPrompt('', async () => '   ')).toBeFalsy();
  });

  it('prepends a delimited guidelines block AHEAD of the base (fork E1)', async () => {
    const out = await resolveSystemPrompt('BASE PROMPT', async () => 'Always write tests.');
    expect(out).toContain('<workspace-guidelines>');
    expect(out).toContain('# Workspace Guidelines');
    expect(out).toContain('Always write tests.');
    expect(out).toContain('</workspace-guidelines>');
    expect(out).toContain('BASE PROMPT');
    // Guidelines lead, base trails.
    expect(out!.indexOf('Always write tests.')).toBeLessThan(out!.indexOf('BASE PROMPT'));
  });

  it('uses guidelines as the whole prompt when there is no base', async () => {
    const out = await resolveSystemPrompt(undefined, async () => 'Be concise.');
    expect(out).toContain('Be concise.');
    expect(out).toContain('<workspace-guidelines>');
  });

  it('fails open: a loader error degrades to the base, never throws (fork F1)', async () => {
    const out = await resolveSystemPrompt('BASE', async () => {
      throw new Error('disk gone');
    });
    expect(out).toBe('BASE');
  });

  it('fails open to undefined when the loader throws and there is no base', async () => {
    const out = await resolveSystemPrompt(undefined, async () => {
      throw new Error('disk gone');
    });
    expect(out).toBeUndefined();
  });
});
