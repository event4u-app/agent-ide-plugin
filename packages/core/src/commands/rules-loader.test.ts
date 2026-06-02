import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRulesLoader } from './rules-loader.js';

let root: string;

/** Write a rule file under the `.event4u-agent/rules/` source root. */
async function ruleFile(name: string, content: string): Promise<void> {
  const dir = join(root, '.event4u-agent', 'rules');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.md`), content, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'event4u-rules-loader-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createRulesLoader — wire the dead T-404 seam into a live rules string (ADR-043)', () => {
  it('walks the agent-config tree and renders the always-active rules block', async () => {
    await ruleFile(
      'minimal-diff',
      `---\nname: minimal-diff\ntrigger: always\n---\nKeep the diff small.`,
    );
    const load = createRulesLoader(root);
    const out = await load();
    expect(out).toContain('## Rule: minimal-diff');
    expect(out).toContain('Keep the diff small.');
  });

  it('treats a missing trigger as always-active and skips non-always rules', async () => {
    await ruleFile('default-on', `---\nname: default-on\n---\nDefault body.`);
    await ruleFile(
      'context-only',
      `---\nname: context-only\ntrigger: auto\n---\nShould not appear.`,
    );
    const out = await createRulesLoader(root)();
    expect(out).toContain('Default body.');
    expect(out).not.toContain('Should not appear.');
  });

  it('fails open to an empty string when no agent-config tree exists', async () => {
    // root has no .event4u-agent / .augment / .agent-src dirs.
    const out = await createRulesLoader(root)();
    expect(out).toBe('');
  });

  it('walks ONCE and caches the result for the session (council Q2=A)', async () => {
    await ruleFile('r1', `---\nname: r1\ntrigger: always\n---\nfirst body`);
    const load = createRulesLoader(root);
    const first = await load();
    expect(first).toContain('first body');

    // A later edit must NOT change the cached string — rules are session-static.
    await ruleFile('r1', `---\nname: r1\ntrigger: always\n---\nEDITED body`);
    const second = await load();
    expect(second).toBe(first);
    expect(second).not.toContain('EDITED body');
  });

  it('drops over-budget rules off the tail via the char cap', async () => {
    await ruleFile('a-small', `---\nname: a-small\ntrigger: always\n---\nshort`);
    await ruleFile('b-huge', `---\nname: b-huge\ntrigger: always\n---\n${'x'.repeat(500)}`);
    // Budget large enough for the first rule's block but not the second.
    const out = await createRulesLoader(root, { maxChars: 60 })();
    expect(out).toContain('## Rule: a-small');
    expect(out).not.toContain('## Rule: b-huge');
  });
});
