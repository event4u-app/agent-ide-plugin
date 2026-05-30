import type { CliCapabilityManifest } from './manifest.js';

/**
 * Gemini CLI capability manifest.
 * Verified against gemini-cli 0.41.2 on 2026-05-30 (`gemini --output-format
 * stream-json`, `gemini --help`). Session id surfaces as `session_id` in the
 * `init` event; resume via `-r/--resume`. OAuth consent must be granted once
 * interactively before headless runs succeed.
 */
export const geminiManifest: CliCapabilityManifest = {
  id: 'gemini',
  binary: 'gemini',
  versionArgs: ['--version'],
  minVersion: '0.40.0',
  verifiedVersion: '0.41.2',
  verifiedDate: '2026-05-30',
  streamArgs: ['--output-format', 'stream-json', '--skip-trust'],
  abort: 'sigterm',
  slashCommands: false,
  modelSwitch: { supported: true, flag: '--model' },
  permissionModes: ['default', 'auto_edit', 'yolo', 'plan'],
  verbosity: { supported: false },
  session: { idField: 'session_id', resumeFlag: '--resume' },
  auth: { probeArgs: ['--version'], hint: 'run `gemini` once to grant OAuth consent' },
};
