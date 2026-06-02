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

describe('resolveSystemPrompt — fold always-active RULES into the system prompt (T-404, ADR-043)', () => {
  const noGuidelines = async () => '';

  it('is backward-compatible when no rules loader is passed', async () => {
    const out = await resolveSystemPrompt('BASE', async () => 'Always test.');
    expect(out).toContain('<workspace-guidelines>');
    expect(out).not.toContain('<workspace-rules>');
  });

  it('wraps the rules in a delimited block and leads with it (council Q5=A)', async () => {
    const out = await resolveSystemPrompt(
      'BASE PROMPT',
      async () => 'Always write tests.',
      async () => '## Rule: minimal-diff\n\nKeep diffs small.',
    );
    expect(out).toContain('<workspace-rules>');
    expect(out).toContain('Keep diffs small.');
    expect(out).toContain('</workspace-rules>');
    // Ordering: rules → guidelines → base.
    expect(out!.indexOf('Keep diffs small.')).toBeLessThan(out!.indexOf('Always write tests.'));
    expect(out!.indexOf('Always write tests.')).toBeLessThan(out!.indexOf('BASE PROMPT'));
  });

  it('uses rules as the whole prompt when guidelines and base are empty', async () => {
    const out = await resolveSystemPrompt(
      undefined,
      noGuidelines,
      async () => '## Rule: r\n\nbody',
    );
    expect(out).toContain('<workspace-rules>');
    expect(out).toContain('body');
    expect(out).not.toContain('<workspace-guidelines>');
  });

  it('omits the rules block when the loader yields only whitespace', async () => {
    const out = await resolveSystemPrompt('BASE', noGuidelines, async () => '   ');
    expect(out).toBe('BASE');
    expect(out).not.toContain('<workspace-rules>');
  });

  it('fails open: a rules loader error degrades to guidelines+base, never throws', async () => {
    const out = await resolveSystemPrompt(
      'BASE',
      async () => 'guide me',
      async () => {
        throw new Error('walk exploded');
      },
    );
    expect(out).toContain('guide me');
    expect(out).toContain('BASE');
    expect(out).not.toContain('<workspace-rules>');
  });
});
