import { describe, expect, it } from 'vitest';
import { buildCommitTurn, parseStatus, readGitStatus, type GitRunner } from './commit.js';

const STATUS_OUT = `## main...origin/main
 M packages/core/src/foo.ts
A  packages/core/src/bar.ts
?? packages/core/src/new-file.ts
`;

describe('parseStatus', () => {
  it('extracts branch + tracked changes + untracked entries', () => {
    const status = parseStatus(STATUS_OUT);
    expect(status.branch).toBe('main');
    expect(status.changes).toEqual([
      { status: ' M', path: 'packages/core/src/foo.ts' },
      { status: 'A ', path: 'packages/core/src/bar.ts' },
    ]);
    expect(status.untracked).toEqual(['packages/core/src/new-file.ts']);
  });

  it('returns HEAD branch when not on a named branch', () => {
    const status = parseStatus('## HEAD (no branch)\n');
    expect(status.branch).toBe('HEAD (no branch)');
  });
});

describe('readGitStatus', () => {
  it('uses the injected runner and throws on non-zero exit', async () => {
    const runner: GitRunner = {
      run: () => Promise.resolve({ stdout: '', stderr: 'fatal: not a git repo', exitCode: 128 }),
    };
    await expect(readGitStatus('/tmp', runner)).rejects.toThrow(/git status failed/);
  });

  it('parses successful runner output', async () => {
    const runner: GitRunner = {
      run: () => Promise.resolve({ stdout: STATUS_OUT, stderr: '', exitCode: 0 }),
    };
    const status = await readGitStatus('/tmp', runner);
    expect(status.branch).toBe('main');
    expect(status.changes.length).toBe(2);
  });
});

describe('buildCommitTurn', () => {
  it('builds messages with the status block as the user turn', () => {
    const { messages } = buildCommitTurn(
      { cwd: '/tmp' },
      {
        branch: 'feat/foo',
        changes: [{ status: ' M', path: 'a.ts' }],
        untracked: [],
      },
    );
    expect(messages.length).toBe(1);
    const user = messages[0];
    expect(user?.role).toBe('user');
    expect(user?.content).toMatch(/Propose a Conventional-Commit/);
    expect(user?.content).toMatch(/feat\/foo/);
    expect(user?.content).toMatch(/ M a\.ts/);
  });

  it('prepends a system message when a command body is provided', () => {
    const { messages } = buildCommitTurn(
      { cwd: '/tmp', commandBody: 'Procedure: 1. Pull, 2. Diff, 3. Message' },
      { branch: 'main', changes: [], untracked: [] },
    );
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });

  it('includes the user free-text extra instruction', () => {
    const { messages } = buildCommitTurn(
      { cwd: '/tmp', extraInstruction: 'mention the tests' },
      { branch: 'main', changes: [{ status: 'M ', path: 'a.ts' }], untracked: [] },
    );
    expect(messages[0]?.content).toMatch(/mention the tests/);
  });

  it('reports a clean tree when there are no changes', () => {
    const { messages } = buildCommitTurn(
      { cwd: '/tmp' },
      { branch: 'main', changes: [], untracked: [] },
    );
    expect(messages[0]?.content).toMatch(/working tree clean/);
  });
});
