import { spawn } from 'node:child_process';
import type { ChatMessage } from '@event4u-agent/protocol';

/**
 * T-403 — `/commit` as the first end-to-end agent-config command.
 *
 * The command runs the minimum two-step tool-call loop (Sprint 3 / council
 * finding #1): read `git status` → propose commit message. The runner is
 * UI-independent — it gathers `git status` output, builds the first chat
 * turn for the LLM, and returns the ChatMessage list the chat orchestrator
 * sends to the backend.
 */

export interface GitStatus {
  /** Branch name as reported by `git status --porcelain=v2 --branch`. */
  branch: string;
  /** Staged + unstaged file changes (porcelain v1 entries). */
  changes: GitChange[];
  /** Untracked files. */
  untracked: string[];
}

export interface GitChange {
  /** Two-char status code, e.g. ` M`, `M `, `MM`, `A `, etc. */
  status: string;
  /** Path relative to the repo root. */
  path: string;
}

export interface CommitTurnInput {
  /** Where to run `git status`. */
  cwd: string;
  /** Optional command-file body that the user invoked (the command markdown). */
  commandBody?: string;
  /** Optional user free-text prompt appended to the turn ("focus on tests"). */
  extraInstruction?: string;
}

export interface CommitTurnOutput {
  messages: ChatMessage[];
  status: GitStatus;
}

export interface GitRunner {
  run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export const defaultGitRunner: GitRunner = {
  async run(args, cwd) {
    return new Promise((resolve) => {
      const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d: string) => (stdout += d));
      child.stderr.on('data', (d: string) => (stderr += d));
      child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
      child.on('error', (err) => resolve({ stdout: '', stderr: String(err), exitCode: 127 }));
    });
  },
};

export async function readGitStatus(
  cwd: string,
  runner: GitRunner = defaultGitRunner,
): Promise<GitStatus> {
  const status = await runner.run(['status', '--porcelain=v1', '--branch'], cwd);
  if (status.exitCode !== 0) {
    throw new Error(`git status failed (${status.exitCode}): ${status.stderr.trim()}`);
  }
  return parseStatus(status.stdout);
}

export function parseStatus(output: string): GitStatus {
  const lines = output.split('\n');
  let branch = 'HEAD';
  const changes: GitChange[] = [];
  const untracked: string[] = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const segment = line.slice(3).split('...')[0]?.trim() ?? 'HEAD';
      branch = segment;
      continue;
    }
    if (line.length < 3) continue;
    const status = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (status === '??') untracked.push(path);
    else changes.push({ status, path });
  }
  return { branch, changes, untracked };
}

/**
 * Build the LLM turn for `/commit`. The agent already knows the command's
 * procedure from the command body (injected via the system prompt slot);
 * we drop the parsed git status into the user turn so the model can emit a
 * commit message without an extra tool-call hop.
 */
export function buildCommitTurn(input: CommitTurnInput, status: GitStatus): CommitTurnOutput {
  const statusBlock = formatStatusBlock(status);
  const command = input.commandBody?.trim() ?? '';
  const extra = input.extraInstruction?.trim() ?? '';
  const userTurn = [
    'Propose a Conventional-Commit message for the changes below.',
    '',
    `### Branch\n${status.branch}`,
    '',
    statusBlock,
    extra.length > 0 ? `\n### Extra instruction\n${extra}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  const messages: ChatMessage[] = [];
  if (command.length > 0) {
    messages.push({ role: 'system', content: command });
  }
  messages.push({ role: 'user', content: userTurn });
  return { messages, status };
}

function formatStatusBlock(status: GitStatus): string {
  if (status.changes.length === 0 && status.untracked.length === 0) {
    return '### Status\n(working tree clean)';
  }
  const lines: string[] = ['### Status'];
  if (status.changes.length > 0) {
    lines.push('Tracked changes:');
    for (const c of status.changes) lines.push(`  ${c.status} ${c.path}`);
  }
  if (status.untracked.length > 0) {
    lines.push('Untracked:');
    for (const p of status.untracked) lines.push(`  ?? ${p}`);
  }
  return lines.join('\n');
}
