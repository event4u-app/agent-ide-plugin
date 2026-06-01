import { escapeHtml } from '../markdown.js';
import * as icons from '../icons.js';

export interface ComposerInitial {
  mode: 'api' | 'cli';
  modelId: string;
  models: Array<{ id: string; priceLabel: string }>;
  sidecarHealthy: boolean;
  /** Active provider can serve a turn — drives the green/red status dot. */
  providerAvailable: boolean;
  streaming: boolean;
}

/**
 * Composer container HTML (C-3). Three-row grid:
 *   Row 1 — chip rail (inline @ + / chips, dynamic context chips).
 *   Row 2 — textarea.
 *   Row 3 — action bar (mode pill + model pill + icon buttons).
 *
 * Twin of `clients/jetbrains/src/main/kotlin/de/event4u/agent/ui/Composer.kt`.
 */
export function composerHtml(initial: ComposerInitial): string {
  const modeClass =
    !initial.sidecarHealthy || !initial.providerAvailable
      ? 'e4u-mode-pill--error'
      : initial.streaming
        ? 'e4u-mode-pill--streaming'
        : 'e4u-mode-pill--ready';
  return `<form class="e4u-composer" id="e4u-composer">
    <div class="e4u-composer__chips" id="e4u-chips">
      <button type="button" class="e4u-chip" data-action="open-mention" title="Insert @-mention">@</button>
      <button type="button" class="e4u-chip" data-action="open-command" title="Insert /-command">/</button>
    </div>
    <textarea
      class="e4u-composer__textarea"
      id="e4u-input"
      rows="3"
      placeholder="Ask event4u — @ for context, / for commands"
      aria-label="Chat message"
    ></textarea>
    <div class="e4u-composer__row e4u-composer__row--actions">
      <div class="e4u-composer__left">
        <button type="button" class="e4u-pill ${modeClass}" id="e4u-mode" data-action="toggle-mode" title="Mode: ${escapeHtml(initial.mode.toUpperCase())}. Click to cycle.">
          <span class="e4u-pill__dot"></span>
          <span id="e4u-mode-label">${escapeHtml(initial.mode.toUpperCase())}</span>
        </button>
        <select class="e4u-pill e4u-model-pill" id="e4u-model" data-action="pick-model" title="Active model">
          ${initial.models
            .map(
              (m) =>
                `<option value="${escapeHtml(m.id)}"${m.id === initial.modelId ? ' selected' : ''}>${escapeHtml(m.id)} (${escapeHtml(m.priceLabel)})</option>`,
            )
            .join('')}
        </select>
      </div>
      <div class="e4u-composer__right">
        <button type="button" class="e4u-icon-btn" data-action="attach" title="Attach file or image" disabled>${icons.paperclip()}</button>
        <button type="button" class="e4u-icon-btn" data-action="open-command" title="Insert command (/)">${icons.sparkle()}</button>
        <button type="button" class="e4u-icon-btn" data-action="send" id="e4u-send" title="Send message (Enter)" disabled>${icons.send()}</button>
        <button type="button" class="e4u-icon-btn" data-action="stop" id="e4u-stop" title="Stop streaming (Esc)" disabled>${icons.stop()}</button>
      </div>
    </div>
  </form>`;
}
