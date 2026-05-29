import * as icons from '../icons.js';

/**
 * Empty-state welcome card (C-2). Rendered into the messages container when
 * the message list is empty; replaced by message cards on the first turn.
 */
export function welcomeHtml(): string {
  return `<section class="e4u-welcome">
    <h2 class="e4u-welcome__title">${icons.sparkle()}<span>New event4u thread</span></h2>
    <p class="e4u-welcome__hint">Pick a command with <code>/</code>, attach context with <code>@</code>, or just ask.</p>
  </section>`;
}
