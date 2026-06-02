/**
 * Workspace review-settings reader (road-to-code-review.md Phase 5, T-CR-502).
 *
 * Sibling of `rules.ts` `loadReviewRules`: where that reads the project's
 * `review-rules.md`, this reads the `review:` block from the consumer's
 * `.agent-settings.yml` and resolves it through {@link resolveReviewSettings}
 * (applying schema defaults). The settings-UI that *writes* these values is
 * the IDE client layer (the MVP T-204 pattern); the Core only reads.
 *
 * Fail-open by construction (mirrors `main.ts`'s best-effort settings read):
 * a missing file, malformed YAML, or an invalid `review:` block all resolve to
 * the default `ReviewSettings` rather than throwing — a broken config must
 * never break the review action.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { resolveReviewSettings, type ReviewSettings } from './config.js';

/** Consumer settings file the `review:` block is read from. */
export const AGENT_SETTINGS_PATH = '.agent-settings.yml';

export interface SettingsReader {
  read(path: string): Promise<string>;
}

const defaultReader: SettingsReader = {
  read: (path) => fsReadFile(path, 'utf8'),
};

/**
 * Load review settings from `<cwd>/.agent-settings.yml :: review`, applying
 * `ReviewSettingsSchema` defaults. Returns the full default settings when the
 * file is absent, the YAML is malformed, or the `review` block fails schema
 * validation (fail-open — the floor/vote wiring still works on defaults).
 */
export async function loadReviewSettings(
  cwd: string,
  reader: SettingsReader = defaultReader,
): Promise<ReviewSettings> {
  try {
    const text = await reader.read(resolve(cwd, AGENT_SETTINGS_PATH));
    const parsed = parseYaml(text) as { review?: unknown } | null;
    return resolveReviewSettings(parsed?.review);
  } catch {
    return resolveReviewSettings(undefined);
  }
}
