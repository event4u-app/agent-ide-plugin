import type { CliCapabilityManifest } from './manifest.js';

/**
 * Claude Code CLI capability manifest.
 * Verified against claude-cli per the MVP T-405 detection (min 0.10.0).
 */
export const claudeManifest: CliCapabilityManifest = {
  id: 'claude',
  binary: 'claude',
  versionArgs: ['--version'],
  minVersion: '0.10.0',
  verifiedVersion: '0.10.0',
  verifiedDate: '2026-05-30',
  streamArgs: ['-p', '--verbose', '--output-format=stream-json', '--input-format=stream-json'],
  abort: 'sigterm',
  slashCommands: true,
  modelSwitch: { supported: true, flag: '--model' },
  permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  // Print mode REQUIRES --verbose when --output-format=stream-json (claude 2.1.x).
  verbosity: { supported: true },
  session: { idField: 'session_id', resumeFlag: '--resume' },
  auth: { probeArgs: ['config', 'get'], hint: 'run `claude login`' },
};
