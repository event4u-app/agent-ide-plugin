import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownToHtml } from './markdown.js';

describe('markdownToHtml', () => {
  it('wraps paragraphs', () => {
    expect(markdownToHtml('Hello\n\nWorld')).toContain('<p>Hello</p>');
    expect(markdownToHtml('Hello\n\nWorld')).toContain('<p>World</p>');
  });

  it('renders fenced code', () => {
    const html = markdownToHtml('```\nconst x = 1;\n```');
    expect(html).toContain('<pre class="event4u-codeblock"><code>');
    expect(html).toContain('const x = 1;');
  });

  it('renders inline code', () => {
    expect(markdownToHtml('Run `pnpm test`.')).toContain('<code>pnpm test</code>');
  });

  it('renders bold + italic', () => {
    const html = markdownToHtml('**bold** and *italic*');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('<i>italic</i>');
  });

  it('renders bullet lists', () => {
    const html = markdownToHtml('- one\n- two');
    expect(html).toMatch(/<ul>.*<li>one<\/li>.*<li>two<\/li>.*<\/ul>/s);
  });

  it('escapes HTML', () => {
    const html = markdownToHtml('a < b');
    expect(html).toContain('a &lt; b');
    expect(html).not.toContain('<b>');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });
});
