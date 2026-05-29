/**
 * Workspace review rules (road-to-code-review.md Phase 5, T-CR-501).
 *
 * Our analog of sweep's `SWEEP.md` (`user_prompt_special_rules_format`): a
 * `.event4u-agent/review-rules.md` whose contents are injected as
 * project-specific review criteria into the Stage-1 system prompt
 * (`prompts.ts` `stage1System(rules)`). Compatible with agent-config
 * guidelines — a project can point the file at `docs/guidelines/`.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const REVIEW_RULES_PATH = '.event4u-agent/review-rules.md';

export interface RulesReader {
  read(path: string): Promise<string>;
}

const defaultReader: RulesReader = {
  read: (path) => fsReadFile(path, 'utf8'),
};

/**
 * Load the workspace review rules, or `undefined` when the file is absent or
 * empty. The returned text is injected verbatim into the Stage-1 prompt.
 */
export async function loadReviewRules(
  cwd: string,
  reader: RulesReader = defaultReader,
): Promise<string | undefined> {
  try {
    const text = (await reader.read(resolve(cwd, REVIEW_RULES_PATH))).trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}
