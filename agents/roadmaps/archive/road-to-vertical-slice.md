---
complexity: standard
---

# Roadmap: Vertical Slice — Chat → Send → Stream → Stop → Cost

> **Goal.** One thin, end-to-end strecke that actually works in both IDEs:
> open the chat, type a prompt, the sidecar streams the model's answer back
> token-by-token into the card, the **Stop** button aborts mid-stream, and the
> turn's **cost** is shown (live counter during, final figure after). This is
> the load-bearing proof that the engine (providers, agent loop, NDJSON
> transport, cost estimator) and the two client surfaces are wired to each
> other — not just unit-tested in isolation.
>
> **Why it's a separate roadmap.** The engine slices (`road-to-v1-0` Phases
> 5–14) shipped pure-core and unit-tested, but the user-visible request path —
> a `chat/send` dispatcher method, the VS Code webview `onDidReceiveMessage`
> wiring, the JetBrains controller holding a live sidecar — is still stub or
> absent. Proving the **whole** path on one minimal feature de-risks every
> larger feature in `road-to-product-readiness.md`. Per the user's own
> sequencing: spine first, breadth after.
>
> **Source.** Authored 2026-05-31 on user feedback (12-point product-readiness
> list); this roadmap is item-set #1/#2/#3/#6 reduced to the smallest working
> path. Most steps are **IDE-runtime-gated** — they need a running VS Code
> Extension-Development-Host and a JetBrains sandbox IDE, so they are executed
> by a human at an IDE, not blind-autonomously. The pure-core dispatcher work
> (Phase 1) is the exception.

## Context

- **Gates.** `minimal-safe-diff` (wire the existing engine + clients, do not
  rewrite them), `scope-control` (reuse the shipped providers / agent loop /
  cost estimator / NDJSON transport — no new framework), `verify-before-complete`
  (no `T-VS*` is marked done without fresh evidence; IDE steps need a manual
  smoke run captured in `docs/MANUAL_VERIFICATION.md`).
- **Hard dependencies (already shipped).**
  - **Providers** — `packages/core/src/llm/` (Anthropic / OpenAI / compat / Ollama), v1.0 Phase 5.
  - **Agent loop** — `packages/core/src/agent/loop.ts` (`AgentDriver`), v1.0 Phase 7.
  - **NDJSON transport + dispatcher** — `packages/protocol` envelope + `packages/core/src/server.ts` `dispatch()`; streaming is `done:false …` then `done:true` on one `messageId`.
  - **Cancellation** — `packages/core/src/llm/cancellation.ts` (abort plumbing).
  - **Cost** — `packages/core/src/cost/estimate.ts` (`CostRange`) + `cost/shadow.ts` (CLI-mode shadow cost), v1.0 Phase 7/14.
  - **Client shells** — VS Code `clients/vscode/src/extension.ts` + `webview/chat-app.ts`; JetBrains `clients/jetbrains/src/main/kotlin/de/event4u/agent/SidecarClient.kt` + `chat/ChatPanel.kt` + `chat/CostFooterFormatter.kt`.
- **Non-goals (deferred to `road-to-product-readiness.md`).** Tool-approval cards, multi-file diff review, full permission UI, daily budget, index statusbar, agent modes, context chips, packaging, onboarding wizard, git workflow. This roadmap stops at a single streamed answer with a cost figure and a working Stop.

---

## Phase 1 — Chat-RPC method in the dispatcher (pure-core)

> **Goal.** A `chat/send` request method that drives the agent loop / provider and streams assistant tokens back over the NDJSON envelope, plus a matching `chat/cancel`. Modelled on the `terminalSubscribe` streaming precedent (one `messageId`, `done:false` chunks, terminal `done:true`).

- [x] **T-VS01 — `chatSend` streaming method.** Add request/response schemas to `packages/protocol/src/schema.ts` (`{conversationId, message, providerId?, scope?}` → streamed `assistantToken` / `usage` / `done` payloads) and register in `Methods`. Codegen the Kotlin DTOs. <!-- camelCase wire payloads (ChatUsage/ChatCost/ChatTokenEvent/ChatSendResponse) decoupled from internal snake_case LlmUsage so codegen needs no @SerialName; 27 Kotlin DTOs regenerated; 20 protocol tests green. -->
- [x] **T-VS02 — `chatCancel` method.** `{conversationId}` → ack; wires to `llm/cancellation.ts` so an in-flight `chatSend` aborts cleanly and emits a final `done:true` with a `cancelled:true` marker. <!-- ChatHandler holds a Map<conversationId, CancellationToken>; chatCancel returns {cancelled} ack; partial text kept+persisted, stopReason 'cancelled'; backend-throws-on-abort treated as cancel. -->
- [x] **T-VS03 — dispatcher handler.** Extend `packages/core/src/server.ts` (or a `chat/handler.ts` it delegates to) to run the provider/agent loop for `chatSend`, stream tokens as envelopes, persist the turn via the existing `chat/` store, and attach a `usage` payload (tokens) at stream end. <!-- New chat/handler.ts (provider-direct per council fallback; AgentDriver folds in later); server.ts gained additive emit-callback dispatch; main.ts forwards emit. Dispatcher owns exactly-once terminal envelope + error-wrapping (never rejects). chat_not_configured when no handler wired. -->
- [x] **T-VS04 — cost on the turn.** On stream end, compute the turn cost via `cost/estimate.ts` (API mode) or `cost/shadow.ts` (CLI mode) and include it in the final `done` payload. Unit-test the handler end-to-end with a `FakeProvider` (no network). <!-- ChatCost{model,mode,totalUsd,isEstimate}: pricing.costFor for api (isEstimate=false), shadow estimate for cli, $0 fail-open when no/unknown pricing. 12 handler tests + 1 cost-contract protocol test. -->

### Exit gate — Phase 1

- [x] `dispatch()` handles `chatSend` + `chatCancel`; a unit test drives a full streamed turn with a fake provider, asserts token order, a final usage+cost payload, and a clean mid-stream cancel. <!-- handler.test.ts: token order, terminal usage+cost, persisted user+assistant turn, mid-stream cancel keeps partial, chat_busy on concurrent send, chat_not_configured. task ci green (protocol 21, shared 5, vscode 33, core 704). -->

**Baseline (P50):** 3–4 days. **If blocked (agent-loop coupling too deep):** ship `chatSend` against the provider directly first, fold the `AgentDriver` in as a follow-up.

---

## Phase 2 — VS Code: stream + stop end-to-end (IDE-runtime)

> **Goal.** The VS Code webview sends a prompt, renders streamed tokens live, the Stop button cancels, and the cost footer fills in.

- [~] **T-VS05 — host wiring.** Replace the `onDidReceiveMessage` stub in `clients/vscode/src/extension.ts` with a `chatSend` call through `sidecar-client.ts`; forward each streamed envelope to the webview via `postMessage`. <!-- DONE 2026-05-31: `SidecarClient.requestStream` (separate streaming-correlation map, terminal-resolves) + a host-side `ChatController` (chat-controller.ts) bridge webview send/stop/toggle to streaming chatSend/chatCancel, pushing a snapshot per token. Unit-tested (chat-controller.test.ts + sidecar-client requestStream integration). ADR-012. -->
- [~] **T-VS06 — webview stream render.** `webview/chat-app.ts` appends `assistantToken` chunks to the active card live; shows a spinner while streaming; renders the final answer on `done`. <!-- Client logic shipped 2026-05-31 (ChatController pushes a fresh snapshot per token; chat-app re-renders + mode-pill streaming dot). Visual DOM render needs an Extension-Development-Host smoke run. -->
- [~] **T-VS07 — Stop button.** A Stop control in the streaming card fires `chatCancel`; the partial answer is kept, the spinner clears, the card marks "stopped". <!-- Logic shipped 2026-05-31 (ChatController.stop → chatCancel; unit-tested). Webview Stop button already posts {kind:'stop'}; visual confirm needs EDH smoke. -->
- [~] **T-VS08 — cost footer.** Live token counter during the stream; final cost figure from the `done` payload after. <!-- Logic shipped 2026-05-31 (ChatController fills costFooter from the done payload usage+cost). Visual render needs EDH smoke. -->

### Exit gate — Phase 2

- [~] In the Extension-Development-Host: open chat → send → tokens stream into the card → Stop aborts mid-stream → cost footer shows the final figure. Captured in `docs/MANUAL_VERIFICATION.md`. <!-- Deferred: requires a human Extension-Development-Host smoke run (no EDH/GUI in autonomous env). Checklist authored in docs/MANUAL_VERIFICATION.md § Vertical slice → Phase 2. -->

**Baseline (P50):** 1 week. **If blocked (webview ↔ host message lag):** buffer tokens host-side and flush on a rAF tick.

---

## Phase 3 — JetBrains: stream + stop end-to-end (IDE-runtime)

> **Goal.** The same working path in the JetBrains sandbox IDE.

- [~] **T-VS09 — controller holds the sidecar.** `SidecarClient.kt` keeps a persistent connection for the tool-window lifetime; `chat/ChatPanel.kt` sends `chatSend` and consumes the streamed envelopes. <!-- DONE 2026-05-31: `SidecarClient.requestStream` (streaming-correlation map) + a real `SidecarChatController` (replaces PlaceholderChatController) holding a persistent client per tool-window, streaming on a daemon thread, disposed with the content (no orphan sidecar). `gradle check` green (compile + ktlint + detekt + tests). ADR-012. -->
- [~] **T-VS10 — stream render + Stop.** `ChatModel.kt` appends streamed tokens to the active message; a Stop action fires `chatCancel`; partial answer kept, status set to "stopped". <!-- Logic shipped 2026-05-31 (SidecarChatController appends tokens via copy() + onModelChange; Stop → chatCancel on its own thread; ChatPanel.renderModel self-marshals to the EDT). Swing visual confirm needs `task jetbrains:runIde`. -->
- [~] **T-VS11 — cost footer.** Wire `CostFooterFormatter.kt` to the live token counter + the final cost from `done` (pin `Locale.US` for number formatting per the known JetBrains gotcha). <!-- Logic shipped 2026-05-31 (controller builds CostFooter from the done payload). Swing render + Locale.US formatting confirm needs runIde smoke. -->

### Exit gate — Phase 3

- [~] In the JetBrains sandbox (`task jetbrains:runIde`): open the tool window → send → tokens stream → Stop aborts → cost footer shows the figure. Captured in `docs/MANUAL_VERIFICATION.md`. <!-- Deferred: requires JDK 17 + a human JetBrains sandbox smoke run. Checklist authored in docs/MANUAL_VERIFICATION.md § Vertical slice → Phase 3. -->

**Baseline (P50):** 1 week. **If blocked (JCEF vs Swing render):** render into the existing `ChatMessageRenderer` Swing path, defer JCEF.

---

## Phase 4 — Cost minimal, both surfaces consistent

> **Goal.** One cost contract both clients render identically — no per-client cost math.

- [~] **T-VS12 — shared cost payload.** The `usage`/`cost` shape in the `done` payload is the single source; both clients only format it. A protocol test pins the shape; both client formatters consume it. <!-- Core done: ChatCost{model,mode,totalUsd,isEstimate} pinned by a protocol test (schema.test.ts) — exactly four fields, no per-client math. Client-formatter consumption is IDE-gated (Phase 2/3). -->
- [x] **T-VS13 — live vs final reconciliation.** The live counter is an estimate; the final figure is authoritative. Document the delta so a jumpy counter is not read as a bug. <!-- Documented in ADR-010 §5 + the schema.ts doc comment + docs/MANUAL_VERIFICATION.md § Vertical slice → Phase 4: live counter = estimate, done-payload totalUsd = authoritative, jumpy counter is expected not a bug. -->

### Exit gate — Phase 4

- [~] The same streamed turn shows the same final cost in VS Code and JetBrains (within the documented estimate delta). <!-- Deferred: requires both IDE surfaces rendering (Phases 2/3). The shared cost contract is pinned so both clients hit one target. -->

**Baseline (P50):** 2–3 days.

---

## Acceptance criteria — vertical slice

- [~] Open chat → send a prompt → the sidecar streams the answer token-by-token → Stop aborts mid-stream → the turn's cost is shown — working in **both** VS Code and JetBrains. <!-- Core path proven end-to-end in unit tests; both IDE surfaces are IDE-runtime-gated (Phases 2/3). -->
- [x] The streamed turn is persisted via the existing `chat/` store (survives reopen). <!-- ChatHandler persists user + assistant (incl. partial-on-cancel) turns; asserted in handler.test.ts. -->
- [~] Manual smoke runs for both IDEs captured in `docs/MANUAL_VERIFICATION.md`. <!-- Checklists authored (§ Vertical slice → Phase 2/3/4); human IDE session signs the verification log. -->
- [x] `road-to-product-readiness.md` is the next active roadmap. <!-- DONE 2026-06-01: road-to-product-readiness is the active successor roadmap (open, in progress) and is advanced in this same PR via the `onboardingDetect` seam (T-PRD12, ADR-033). The vertical-slice spine is proven end-to-end in unit tests; the breadth work now lives in product-readiness. -->

---

## Archived with deferred IDE verification (2026-06-01)

This roadmap reached `count_open == 0` and is archived. Its `[~]` items are
**not** lost — they are IDE-runtime smokes (VS Code Extension-Development-Host
and JetBrains sandbox) whose engine + client logic shipped and is unit/CI-tested
(ADR-010, ADR-012). They are tracked for a human IDE session in:

- `docs/MANUAL_VERIFICATION.md` § Vertical slice → Phase 2 / Phase 3 / Phase 4 — the smoke checklists.
- `road-to-product-readiness.md` — the active roadmap that owns the breadth + the same two IDE surfaces (cards, cost footer, mode/scope, packaging).

Per the AI-council Iron-Law-3 resolution (2026-06-01, codex + gemini UNANIMOUS):
keep these in the archive with the handoff recorded here rather than holding the
roadmap open waiting on a GUI session that the autonomous environment cannot run.
Deferred `[~]` items, by phase:

- **Phase 2 (VS Code):** T-VS05/06/07/08 + exit gate — host wiring done, webview DOM render needs an EDH smoke.
- **Phase 3 (JetBrains):** T-VS09/10/11 + exit gate — controller + stream/stop done, Swing render + `Locale.US` cost formatting need a `runIde` smoke.
- **Phase 4 (cost):** T-VS12 + exit gate — shared cost contract pinned by a protocol test; both clients render it identically once Phases 2/3 land.
- **Acceptance:** the full both-IDE smoke + the captured `docs/MANUAL_VERIFICATION.md` sign-off.
