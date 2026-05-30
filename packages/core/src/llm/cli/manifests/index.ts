import type { CliCapabilityManifest } from './manifest.js';
import { claudeManifest } from './claude.js';
import { codexManifest } from './codex.js';
import { geminiManifest } from './gemini.js';

export type { CliCapabilityManifest, AbortMethod } from './manifest.js';
export { claudeManifest } from './claude.js';
export { codexManifest } from './codex.js';
export { geminiManifest } from './gemini.js';

/** All shipped CLI manifests, keyed by CLI id. */
export const CLI_MANIFESTS: Record<CliCapabilityManifest['id'], CliCapabilityManifest> = {
  claude: claudeManifest,
  codex: codexManifest,
  gemini: geminiManifest,
};
