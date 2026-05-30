import type { CliCapabilityManifest } from './manifest.js';

/**
 * Codex CLI capability manifest.
 * Verified against codex-cli 0.134.0 on 2026-05-30 (`codex exec --json`,
 * `codex --help`, `codex exec --help`). Session id surfaces as `thread_id` in
 * the `thread.started` event; resume via the `codex exec resume` subcommand.
 */
export const codexManifest: CliCapabilityManifest = {
  id: 'codex',
  binary: 'codex',
  versionArgs: ['--version'],
  minVersion: '0.40.0',
  verifiedVersion: '0.134.0',
  verifiedDate: '2026-05-30',
  streamArgs: ['exec', '--json', '--skip-git-repo-check'],
  abort: 'sigterm',
  slashCommands: false,
  modelSwitch: { supported: true, flag: '--model' },
  permissionModes: ['read-only', 'on-request', 'on-failure', 'never'],
  verbosity: { supported: false },
  session: { idField: 'thread_id', resumeFlag: 'resume' },
  auth: { probeArgs: ['login', 'status'], hint: 'run `codex login`' },
};
