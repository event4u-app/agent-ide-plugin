import { describe, expect, it } from 'vitest';
import { getWebviewHtml } from './webview.js';

describe('getWebviewHtml', () => {
  it('embeds the health line in the status element', () => {
    const html = getWebviewHtml('Sidecar healthy: pong');
    expect(html).toContain('data-testid="sidecar-status"');
    expect(html).toContain('Sidecar healthy: pong');
  });

  it('produces a complete html document', () => {
    const html = getWebviewHtml('x');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });
});
