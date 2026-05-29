/**
 * Inline SVG icons for the webview chat surface. No external requests —
 * the webview CSP only allows `script-src 'nonce-…'` + `style-src 'self'
 * 'unsafe-inline'`, so SVG bytes ride along inside the HTML.
 *
 * Icon names mirror the JetBrains `AllIcons.*` references from the design
 * contract so the two surfaces stay paired.
 */

const STROKE = 'currentColor';
const SIZE = 16;
const HALF = 8;
const RADIUS = 6;
const PLUS_END = 12;

function wrap(body: string): string {
  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" fill="none" stroke="${STROKE}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function send(): string {
  return wrap('<path d="M2 8 L14 2 L8 14 L7 9 Z" />');
}

export function stop(): string {
  return wrap('<rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" />');
}

export function paperclip(): string {
  return wrap('<path d="M11 7 L6 12 a2 2 0 0 1 -2.8 -2.8 L10 2.5 a3 3 0 0 1 4.3 4.3 L8 13" />');
}

export function sparkle(): string {
  return wrap(
    `<path d="M${HALF} 2 L${HALF + 2} ${HALF - 2} L${SIZE - 2} ${HALF} L${HALF + 2} ${HALF + 2} L${HALF} ${SIZE - 2} L${HALF - 2} ${HALF + 2} L2 ${HALF} L${HALF - 2} ${HALF - 2} Z" />`,
  );
}

export function add(): string {
  return wrap(
    `<path d="M${HALF} ${SIZE - PLUS_END} L${HALF} ${PLUS_END} M${SIZE - PLUS_END} ${HALF} L${PLUS_END} ${HALF}" />`,
  );
}

export function more(): string {
  return wrap(
    '<circle cx="4" cy="8" r="1" fill="currentColor" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="12" cy="8" r="1" fill="currentColor" />',
  );
}

export function history(): string {
  return wrap(
    `<circle cx="${HALF}" cy="${HALF}" r="${RADIUS}" /><path d="M${HALF} ${HALF - 4} L${HALF} ${HALF} L${HALF + 3} ${HALF + 2}" />`,
  );
}

export function logo(): string {
  return wrap(
    `<circle cx="${HALF}" cy="${HALF}" r="${RADIUS}" /><path d="M${HALF} 4 L${HALF} ${SIZE - 4}" /><path d="M4 ${HALF} L${SIZE - 4} ${HALF}" />`,
  );
}
