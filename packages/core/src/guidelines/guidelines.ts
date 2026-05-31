import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Phase 13 — Workspace Guidelines (T-1307).
 *
 * An editable `<workspace>/.event4u-agent/guidelines.md` whose content is
 * prepended to the system prompt (Augment-style project rules,
 * agent-config-rule-compatible). Pure core: load / save the file and compose
 * it into a system string. The editor UI is IDE-gated.
 *
 * Two structural guards:
 *   - **Fail-open.** A missing/unreadable file yields `''` — never an error,
 *     so a workspace with no guidelines simply runs without them.
 *   - **Size cap.** Content is clamped to {@link MAX_GUIDELINES_BYTES} before
 *     it reaches the prompt, so an accidental multi-MB paste cannot blow up
 *     every request's token budget.
 */

export const GUIDELINES_FILE = 'guidelines.md';

/** Hard cap on guidelines length once composed into the system prompt (~16k chars). */
export const MAX_GUIDELINES_BYTES = 16 * 1024;

const GUIDELINES_HEADER = '# Workspace Guidelines';
const GUIDELINES_OPEN = '<workspace-guidelines>';
const GUIDELINES_CLOSE = '</workspace-guidelines>';

export interface GuidelinesStore {
  /** Current guidelines text; `''` when none exist (fail-open). */
  load(): Promise<string>;
  save(content: string): Promise<void>;
}

/** In-memory store for tests and ephemeral runs. */
export class InMemoryGuidelinesStore implements GuidelinesStore {
  private content = '';
  constructor(initial?: string) {
    if (initial) this.content = initial;
  }
  async load(): Promise<string> {
    return this.content;
  }
  async save(content: string): Promise<void> {
    this.content = content;
  }
}

/** File-backed store at `<baseDir>/guidelines.md` (`baseDir` = `.event4u-agent`). */
export class FileGuidelinesStore implements GuidelinesStore {
  constructor(private readonly baseDir: string) {}

  async load(): Promise<string> {
    return (await readFile(this.pathFor(), 'utf8').catch(() => '')).trim();
  }

  async save(content: string): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const body = content.endsWith('\n') ? content : `${content}\n`;
    await writeFile(this.pathFor(), body, 'utf8');
  }

  private pathFor(): string {
    return join(this.baseDir, GUIDELINES_FILE);
  }
}

/**
 * Compose workspace guidelines into the system prompt. Returns `base`
 * unchanged when there are no guidelines; otherwise prepends a clearly
 * delimited, size-capped block ahead of the base system text.
 */
export function composeSystemPrompt(
  base: string | undefined,
  guidelines: string,
): string | undefined {
  const trimmed = guidelines.trim();
  if (trimmed.length === 0) return base;

  const clamped = clampToBytes(trimmed, MAX_GUIDELINES_BYTES);
  const block = `${GUIDELINES_OPEN}\n${GUIDELINES_HEADER}\n\n${clamped}\n${GUIDELINES_CLOSE}`;

  const baseText = base?.trim();
  return baseText && baseText.length > 0 ? `${block}\n\n${baseText}` : block;
}

/** Clamp to a byte budget on a char boundary, marking the truncation. */
function clampToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const marker = '\n…[guidelines truncated]';
  const budget = maxBytes - Buffer.byteLength(marker, 'utf8');
  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > budget) {
    end--;
  }
  return `${text.slice(0, end).trimEnd()}${marker}`;
}
