/**
 * Theme tokens shared by the webview components. Mirrors the JetBrains
 * `Theme` object (clients/jetbrains/src/main/kotlin/de/event4u/agent/ui/
 * Theme.kt) so the two surfaces stay visually aligned.
 *
 * Spec: agents/roadmaps/road-to-mvp-ui-design.md § Visual language.
 */

export const SPACE = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const RADIUS = {
  chip: 12,
  card: 8,
  button: 6,
} as const;

export const SIZE = {
  headerHeight: 36,
  iconButton: 28,
  pillHeight: 24,
  statusDot: 6,
  chipHeight: 22,
  inputMinHeight: 60,
  welcomeCardMaxWidth: 320,
} as const;

/**
 * Style block embedded inline in the webview HTML (CSP-friendly — no
 * external stylesheet). All colours resolve via `var(--vscode-*)` so the
 * theme follows VS Code dark/light/high-contrast automatically.
 */
export function themeCss(): string {
  return `
    :root {
      color-scheme: var(--vscode-color-scheme);
      --e4u-space-xxs: ${SPACE.xxs}px;
      --e4u-space-xs: ${SPACE.xs}px;
      --e4u-space-sm: ${SPACE.sm}px;
      --e4u-space-md: ${SPACE.md}px;
      --e4u-space-lg: ${SPACE.lg}px;
      --e4u-space-xl: ${SPACE.xl}px;
      --e4u-radius-chip: ${RADIUS.chip}px;
      --e4u-radius-card: ${RADIUS.card}px;
      --e4u-radius-button: ${RADIUS.button}px;
      --e4u-header-height: ${SIZE.headerHeight}px;
      --e4u-icon-button: ${SIZE.iconButton}px;
      --e4u-pill-height: ${SIZE.pillHeight}px;
      --e4u-status-dot: ${SIZE.statusDot}px;
      --e4u-chip-height: ${SIZE.chipHeight}px;
      --e4u-input-min: ${SIZE.inputMinHeight}px;
      --e4u-welcome-max: ${SIZE.welcomeCardMaxWidth}px;
      --e4u-surface: var(--vscode-sideBar-background, var(--vscode-editor-background));
      --e4u-surface-inset: var(--vscode-editorWidget-background, var(--vscode-input-background));
      --e4u-text: var(--vscode-foreground);
      --e4u-text-muted: var(--vscode-descriptionForeground);
      --e4u-border: var(--vscode-panel-border, var(--vscode-input-border));
      --e4u-accent: var(--vscode-button-background);
      --e4u-accent-fg: var(--vscode-button-foreground);
      --e4u-status-ready: var(--vscode-charts-green, #4caf50);
      --e4u-status-streaming: var(--vscode-charts-blue, #4af);
      --e4u-status-error: var(--vscode-charts-red, #c84646);
    }
    body { margin: 0; padding: 0; font-family: var(--vscode-font-family, sans-serif); color: var(--e4u-text); background: var(--e4u-surface); -webkit-font-smoothing: antialiased; }
    .e4u-app { display: flex; flex-direction: column; height: 100vh; }

    /* Form-control reset. VS Code injects a default webview stylesheet that
       makes buttons/selects/inputs inherit the theme font — JCEF (Chromium)
       has NO such defaults, so without this the controls render with UA
       fonts and chrome. Keeping the reset here makes the bundle
       self-sufficient on both hosts. */
    button, select, textarea, input { font-family: inherit; font-size: inherit; color: inherit; }

    /* Scrollbars — VS Code styles webview scrollbars by default; Chromium
       inside JCEF shows chunky UA bars. Style them once for both hosts. */
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(128, 128, 128, 0.35)); border-radius: 5px; background-clip: padding-box; border: 2px solid transparent; }
    ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(128, 128, 128, 0.5)); background-clip: padding-box; border: 2px solid transparent; }
    ::-webkit-scrollbar-thumb:active { background: var(--vscode-scrollbarSlider-activeBackground, rgba(128, 128, 128, 0.6)); background-clip: padding-box; border: 2px solid transparent; }
    ::-webkit-scrollbar-corner { background: transparent; }

    /* Header (C-1) */
    .e4u-header { display: flex; align-items: center; justify-content: space-between; height: var(--e4u-header-height); padding: 0 var(--e4u-space-md); border-bottom: 1px solid var(--e4u-border); flex-shrink: 0; }
    .e4u-header__wordmark { display: flex; align-items: center; gap: var(--e4u-space-sm); font-weight: 600; opacity: 0.85; }
    .e4u-header__actions { display: flex; align-items: center; gap: var(--e4u-space-xs); }

    /* Icon button (C-6) */
    .e4u-icon-btn { width: var(--e4u-icon-button); height: var(--e4u-icon-button); display: inline-flex; align-items: center; justify-content: center; background: transparent; color: inherit; border: none; border-radius: var(--e4u-radius-button); cursor: pointer; padding: 0; }
    .e4u-icon-btn:hover:not([disabled]) { background: var(--e4u-surface-inset); }
    .e4u-icon-btn[disabled] { opacity: 0.4; cursor: not-allowed; }
    .e4u-icon-btn:focus-visible { outline: 1px solid var(--e4u-accent); outline-offset: 1px; }

    /* Messages region */
    .e4u-messages { flex: 1; overflow-y: auto; padding: var(--e4u-space-md); display: flex; flex-direction: column; gap: var(--e4u-space-sm); }
    .e4u-messages--empty { align-items: center; justify-content: center; }

    /* Welcome card (C-2) */
    .e4u-welcome { max-width: var(--e4u-welcome-max); padding: var(--e4u-space-lg); border: 1px solid var(--e4u-border); border-radius: var(--e4u-radius-card); background: var(--e4u-surface-inset); }
    .e4u-welcome__title { font-weight: 600; margin: 0 0 var(--e4u-space-xs) 0; display: flex; align-items: center; gap: var(--e4u-space-sm); }
    .e4u-welcome__hint { margin: 0; font-size: 0.85em; color: var(--e4u-text-muted); }

    /* Message cards */
    .e4u-card { border: 1px solid var(--e4u-border); border-radius: var(--e4u-radius-card); padding: var(--e4u-space-sm) var(--e4u-space-md); background: var(--e4u-surface); }
    .e4u-card__header { font-weight: 600; margin-bottom: var(--e4u-space-xxs); opacity: 0.8; font-size: 0.85em; }
    .e4u-card--user { background: var(--vscode-editor-inactiveSelectionBackground, transparent); }
    .e4u-card--halt { border-color: var(--vscode-inputValidation-warningBorder, var(--e4u-border)); }
    .e4u-tool-call summary { cursor: pointer; padding: var(--e4u-space-xxs) 0; }
    .e4u-cost { font-size: 0.8em; opacity: 0.7; margin-top: var(--e4u-space-xxs); }
    .e4u-streaming-tag { font-size: 0.75em; opacity: 0.7; margin-left: var(--e4u-space-xs); }
    .e4u-codeblock { background: var(--vscode-textCodeBlock-background); padding: var(--e4u-space-sm); border-radius: var(--e4u-radius-button); overflow-x: auto; }

    /* Composer (C-3) */
    .e4u-composer { display: grid; grid-template-rows: auto 1fr auto; gap: var(--e4u-space-xs); padding: var(--e4u-space-sm); margin: var(--e4u-space-md); border: 1px solid var(--e4u-border); border-radius: var(--e4u-radius-card); background: var(--e4u-surface-inset); transition: border-color 80ms; }
    .e4u-composer:focus-within { border-color: var(--e4u-accent); }
    .e4u-composer--dragover { border-color: var(--e4u-accent); border-style: dashed; }
    .e4u-composer__textarea { width: 100%; min-height: var(--e4u-input-min); resize: vertical; background: transparent; color: inherit; border: none; padding: var(--e4u-space-xs); font-family: inherit; font-size: inherit; outline: none; }
    .e4u-composer__textarea::placeholder { color: var(--e4u-text-muted); }
    .e4u-composer__row { display: flex; align-items: center; gap: var(--e4u-space-sm); flex-wrap: wrap; }
    .e4u-composer__row--actions { justify-content: space-between; gap: var(--e4u-space-xs); }
    .e4u-composer__left, .e4u-composer__right { display: flex; align-items: center; gap: var(--e4u-space-xs); }
    .e4u-composer__chips { display: flex; align-items: center; gap: var(--e4u-space-xs); flex-wrap: wrap; min-height: var(--e4u-chip-height); }

    /* Chip (C-7) */
    .e4u-chip { display: inline-flex; align-items: center; gap: var(--e4u-space-xxs); height: var(--e4u-chip-height); padding: 0 var(--e4u-space-sm); border-radius: var(--e4u-radius-chip); background: var(--e4u-surface); color: var(--e4u-text); font-size: 0.8em; border: none; cursor: pointer; }
    .e4u-chip--command { background: var(--e4u-accent); color: var(--e4u-accent-fg); }
    .e4u-chip--file { background: var(--e4u-surface); }
    .e4u-chip__remove { margin-left: var(--e4u-space-xxs); opacity: 0.7; cursor: pointer; padding: 0 var(--e4u-space-xxs); border: none; background: transparent; color: inherit; }
    .e4u-chip__remove:hover { opacity: 1; }

    /* Mode pill (C-4) */
    .e4u-pill { display: inline-flex; align-items: center; gap: var(--e4u-space-xs); height: var(--e4u-pill-height); padding: 0 var(--e4u-space-sm); border-radius: var(--e4u-radius-chip); background: var(--e4u-surface); color: var(--e4u-text); font-size: 0.8em; border: none; cursor: pointer; }
    .e4u-pill:hover { background-color: var(--e4u-surface-inset); }
    .e4u-pill:focus-visible { outline: 1px solid var(--e4u-accent); }
    .e4u-pill__dot { width: var(--e4u-status-dot); height: var(--e4u-status-dot); border-radius: 50%; background: var(--e4u-status-ready); display: inline-block; }
    .e4u-mode-pill--ready .e4u-pill__dot { background: var(--e4u-status-ready); }
    .e4u-mode-pill--streaming .e4u-pill__dot { background: var(--e4u-status-streaming); }
    .e4u-mode-pill--error .e4u-pill__dot { background: var(--e4u-status-error); }

    /* Model pill (C-5) */
    .e4u-model-pill { appearance: none; -webkit-appearance: none; padding-right: calc(var(--e4u-space-sm) + 12px); background-color: var(--e4u-surface); background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%); background-position: calc(100% - 12px) center, calc(100% - 8px) center; background-size: 4px 4px, 4px 4px; background-repeat: no-repeat; border: none; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .e4u-model-pill:hover { background-color: var(--e4u-surface-inset); }
    .e4u-model-pill:focus-visible { outline: 1px solid var(--e4u-accent); }
    /* The dropdown popup stays native, but color-scheme + explicit option
       colors keep it dark-on-dark in Chromium instead of the UA white list. */
    .e4u-model-pill option { background: var(--e4u-surface-inset); color: var(--e4u-text); }

    /* Halt card options (C-7 variant) */
    .e4u-halt-options { display: flex; flex-wrap: wrap; gap: var(--e4u-space-xs); margin-top: var(--e4u-space-xs); }
    .e4u-halt-option { background: var(--e4u-accent); color: var(--e4u-accent-fg); border: none; padding: var(--e4u-space-xxs) var(--e4u-space-sm); border-radius: var(--e4u-radius-button); cursor: pointer; font-size: 0.85em; }
    .e4u-halt-text { display: flex; gap: var(--e4u-space-xs); margin-top: var(--e4u-space-xs); }
    .e4u-halt-text input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: var(--e4u-radius-button); padding: var(--e4u-space-xxs) var(--e4u-space-xs); }
  `;
}
