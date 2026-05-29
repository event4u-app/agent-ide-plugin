/**
 * Minimal markdown → HTML translator for the webview chat surface.
 *
 * Twin of `clients/jetbrains/src/main/kotlin/de/event4u/agent/chat/SimpleMarkdownRenderer.kt`.
 * Keep them behaviourally aligned so both UIs render the same content.
 *
 * Supports: paragraphs, inline `code`, fenced ```code blocks```, `**bold**`,
 * `*italic*`, and single-level `- bullet` lists. Anything heavier is cut to
 * v1.0 Sprint 13.
 */
export function markdownToHtml(input: string): string {
  const escaped = escapeHtml(input);
  const lines = escaped.split('\n');
  const out: string[] = [];
  let i = 0;
  let inList = false;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      const [block, consumed] = readFencedBlock(lines, i);
      out.push(block);
      i += consumed;
      continue;
    }
    if (BULLET.test(line)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${applyInline(line.replace(BULLET, ''))}</li>`);
      i += 1;
      continue;
    }
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    if (line.trim().length === 0) {
      out.push('<br>');
    } else {
      out.push(`<p>${applyInline(line)}</p>`);
    }
    i += 1;
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

function readFencedBlock(lines: string[], start: number): [string, number] {
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
    body.push(lines[i] ?? '');
    i += 1;
  }
  const block = `<pre class="event4u-codeblock"><code>${body.join('\n')}</code></pre>`;
  // Consumed: opening fence + body lines + closing fence (or EOF).
  return [block, i - start + 1];
}

function applyInline(text: string): string {
  let out = text;
  out = out.replace(INLINE_CODE, (_, body: string) => `<code>${body}</code>`);
  out = out.replace(BOLD, (_, body: string) => `<b>${body}</b>`);
  out = out.replace(ITALIC, (_, body: string) => `<i>${body}</i>`);
  return out;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BULLET = /^\s*[-*]\s+/;
const INLINE_CODE = /`([^`]+)`/g;
const BOLD = /\*\*([^*]+)\*\*/g;
const ITALIC = /(?<!\*)\*([^*]+)\*(?!\*)/g;
