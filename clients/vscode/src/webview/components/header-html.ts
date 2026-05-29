import * as icons from '../icons.js';

/**
 * Header (C-1). Logo + wordmark on the left; history / new-thread / kebab
 * on the right. History + new-thread ship disabled until the project
 * service exposes the hooks — per the user's "build the buttons as
 * disabled" directive.
 */
export function headerHtml(): string {
  return `<header class="e4u-header">
    <div class="e4u-header__wordmark">
      ${icons.logo()}<span>event4u</span>
    </div>
    <div class="e4u-header__actions">
      <button type="button" class="e4u-icon-btn" data-action="history" disabled title="Conversation history (v1.0)">${icons.history()}</button>
      <button type="button" class="e4u-icon-btn" data-action="new-thread" disabled title="New thread">${icons.add()}</button>
      <button type="button" class="e4u-icon-btn" data-action="menu" disabled title="Settings + diagnostics">${icons.more()}</button>
    </div>
  </header>`;
}
