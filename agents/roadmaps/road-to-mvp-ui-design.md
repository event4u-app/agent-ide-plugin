---
complexity: heavy
---

# Roadmap: MVP UI design — make the chat surface look like a real product

> **Why this roadmap exists.** PR #6 shipped a functionally-correct Swing
> chat surface that looks like a stock Java form: bare `JButton` Send/Stop,
> a comically large `API` button with the IntelliJ focus ring still on,
> no model picker, no welcome card, no attachment surface. Side-by-side
> with the Augment plugin (the reference target the user pointed at) the
> gap is embarrassing. This roadmap is a design contract — not "ship more
> components", but "define what the components look and feel like so the
> implementation can't drift back into Swing-defaults again."
>
> **Reference screenshots** (local-only — `agents/tmp/` is gitignored):
>
> - `agents/tmp/augment-screenshot.png` — the target. Header, segmented
>   tabs, hero card, integrated composer with chips + pill toggle + model
>   pill + icon buttons.
> - `agents/tmp/plugin-screenshot.png` — current state. The gap to close.
>
> **Time-box:** 2–3 weeks of design + implementation. Sprint runs in
> parallel with `road-to-mvp-ui-finish.md` host-wiring work.

## Context

### The 9 specific problems the user called out (or that the screenshots show)

1. **No model picker.** The chat carries `(no model)` in the statusbar and
   has no way to switch from there. Augment puts the model as a chip in
   the composer footer (`☂ Opus 4.7`).
2. **Mode toggle is a giant rectangular button.** Should be a tiny pill
   like Augment's `Auto ●` (pill body with a status dot).
3. **Send / Stop are bare `JButton` rectangles** with default Swing chrome
   and disabled-grey text. Should be icon buttons (paper-plane for send,
   stop-square when streaming).
4. **No drag-and-drop for files / images.** Augment shows attached files
   as inline chips above the input (`agent-config × roadmaps-progress.md ×`).
   No equivalent in our plugin.
5. **No welcome / empty-state card.** Empty chat shows a void with a stray
   red dot. Augment shows a centred "New Agent Thread — Work with your
   agent to use tools and make file edits." card.
6. **Status dot is floating alone in the top-left corner.** It looks like
   a rendering bug, not an intentional indicator.
7. **No header structure.** Just plain `event4u-agent` text. Augment has
   logo + breadcrumb + action icons (hamburger, history, new-thread, …).
8. **No tab bar / sub-surface.** Augment offers Thread / Tasks / Edits.
   MVP scope cuts Tasks + Edits, but we still need at least a clear "this
   is the chat" header.
9. **The composer is unstructured.** Augment's composer is the centrepiece:
   chips on top, multi-line input in the middle, mode + model + icon
   actions on the bottom. Ours is just a textarea + two ugly buttons.

### Out of scope (do NOT design these in v0)

- Tasks tab, Edits tab — those map to Augment's task tracker + diff
  history. Both are v1.0 (Sprint 12 — Per-CLI gear panel & Unified
  Session Browser, and Sprint 7 — Multi-step agent loop).
- Conversation history sidebar (Augment's hamburger menu opens this).
  v1.0 Sprint 12.
- Inline image-paste previews (Augment renders pasted images inline).
  We support drag-n-drop attachments as chips in MVP; inline previews
  are v1.0 Sprint 13 polish.
- Markdown rendering improvements (KaTeX, Mermaid, tables). v1.0
  Sprint 13 per the existing roadmap cut list.

### Stack carryover from prior councils

- **JetBrains: Swing** (Council 2026-05-29, `agents/evidence/analysis/
  jetbrains-ui-council-2026-05-29.json`). Swing CAN look modern — it just
  hasn't because the prior pass used `JButton` + `JBPanel` defaults. The
  IntelliJ Platform itself ships polished Swing chrome; we need to lean
  on `AllIcons`, custom `Border`s, and `BorderlessButton` patterns.
- **VS Code: vanilla DOM webview** (PR #6, vanilla TS, 10.3 KB bundle).
  Already easier to style; the CSS hooks are there. Augment-parity is a
  matter of writing the right CSS + a few more components.

## Visual language

### Spacing scale (use these constants, do NOT eyeball values)

| Token | Value | Use |
|---|---|---|
| `space.xxs` | 2 px | icon-to-text gap inside a chip |
| `space.xs` | 4 px | chip border-radius padding |
| `space.sm` | 8 px | between chips, between icon buttons |
| `space.md` | 12 px | card inner padding, composer row gap |
| `space.lg` | 16 px | between top-level sections |
| `space.xl` | 24 px | tool-window outer padding |

### Border-radius scale

| Token | Value | Use |
|---|---|---|
| `radius.chip` | 12 px (pill) | mode toggle, model picker, context chips |
| `radius.card` | 8 px | welcome-card, message cards, composer container |
| `radius.button` | 6 px | rectangular buttons (rare — prefer icon buttons) |

### Colour roles

Source: IntelliJ's `JBUI.CurrentTheme` for Swing, VS Code's `--vscode-*`
CSS custom properties for the webview. No raw hex codes in components —
always go through the theme variable.

| Role | JetBrains | VS Code |
|---|---|---|
| Surface background | `JBUI.CurrentTheme.ToolWindow.background()` | `--vscode-sideBar-background` |
| Surface inset (card) | `JBUI.CurrentTheme.NewClassDialog.searchFieldBackground()` | `--vscode-editorWidget-background` |
| Primary text | `JBUI.CurrentTheme.Label.foreground()` | `--vscode-foreground` |
| Muted text | `JBUI.CurrentTheme.Label.disabledForeground()` | `--vscode-descriptionForeground` |
| Border | `JBUI.CurrentTheme.CustomFrameDecorations.separatorForeground()` | `--vscode-panel-border` |
| Accent | `JBUI.CurrentTheme.Link.Foreground.ENABLED` | `--vscode-button-background` |
| Status: ready | `JBUI.CurrentTheme.Banner.INFO_BORDER_COLOR` | `--vscode-charts-blue` |
| Status: streaming | `JBUI.CurrentTheme.Banner.SUCCESS_BORDER_COLOR` | `--vscode-charts-green` |
| Status: error | `JBUI.CurrentTheme.Banner.ERROR_BORDER_COLOR` | `--vscode-charts-red` |

### Typography

| Style | JetBrains | VS Code |
|---|---|---|
| Body | `JBUI.Fonts.label()` (system default) | `var(--vscode-font-family)`, `var(--vscode-font-size)` |
| Small (chip, footer) | `JBUI.Fonts.smallFont()` | `0.85em` of body |
| Tiny (status, hint) | `JBUI.Fonts.miniFont()` | `0.75em` of body |
| Monospace (code) | `JBUI.Fonts.create(Font.MONOSPACED, ...)` | `var(--vscode-editor-font-family)` |

## Component inventory

Each component has: **role** (what it does), **anatomy** (visual parts),
**states** (default / hover / focus / disabled / loading), **JetBrains
implementation hint**, **VS Code implementation hint**, **acceptance
criteria** (what makes it shippable).

### C-1 — Tool-window header

**Role.** Identify the surface + carry global actions.

**Anatomy.** Left: monochrome logo + "event4u" wordmark (12 px height,
muted). Right cluster: hamburger (history — v1.0 placeholder for now),
"new thread" plus icon, kebab menu (Settings + Reload sidecar).
Separator below.

**States.** Static; hover for icon buttons (subtle background fill).

**JetBrains.** Replace the `JBLabel("Sidecar: starting…")` placeholder.
Use `BorderLayout` with a `JPanel` of `BoxLayout.X_AXIS` for the right
cluster. Icon buttons via `ActionButton(action, presentation,
PLACE, JBUI.size(20, 20))`. Use `AllIcons.General.Add`,
`AllIcons.Actions.More`, `AllIcons.General.Settings`.

**VS Code.** `<header class="event4u-header">` with two flex children;
SVG icons inlined (no remote fetch — CSP-safe).

**Acceptance.**
- Header is 36 px tall.
- Logo + wordmark on the left, three icon buttons on the right, all
  vertically centred.
- Icon-button hit area is ≥ 24 px even though the icon is 16 px.
- Hover on an icon button fills the background with the surface-inset
  colour at 50 % opacity.
- Keyboard: Tab moves between icons; Enter triggers; ESC closes any
  open menu.

### C-2 — Welcome / empty-state card

**Role.** Fill the empty chat with a clear "what is this and how do I
start" message. Disappears the moment the first message lands.

**Anatomy.** Centred horizontally + vertically in the available space.
Card body: 320 px max-width, `radius.card`, 1 px border, soft elevation.
Inside: 16 px sparkle icon + "New event4u thread" title (medium weight) +
single-line tagline ("Pick a command with `/`, attach context with `@`,
or just ask.") in muted text.

**States.** Visible when `messages.isEmpty()`; hidden once any message
arrives.

**JetBrains.** A `JBPanel` with `GridBagLayout` (centred). Inside, a
nested `JBPanel` with `BoxLayout.Y_AXIS` and `JBUI.Borders.empty(16)`.
The card border via `JBUI.Borders.customLine(separatorColor, 1)` +
`CompoundBorder` with empty padding.

**VS Code.** `<div class="event4u-welcome">` centred via flexbox on
the messages container's empty state.

**Acceptance.**
- Card appears only when `messages.isEmpty()`.
- Visual centre stays vertically aligned even as the tool window resizes.
- Card never overflows the tool window (drops min-width before max-width).
- Tagline mentions the two affordances (`/` commands, `@` context).

### C-3 — Composer container

**Role.** The single most important component. Everything below the
message list is the composer. Augment-parity demands one bordered
container with three rows.

**Anatomy.** Outer `<section>`/`JBPanel` with `radius.card`, 1 px
border, `space.sm` padding. Three vertical rows:

```
┌─ Composer container ────────────────────────────┐
│ [@] [/] [⚠] [context-chip] [file-chip ×] [more]│  ← row 1: chip rail
├──────────────────────────────────────────────────┤
│  Multi-line text input (auto-grow up to N rows) │  ← row 2: text input
├──────────────────────────────────────────────────┤
│ [Auto ●]  [💬]  [☂ Opus 4.7]      [📎] [✨] [➤]│  ← row 3: action bar
└──────────────────────────────────────────────────┘
```

**States.**
- Idle: rows visible, send icon enabled when input has text.
- Streaming: send icon replaced by stop square (red accent).
- Focused: 1 px accent border + subtle inner glow (focus-within in CSS,
  `FocusListener` flipping a flag + repaint in Swing).
- Drag-over: dashed accent border + "Drop to attach" overlay (see C-7).

**JetBrains.** Custom `JPanel` with `BoxLayout.Y_AXIS`. The outer panel
holds the three rows. Border via custom `Border` impl that draws a
2 px-tall rounded rect (Java2D `RoundRectangle2D`); switch border colour
when `hasFocus()` returns true on any descendant.

**VS Code.** `<form class="event4u-composer">` with `padding`,
`border`, `border-radius`, and a `:focus-within` accent rule.

**Acceptance.**
- Three rows visible at all times (row 1 + 3 may collapse to icon-only
  when narrow; row 2 always visible).
- Container has rounded corners and a 1 px border.
- Focus highlight engages when ANY descendant is focused, NOT only the
  textarea.
- Container is the only chrome around the composer — no extra
  scrollbars, no extra panels, no extra borders.

### C-4 — Mode pill (Auto / API / CLI)

**Role.** Switch backend mode. Replaces the current `JButton("API")`.

**Anatomy.** Pill body: 24 px tall, `radius.chip`, `space.sm`
horizontal padding. Inside: 6 px round dot (colour reflects state) +
label text (`Auto`, `API`, `CLI`). When in `Auto`, dot is muted +
label suffix is the resolved mode in parentheses (`Auto (CLI)`).

**States.** Three values: `auto`, `api`, `cli`. Click cycles
auto → api → cli → auto. Hover: slight background fill.

**JetBrains.** Custom `JLabel` subclass with rounded border + click
listener. Cannot just use `JButton` — the chrome is wrong. Use
`Component.setBorder(RoundedBorder(...))` + paint a small filled circle
via `Graphics2D`.

**VS Code.** `<button class="event4u-mode-pill">` with `:hover` and
`:focus-visible` rules; circle via `::before` pseudo-element.

**Acceptance.**
- Pill is 24 px tall, NOT a default platform button height.
- Dot colour matches the surface — green when CLI active, blue when
  API active, muted when in Auto.
- Click cycles state; keyboard `Enter` / `Space` cycles too.
- Tooltip on hover: full text "Mode: <name>. Click to cycle Auto → API → CLI."

### C-5 — Model pill (claude-sonnet-4-6 ▾)

**Role.** Show the active model + open a model picker. Replaces the
silent "(no model)" in the statusbar.

**Anatomy.** Pill: 24 px tall, `radius.chip`, `space.sm` horizontal
padding. Inside: 14 px model icon (a generic sparkle) + truncated model
slug + 8 px chevron-down. Truncation example: `claude-sonnet-4-6 ▾`
shows in full; `claude-3-5-sonnet-20240620` truncates to
`…-sonnet-…20 ▾` if the composer is narrow.

**Interaction.** Click opens a popup menu listing every model from the
Pricing Book (T-206). Each row: model id + small price annotation
(`$3 / $15 per Mtok`). Highlight the active model. Keyboard arrows +
Enter select; ESC closes. Picking a model writes through to
`AgentSettings.defaultModel` AND updates the per-conversation override
(T-407 picks up the override on the next turn).

**JetBrains.** `JBPopupFactory.getInstance().createListPopup(...)` —
the same API that powers IntelliJ's own choose-from-list flows.

**VS Code.** Native `<select>` styled to look like a pill via CSS
`appearance: none` + custom chevron. (A custom popup would need a
focus-trap; native select is good enough for MVP and ships free
keyboard support.)

**Acceptance.**
- Pill always shows the currently active model (no `(no model)`
  state — falls back to `AgentSettings.defaultModel`).
- Popup lists every model from the Pricing Book v0 (3 models).
- Picking a model updates the chat header AND the statusbar widget
  on the next refresh.
- If the Pricing Book ever ships zero models, the pill falls back to
  showing `…` with a tooltip "No models configured."

### C-6 — Icon-action buttons (paperclip, sparkle, send/stop)

**Role.** Replace `JButton("Send")` / `JButton("Stop")` with
borderless icon buttons.

**Anatomy.** 28 px square hit area, 16 px icon centred. No border by
default. On hover, fill with surface-inset at 50 % opacity. On press,
fill with accent at 20 % opacity.

**Icons.**
- 📎 paperclip (`AllIcons.General.Attachment`) — opens file picker.
- ✨ sparkle (`AllIcons.Actions.IntentionBulb`) — opens command picker
  (`/` shortcut).
- ➤ send (`AllIcons.Actions.NextOccurence`-style triangle) — sends the
  current turn. Disabled when input is empty.
- ⏹ stop (`AllIcons.Actions.Suspend`) — replaces send while streaming;
  fires `CancellationToken.requestCancel()`.

**JetBrains.** Use `ActionButton` with a custom `Presentation`. NOT
`JButton` — its chrome cannot be removed without subclassing painters.

**VS Code.** `<button class="event4u-icon-btn">` with inline SVG; CSS
hover + active states.

**Acceptance.**
- Buttons render as icons only — no text, no border, no focus rectangle.
- Hit area is ≥ 28 px square so they're tap-friendly.
- Tab order: paperclip → sparkle → send (skips stop when send is shown
  and vice versa).
- Tooltips: "Attach file or image (Cmd+/)", "Insert command (/)", "Send
  message (Enter)", "Stop streaming (Esc)".

### C-7 — Context-chip rail (row 1 of the composer)

**Role.** Mirror Augment's chip surface. Each chip is one of:
- `@` mention: file / symbol / agent-config artefact the model should
  read on the next turn.
- `/` command: a chosen slash command that will run on send.
- Attached file or image (from drag-n-drop or paperclip).

**Anatomy.** Horizontal flow with wrap. Each chip: 22 px tall, pill
shape (`radius.chip`), 14 px leading icon, label, optional `×` to
remove. Chip colour reflects type:
- `@` chips: muted background, default text.
- `/` chips: accent background, white text.
- File / image chips: muted background, leading file-type icon.

The leftmost two buttons in this row are inline `@` and `/` action
chips (clicking opens the mention / command picker respectively).
Then the actual content chips. Finally, a "more" overflow chip when
the row would otherwise wrap to a 3rd line.

**JetBrains.** `JPanel` with `WrapLayout` (the community-known custom
`FlowLayout` that wraps). Chip = custom `JLabel` subclass with rounded
border + click listener for the `×` hit-zone.

**VS Code.** `<div class="event4u-chips">` with `flex-wrap: wrap`.
Each chip = `<span class="event4u-chip event4u-chip--{type}">`.

**Acceptance.**
- Row is hidden when there are zero chips (composer is two rows tall
  in that case — chip rail collapses).
- Row 1 caps at 2 visual lines; further chips collapse into a `+N more`
  overflow chip that opens a popup listing them.
- Drag-n-drop a file onto the composer creates a file chip (see C-8).
- `×` on a chip removes it and re-focuses the textarea.

### C-8 — Drag-n-drop + paperclip file/image attachment

**Role.** Augment shows files and images attached **inline** in the
chip rail. Same here. Drag a file from the IDE's project view, or
drop image bytes from outside the IDE, or click the paperclip to open
a file picker.

**Anatomy.** While dragging over the composer: the composer container
gets a dashed accent border + an overlay text "Drop to attach". Once
the drop lands, a file chip is added (C-7). Image-paste from the
clipboard does the same.

**Behaviour.** Files become tool calls on the next turn — the agent
receives a `read_file(path)` synthetic input. Images go through a
separate `attach_image` path (deferred to v1.0 — for v0, dropping an
image creates a chip + a TODO marker until image attachments land).

**Storage.** Attachments are stored in
`.event4u-agent/attachments/<conversation-id>/` and referenced by chip
metadata. Cleared on conversation end.

**JetBrains.** `TransferHandler` on the composer panel; handles
`DataFlavor.javaFileListFlavor` (project-view drops) and
`DataFlavor.imageFlavor` (clipboard image). Tester subclass for unit
tests.

**VS Code.** Webview-side: `drop` event handler on the composer
container. The webview's CSP forbids `data:` images directly; route
the bytes through the host via `postMessage` and write them to the
attachments dir, then add the chip referencing the path.

**Acceptance.**
- Dragging any text file from the IDE project view over the composer
  creates a chip.
- Pasting an image from the clipboard (Cmd+V) creates an image chip
  (the v0 image chip is a placeholder — surfaces "Image attachments
  land in v1.0 Sprint 13"; the chip is still rendered).
- Clicking the paperclip opens the OS file picker.
- Removing a chip removes the attachment from the next turn's
  payload.

### C-9 — Status indicator (replaces stray red dot)

**Role.** Surface sidecar health at a glance. The current red dot is
visually noisy + placed in the wrong region.

**Anatomy.** A 6 px round dot embedded in the mode pill (C-4) — NOT a
free-floating element. Colour reflects state: green = streaming, blue
= ready, red = sidecar error.

Same dot also appears in the statusbar widget (C-10) as a 6 px prefix
to the model + cost text.

**JetBrains.** Move `StatusDot` from a top-bar component into the
mode pill's icon slot.

**VS Code.** CSS `::before` pseudo-element on the mode pill.

**Acceptance.**
- No standalone status dot anywhere — every status indicator is
  embedded in a labelled control.
- Colour change happens within 100 ms of the underlying state change.

### C-10 — Statusbar widget polish

**Role.** Refine the existing T-207 widget to match the chat header.

**Anatomy.** `<status-dot> <model-pill-text> · $<usd> today`.
Click opens the chat tool window (it does already). Hover shows a
breakdown: "<N> conversations today · <input-tok> in · <output-tok>
out · $<usd> · Daily cap remaining: $<remaining>".

**JetBrains.** Update `AgentStatusBarWidget.getText()` and add a
custom `JComponent` presentation (not just `TextPresentation`) so the
status dot can be drawn alongside the text.

**VS Code.** `vscode.window.createStatusBarItem` with `text` + `$(...)`
codicons. Use `$(circle-filled)` with theme colour.

**Acceptance.**
- Widget never shows "(no model)" — falls back to
  `AgentSettings.defaultModel`.
- Hover tooltip shows the breakdown listed above.
- Click activates the chat tool window.

## Per-platform implementation notes

### JetBrains (Swing) — anti-patterns to AVOID this time

- ❌ `JButton(...)` for anything except modal-dialog actions. Use
  `ActionButton` (icon) or custom `JLabel` (pill).
- ❌ `JBLabel("...")` floating alone in the tool window. Every label
  belongs inside a labelled section.
- ❌ Default focus rectangle (the thick blue border around `API`).
  Subclass borders or use `Component.setFocusPainted(false)`-equivalent
  patterns.
- ❌ `BorderLayout` with no padding. Always wrap in `JBPanel` with
  `JBUI.Borders.empty(...)`.
- ❌ `GridLayout` for the chip rail. Use `FlowLayout(LEFT, hgap, vgap)`
  or the community `WrapLayout` for proper wrapping.

### VS Code (webview) — CSS architecture

- One stylesheet shipped inline in `chat-html.ts` (CSP-friendly).
- All colours via `var(--vscode-*)`. No hex codes outside the variable
  fallbacks.
- Use CSS Grid for the composer 3-row layout, NOT flexbox-in-flexbox
  nesting.
- All icons inline SVG (no external requests; CSP `img-src 'self'`
  only).
- `:focus-visible` for keyboard focus rings; never `:focus` (mouse
  doesn't get a ring).

## Phase 1 — Spec lock + reference snapshots

Before writing any code, lock the spec so the implementation pass can't
drift.

- [ ] **Step 1.** Re-screenshot Augment with the composer in three states:
  (a) empty chat, (b) one user message, (c) streaming response with a
  tool call. Save to `agents/tmp/augment-{a,b,c}.png` (gitignored).
- [ ] **Step 2.** Annotate one Augment screenshot with the C-1 .. C-10
  region labels (image-edit out of scope for the agent — the human marks
  it; agent records "annotated screenshot exists" as the gate).
- [ ] **Step 3.** Council R3 sanity-check the spec — feed this file +
  Augment screenshots to the council and ask "any missing component
  or contradictory acceptance criterion?". Capture verdict at
  `agents/evidence/analysis/ui-design-council-2026-MM-DD.json`.
- [ ] **Step 4.** Fold the council's findings back into this file before
  any implementation begins.

**Exit gate.** This file is finalised; reference screenshots exist; the
council pass found no blockers.

## Phase 2 — Visual primitives library

Build the smallest shareable surface so the components don't reinvent
the wheel.

### JetBrains

- [ ] **Step 1.** `clients/jetbrains/src/main/kotlin/de/event4u/agent/
  ui/RoundedPanel.kt` — custom border + paint hook for `radius.card`
  / `radius.chip` containers. Unit test: paint into a `BufferedImage`,
  assert the corner pixels.
- [ ] **Step 2.** `ui/IconButton.kt` — borderless `ActionButton`
  factory with hover + press painters wired. Unit test: presentation
  has no border, hit area ≥ 28 px.
- [ ] **Step 3.** `ui/Chip.kt` — `JLabel` subclass with rounded
  border, optional leading icon, optional trailing `×` (with hit-zone
  callback). Three variants (`@`, `/`, `file`).
- [ ] **Step 4.** `ui/ModePill.kt` — exact spec from C-4. Unit test
  for state cycling.
- [ ] **Step 5.** `ui/ModelPill.kt` — exact spec from C-5. Unit test:
  popup contents come from a `PricingBook` instance.
- [ ] **Step 6.** `ui/WelcomeCard.kt` — exact spec from C-2. Unit
  test: hidden when `messages.isEmpty == false`.
- [ ] **Step 7.** `ui/Theme.kt` — wrap every `JBUI.CurrentTheme.*`
  access from the C-rules above so future Compose migration touches
  one file.

### VS Code

- [ ] **Step 8.** `clients/vscode/src/webview/components/{Chip,
  ModePill, ModelPill, IconButton, WelcomeCard}.ts` — vanilla DOM
  factory functions returning `HTMLElement`. Vitest snapshot tests
  via happy-dom.
- [ ] **Step 9.** `clients/vscode/src/webview/theme.css.ts` — inline
  CSS export that the webview HTML embeds. Centralises spacing
  tokens + colour roles.

**Exit gate.** Every component above renders standalone in a unit test
or a happy-dom snapshot. No component imports from `ChatPanel` /
`chat-app` yet — they're pure primitives.

## Phase 3 — Composer container

Assemble the primitives into the C-3 three-row composer.

- [ ] **Step 1.** JetBrains: `chat/Composer.kt` replaces the bare
  textarea + Send/Stop buttons in `ChatPanel`. Three rows wired:
  chip rail (C-7), input area, action bar (C-4 + C-5 + icon buttons).
- [ ] **Step 2.** VS Code: `webview/components/Composer.ts` does the
  same; the chat-html.ts embed grows by ~15 lines of CSS for the grid.
- [ ] **Step 3.** Focus-within highlight wired on both platforms.
- [ ] **Step 4.** Keyboard: Enter sends, Shift+Enter inserts newline,
  Cmd+/ opens command picker, Cmd+@ opens mention picker, ESC stops a
  streaming turn (verified across both platforms — see C-3 keyboard
  acceptance).

**Exit gate.** Composer renders in both platforms with all three rows
collapsed-and-expanded states; keyboard contract from C-3 honoured.

## Phase 4 — Drag-n-drop + attachment plumbing (C-8)

- [ ] **Step 1.** JetBrains: `TransferHandler` on the composer accepts
  `javaFileListFlavor` + `imageFlavor`. Each drop adds a file chip.
- [ ] **Step 2.** VS Code: webview `drop` + `paste` handlers; bytes
  routed through `postMessage` to the host extension, which writes to
  `.event4u-agent/attachments/<conv-id>/` and posts back the path.
- [ ] **Step 3.** Attachments referenced in the next turn payload —
  agent receives a synthetic `read_file(path)` for text files, and a
  placeholder for images ("Image attachment placeholder — v0 doesn't
  forward image bytes to the LLM; v1.0 Sprint 13 lands this").
- [ ] **Step 4.** Unit test the attachment storage helper (host side,
  Vitest + temp dir).

**Exit gate.** Drag a markdown file from the project view onto the
composer in both platforms → chip appears → sending the turn carries
the file content.

## Phase 5 — Status surfaces (C-9, C-10) + empty state (C-2) + header (C-1)

- [ ] **Step 1.** Move the status dot from the top-left of the tool
  window into the mode pill (both platforms).
- [ ] **Step 2.** Statusbar widget upgraded to draw a dot prefix +
  fall back to `AgentSettings.defaultModel` instead of `(no model)`.
- [ ] **Step 3.** Empty-state welcome card visible when `messages.isEmpty`.
- [ ] **Step 4.** Header (C-1) wired with the three icon actions
  (history placeholder, new thread, kebab menu).

**Exit gate.** Side-by-side screenshot with Augment shows: no
free-floating dots, no `(no model)`, an empty state in the middle, and
a real header at the top.

## Phase 6 — Manual side-by-side parity check

The work above is testable in CI for compilation, lint, and component
unit tests — but the visual parity check is a human task.

- [ ] **Step 1.** Re-launch sandbox PhpStorm with the plugin; capture
  `agents/tmp/plugin-after-{empty,one-message,streaming}.png`.
- [ ] **Step 2.** Re-launch VS Code Extension Host; capture
  `agents/tmp/plugin-vscode-{empty,one-message,streaming}.png`.
- [ ] **Step 3.** Lay out a 3 × 3 grid (Augment / JetBrains / VS Code
  × three states) in `docs/UI_PARITY.md` with pixel-rough notes on
  remaining gaps.
- [ ] **Step 4.** For each remaining gap, decide: ship as-is (note in
  UI_PARITY.md), open a follow-up ticket (`road-to-v1-0.md`), or fix
  inline before merging the design PR.

**Exit gate.** UI_PARITY.md exists and shows < 5 cosmetic gaps per
platform. Each gap has a disposition.

## Acceptance criteria — design overall

- [ ] No `JButton` in the chat surface except inside modal dialogs.
- [ ] No free-floating status dots.
- [ ] No `(no model)` text anywhere.
- [ ] No default-Swing chrome (focus rectangles, beveled borders,
  metallic gradients).
- [ ] Composer container is the only chrome around the composer.
- [ ] Mode pill cycles auto → api → cli on click.
- [ ] Model pill opens a picker with the Pricing Book entries.
- [ ] Drag-n-drop a file into the composer produces a chip; chip survives
  send; send delivers the file content as a synthetic tool call to the
  agent.
- [ ] Empty chat shows the welcome card; first message hides it.
- [ ] Side-by-side with Augment, no reviewer says "your plugin looks
  cheap" with a straight face.

## Notes

- **Roadmap plans work**, not a release. No version / tag / commit steps.
- **Reference screenshots are local-only** (`agents/tmp/` is gitignored).
  The acceptance criteria above are written so a human reviewer can
  verify them from running plugins, not from screenshots in the repo.
- **Cross-reference.** Predecessor: `road-to-mvp-ui-finish.md`. Sibling:
  `road-to-mvp.md`. Successor: `road-to-v1-0.md` Sprint 13 (UI polish
  beyond MVP parity).
- **Why not Compose now?** The council that picked Swing for MVP still
  stands (no Compose-in-IntelliJ production references, jewel pre-1.0).
  This roadmap closes the gap to Augment **with Swing**. Compose
  migration is a v1.0 evaluation when jewel 1.0 lands.
- **What about Augment-style Tasks / Edits tabs?** Out of scope (see
  Context). Augment's task tracker maps to our v1.0 multi-step agent
  loop (Sprint 7); the edits history maps to Sprint 6 multi-file edit.
  This roadmap delivers ONE clean chat surface, not three.
- **Why is this so detailed?** Because PR #6 shipped a "Swing default-
  chrome chat" and the user's response was "Mist". The spec needs to
  be specific enough that the next implementation pass can't drift back.
