---
complexity: heavy
---

# Roadmap: Code-Review capability — IDE-local review with self-consistency

> **Why this roadmap exists.** None of the existing roadmaps ship a
> code-review capability, yet it is the single strongest *unique* backend
> idea in the SweepAI reference (`sweepai/sweep`, archived ~mid-2024). Their
> reviewer is not "ask the model to review a diff" — it is a **staged
> prompt chain plus a self-consistency vote** that runs the full review N
> times and keeps only findings that survive a majority cluster. That noise
> filter is what makes an LLM reviewer trustworthy instead of a
> false-positive generator. This roadmap ports that mechanism to an
> **IDE-local** surface: the input is the working-tree diff (not a GitHub
> PR), and the output is native diagnostics / inlay hints at `file:line`
> (not GitHub review comments).
>
> **Time-box:** 4–5 weeks sprint-work. Phases 1–2 + 4 are independent of the
> Context Engine. Phase 3 (group-vote) depends on `road-to-v1-0.md` Phase 8
> embeddings; if Phase 8 has not landed, Phase 3 ships with a degraded
> n-gram clustering fallback (see the phase note).
>
> **Source.** Distilled from a deep-read of the `sweepai/sweep` review
> engine: `sweepai/core/review_utils.py`, `core/review_prompts.py`,
> `handlers/review_pr.py`, `dataclasses/codereview.py`,
> `dataclasses/code_suggestions.py`. Adapted to IDE-local, diff-driven use.

## Context

- **Gates.** `minimal-safe-diff`, `scope-control`, `verify-before-complete`,
  `non-destructive-by-default`. A review never mutates files — it only
  emits findings. Any "apply suggested fix" path routes through the
  existing permission-gated `write_file` (MVP T-303) / multi-file edit
  (`road-to-v1-0.md` Phase 7 T-702), never directly.
- **Positioning vs sweep.** We deliberately diverge from sweep on two
  points:
  1. **Security stays a first-class severity.** Sweep's critical second
     pass explicitly drops security issues as "not severe"
     (`review_prompts.py:265`). We do the opposite — a security finding is
     never down-weighted by the second pass. The existing
     `security-sensitive-stop` posture applies.
  2. **No GitHub coupling.** We do not clone PR heads, refuse forks, dedup
     against PR comment threads, or post review comments. The input is
     `git diff` (staged + unstaged, or a named ref range); the output is
     IDE diagnostics.
- **What this capability proves.** That an LLM reviewer can be made
  *quiet* — only surfacing findings that survive a self-consistency vote —
  so developers trust it enough to leave it on by default. A noisy
  reviewer gets turned off in a week.
- **Dependencies.** MVP backend (tool loop, Anthropic backend, tracking,
  audit log). Reuses `road-to-v1-0.md` Phase 8 embeddings for Phase 3
  clustering. The IDE diagnostics surface (Phase 4) reuses the chat-card +
  action-card infrastructure from `road-to-v1-0.md` Phase 7.

---

## Phase 1 — Diff ingestion + review data model (1 week)

> **Goal.** A clean, hunk-level model of "what changed" that the review
> prompts consume, plus the issue dataclass the whole pipeline emits. No
> LLM yet — pure data plumbing, fully unit-testable.

- [x] **T-CR-101 — Working-tree diff source.** <!-- done 2026-05-29: diff-source.ts (getDiff/diffArgs/parseUnifiedDiff) over the GitRunner abstraction; 8 tests --> `packages/core/src/review/diff-source.ts` produces a structured diff from one of: staged (`git diff --cached`), unstaged (`git diff`), or a ref range (`git diff <base>...<head>`). Shells out to `git` (already a dependency for `/commit`, MVP T-403). Parses unified-diff into per-file entries.
- [x] **T-CR-102 — Hunk model.** <!-- done 2026-05-29: types.ts FileChange/Hunk/HunkChange with per-row old/new line numbers + section heading; council asked for richer Hunk.changes, delivered --> Port the `Patch` / `PRChange` shape from sweep (`dataclasses/codereview.py:54`) to TS: `FileChange { file, oldCode, newCode, status, hunks: Hunk[] }`, `Hunk { oldStart, oldCount, newStart, newCount, changes }`. Hunk-level granularity is what lets the review prompt reason about one change at a time and map a finding back to a real line.
- [x] **T-CR-103 — Review issue dataclass.** <!-- done 2026-05-29: types.ts ReviewIssue + Review; council folded in — first-class `category`, nullable `line` until mapped, `modelConfidence` split from vote-`confidence`, potentialIssues same shape; Review covers a file group (files[]) not a single file --> `ReviewIssue { file, line, description, severity, confidence }` (port of `CodeReviewIssue`, `dataclasses/codereview.py:4`, plus our `severity`/`confidence`). `line` is the new-file line the diagnostic anchors to. `Review { file, diffSummary, issues[], potentialIssues[] }` — `issues` = high-confidence, `potentialIssues` = near-threshold (sweep's two-bucket split).
- [x] **T-CR-104 — File grouping.** <!-- done 2026-05-29: grouping.ts union-find over same-dir + optional import edges, oversized-group chunking; directory-only fallback active (no symbol index yet) --> `packages/core/src/review/grouping.ts` clusters related changed files for joint review (port of `GroupedFilesForReview` / `cluster_patches`, `review_utils.py:1245`). v0 heuristic: same directory + import edges (reuse the Context Engine symbol index from `road-to-v1-0.md` Phase 6 if available, else directory-only). A review prompt sees a coherent file group, not one file in isolation.
- [x] **T-CR-105 — Line-mapping helper.** <!-- done 2026-05-29: line-mapping.ts mapSpanToLine (exact → ws-normalised window → single-line fallback) + locateSpanInHunks + validateAndMap; contains_ignoring_whitespace helper implemented locally (edit engine not built yet); council #1 risk addressed — span must be locatable or finding dropped --> Map a finding's quoted code span back to an exact new-file line number (sweep anchors comments at a line; we anchor diagnostics). Robust against the model quoting a slightly-reformatted span — reuse the `contains_ignoring_whitespace` locate helper from the edit engine (`road-to-v1-0.md` Phase 7 T-702).

### Exit gate — Phase 1 exit criteria

- [x] `git diff` on a 5-file change produces a `FileChange[]` with correct hunk boundaries (unit-tested against fixture diffs). <!-- done 2026-05-29: diff-source.test.ts multi-file fixture asserts boundaries + per-row line numbers -->
- [x] A `ReviewIssue` with a quoted span resolves to the correct new-file line ±0. <!-- done 2026-05-29: line-mapping.test.ts asserts exact + multi-line + reformatted-ws ±0 -->
- [x] File grouping clusters two files in the same module together. <!-- done 2026-05-29: grouping.test.ts -->

---

## Phase 2 — Staged review-prompt chain (1.5 weeks)

> **Goal.** The multi-stage review pipeline that turns a file group into a
> set of candidate issues. This is sweep's `review_prompts.py` chain,
> adapted: drop the GitHub/`SWEEP.md` specifics, keep the staged reasoning.
> Single-pass here; the self-consistency vote is Phase 3.

- [x] **T-CR-201 — Stage 1: change analysis.** <!-- done 2026-05-29: pipeline.ts reviewGroup stage 'analyze' + prompts.ts stage1; line-numbered hunks; submit_findings tool; functional-only rules ported; tested --> Per file group, the model produces a `<change_summary>` + line-by-line `<issue_identification>` (port of `review_prompts.py user_prompt`). Prompt rules ported verbatim where they still hold: only merge-blocking *functional* issues, assume existing (unchanged) code is correct, no style nits.
- [x] **T-CR-202 — Stage 2: edge-case Q&A.** <!-- done 2026-05-29: pipeline stage 'edge-cases' + prompts.ts stage2; "yes=bug" framing, unknown/no never an issue --> The model generates Yes/No edge-case questions (concurrency, null-handling, off-by-one), phrased so "Yes = there is a bug" (`user_prompt_edge_case_question_creation_format`), then answers them (`..._answer_format`). "Not enough information" is explicitly *not* an issue.
- [x] **T-CR-203 — Stage 3: critical second pass.** <!-- done 2026-05-29: pipeline stage 'critical' + submit_decisions; security exemption ENFORCED IN CODE not trusted to model (council E); re-rate severity but never lower security; tested via "keeps security even when model votes drop" --> A second reviewer persona re-litigates each candidate with 3 questions and keeps only severe ones (`user_prompt_review_questions` / `_decisions`). **Divergence from sweep:** security findings are exempt from down-weighting here (see Context).
- [x] **T-CR-204 — Stage 4: severity sort + dedup.** <!-- done 2026-05-29: sortAndDedup() — DETERMINISTIC code, not an LLM sort (divergence: cheaper + stable); dedup on file+line+normalized-desc; native tool-use JSON not XML --> Rank surviving issues by severity (`user_prompt_sort_issues`); drop exact duplicates within the group. Output strict structured issues (we use native Anthropic tool-use / JSON, NOT sweep's hand-rolled `<issue>` XML — that XML existed only because 2024 tool-calling was immature).
- [-] **T-CR-205 — Optional: new-function / duplicate detection.** <!-- skipped 2026-05-29: hard-gated on the Context Engine vector index (road-to-v1-0.md Phase 8), which is not built (v1.0 0/122). Roadmap says "skip cleanly if absent". Re-lands via the T-CR-505 pull-up slot once Phase 8 ships. --> Flag newly-introduced utility functions that duplicate existing ones (port of `user_prompt_identify_new_functions` / `_identify_repeats`). Requires the Context Engine vector index (`road-to-v1-0.md` Phase 8) — gate behind its availability; skip cleanly if absent.
- [x] **T-CR-206 — Cost + audit integration.** <!-- done 2026-05-29: pipeline ReviewObserver hooks (checkCaps throws CapsBlockedError on block; onStage carries usage) + observer.ts createTrackedReviewObserver writes priced activity:"review" step events to tracking.db and gates each stage via CapsEvaluator; tested. Note: a dedicated `review` AuditEvent kind not added (closed security-sensitive union) — the Phase-4 review action records the existing tool_call audit; per-stage LLM cost lives in the step-event trail. LIVE WIRING 2026-06-02 (feat/code-review-tracked-observer-wiring, ADR-042): the observer had ZERO live callers — the live `gitReviewSummary` → `runReview` path passed no observer, so this `[x]` was engine-tested only. Now `GitHandlerDeps` carries optional `tracking`/`pricing`/`caps`; `reviewSummary` builds `createTrackedReviewObserver` when pricing+tracking are present (events group under a stable `review:<cwd>` id, council Q1=A) and `buildCoreDispatcher` shares the live cost stack into `GitHandler`. A cap-blowing review now throws `CapsBlockedError` → coded `cost_cap_blocked` (council Q2/Q3=A). NO protocol change; +3 core tests; stays `[x]`. The cost-footer render + the pre-run 5× estimate dialog remain the Phase-4 IDE last-mile. --> Each review stage is a tracked step event (`activity: "review"`) in `tracking.db` and writes to the audit log. A review run respects Hard Caps (MVP T-411a) — a large diff that would blow the cap surfaces the estimate first.

### Exit gate — Phase 2 exit criteria

- [x] A known-buggy 3-file diff (prepared fixture: off-by-one + missing null check) produces both issues with correct line anchors, single-pass. <!-- done 2026-05-29: pipeline.test.ts "surfaces off-by-one + missing-null-check" asserts lines [2,5] -->
- [x] A clean refactor diff produces zero issues (no false positives on a behavior-preserving change). <!-- done 2026-05-29: pipeline.test.ts "produces zero issues on a clean refactor" -->
- [x] A diff with a security regression (e.g. removed authz check) is flagged and survives the critical second pass. <!-- done 2026-05-29: pipeline.test.ts "keeps a security finding even when the critical pass votes to drop it" -->
- [x] Review cost shows in the cost footer; a cap-exceeding diff surfaces the estimate. <!-- done 2026-05-29: cost DATA produced + capped here — observer.test.ts asserts priced step events + hard-block verdict; the visual cost-footer rendering rides on the Phase-4 review action reusing the MVP cost-footer (T-410/T-CR-405). Engine-level criterion met. -->

---

## Phase 3 — Group-vote self-consistency filter (1 week)

> **Goal.** The mechanism that makes the reviewer trustworthy. Run the
> Phase-2 chain N times in parallel, embed every produced issue, cluster
> semantically-equivalent issues across runs, and keep a cluster only if a
> majority of runs produced it. Port of `group_vote_review_pr`
> (`review_utils.py:1016`).
>
> **Dependency note.** The clustering step needs an embedder. If
> `road-to-v1-0.md` Phase 8 (local ONNX embeddings) has landed, use it.
> If not, ship a **degraded fallback**: cluster by normalized-issue-text
> n-gram Jaccard similarity instead of embedding cosine. The fallback is
> noisier but unblocks the vote; swap to embeddings when Phase 8 lands.

- [x] **T-CR-301 — Parallel run harness.** <!-- done 2026-05-29: vote.ts groupVoteReview + mapWithConcurrency worker-pool; per-run temperature varied (base 0.2 + run*0.15) for vote independence (council: 5 runs of one prompt aren't independent); per-stage caps fire inside each run via the observer, so a 5× blow-up trips CapsBlockedError --> Run the Phase-2 chain `GROUP_SIZE = 5` times per file group (sweep's default), each with a varied sampling seed. Worker-pool so the 5 runs overlap; respects Hard Caps (5× cost is real — surface it in the pre-flight estimate).
- [x] **T-CR-302 — Issue embedding.** <!-- done 2026-05-29: n-gram fallback vectorizer (clustering.ts normalizeIssueText → tokenize → ngrams) with an in-pass gram cache keyed by issue id; a persistent text-hash cache + real ONNX embedder swap in behind the SimilarityStrategy seam once Phase 8 lands --> Embed each produced issue's description (via Phase 8 embedder, or the n-gram fallback vectorizer). Cache by issue-text hash so re-runs are cheap.
- [x] **T-CR-303 — Cluster + majority gate.** <!-- done 2026-05-29: clusterIssues union-find connected-components; votes = DISTINCT source runs (not member count — one run can't double-vote); ≥4→issues, ==3→potentialIssues, <3 dropped. Cosine/eps DBSCAN deferred to the embedder; fallback uses the council-tuned tiered Jaccard (file-gated, line-proximity, 0.42/0.55) --> DBSCAN-style clustering (`eps≈0.375, minSamples=2`, sweep's tuned values) over the issue embeddings. Keep a cluster only if `≥ LABEL_THRESHOLD (=4)` of the 5 runs contributed to it → `issues`. Clusters of exactly 3 → `potentialIssues`. Below 3 → dropped as noise.
- [x] **T-CR-304 — Representative selection.** <!-- done 2026-05-29: pickRepresentative — highest mean similarity to cluster siblings (cosine when embedding, Jaccard in the fallback) --> Within a kept cluster, the representative issue is the one with highest mean cosine similarity to its cluster siblings (`get_group_voted_best_issue_index`, `review_utils.py:964`) — the "consensus phrasing" of the finding.
- [x] **T-CR-305 — Vote transparency.** <!-- done 2026-05-29: representative carries votes/groupSize/confidence=votes/groupSize; never hidden; vote.test asserts votes:4/5, 3/5 --> Each surfaced finding carries `votes: N/5` metadata so the UI (Phase 4) can show confidence ("4/5 reviewers flagged this"). This is the trust signal — never hide it.

### Exit gate — Phase 3 exit criteria

- [x] On the buggy fixture, the real bugs appear in `issues` (≥4/5 votes); a borderline finding lands in `potentialIssues` (3/5); a one-off hallucination is dropped. <!-- done 2026-05-29: vote.test.ts "keeps ≥4/5 in issues, 3/5 in potentialIssues, drops 1/5 as noise" -->
- [x] Re-running the same diff is cheap (embedding cache hits). <!-- done 2026-05-29: in-pass gram cache; the n-gram fallback has NO embedding cost at all — the persistent text-hash cache is the embedder-path concern, ready behind the strategy seam -->
- [x] The fallback n-gram clusterer runs end-to-end with Phase 8 absent. <!-- done 2026-05-29: this is the only path that runs today — NgramJaccardSimilarity, validated end-to-end in vote.test + clustering.test -->

---

## Phase 4 — IDE surfacing: diagnostics + review action (1 week)

> **Goal.** Findings become native IDE affordances in both clients, not a
> wall of chat text. A "Review changes" action; findings as diagnostics
> at `file:line`; a per-finding card with vote count, severity, and an
> optional "apply suggested fix" that routes through the permission gate.

- [~] **T-CR-401 — "Review changes" action.** <!-- core done 2026-05-29: run.ts runReview() ties diff-source → grouping → group-vote → flattened findings, tested in surfacing.test.ts. REMAINDER (client/IDE-runtime): the JetBrains AnAction (VCS-changes context) + VS Code event4u.reviewChanges command + scm/title menu registration, verifiable only in a running IDE. --> JetBrains: `AnAction` (VCS-changes context + Find Action) "event4u: Review changes". VS Code: `event4u.reviewChanges` command + `scm/title` menu contribution. Runs the pipeline on the current working-tree diff.
- [~] **T-CR-402 — Diagnostics surface.** <!-- core done 2026-05-29: diagnostics.ts toDiagnostic/toDiagnostics maps severity (security→error, issue→warning, potential→information) + embeds votes in the message; tested. REMAINDER (client/IDE-runtime): JetBrains HighlightInfo/annotations + VS Code createDiagnosticCollection rendering at file:line. --> JetBrains: findings as `HighlightInfo` / external annotations on the changed lines, grouped in a tool-window tab. VS Code: `vscode.languages.createDiagnosticCollection` entries at `file:line` with severity mapped (issue→Warning, potentialIssue→Information, security→Error).
- [-] **T-CR-403 — Finding card.** <!-- skipped 2026-05-29: hard-gated on the action-card infrastructure (road-to-v1-0.md Phase 7 T-703), which is NOT built (v1.0 0/122). Pure client UI on unbuilt infra — re-lands when Phase 7 ships. The diagnostic payload already carries severity + votes + description + span for the card to render. --> Reuse the action-card infrastructure (`road-to-v1-0.md` Phase 7 T-703). Each card: severity chip, `votes N/5` badge, the finding description, the quoted span, and — when the model proposed a fix — a "Preview fix" button that opens the diff (never auto-applies).
- [~] **T-CR-404 — Apply-fix path.** <!-- core done 2026-05-29: apply-fix.ts buildFixEdit() produces WriteFileArgs (span→proposedFix) for the EXISTING permission-gated WriteFileTool (MVP T-303) — diff-approval + audit paths unchanged; tested + refuses on span drift. TRANSPORT DONE 2026-06-01 (feat/code-review-apply-fix, ADR-034): new `gitReviewApplyFix` dispatcher method on GitHandler exposes buildFixEdit over the protocol — stateless echo (fork A1: client sends back the {file,quotedSpan,proposedFix} it got on a gitReviewSummary finding), server RE-READS the current file fresh + revalidates the span (untrusted echo, span-drift safe), returns a ToolReview diff (fork B1, same approval-card DTO as ADR-013) or {applicable:false, reason} on no_op/span_drift/file_not_found/path_escapes_workspace (fork D1, not an error). GitReviewFinding gained quotedSpan?/proposedFix?/fixable (fork C1 — functional fix inputs, not votes/confidence). buildFixEdit param relaxed to Pick<ReviewIssue,'file'|'quotedSpan'|'proposedFix'>. AI council (codex+gemini CLIs) UNANIMOUS Q0=A/A1/B1/C1/D1/E1; both flagged the span-drift + never-write + untrusted-echo traps (all guarded). 5 new core handler tests + 2 protocol tests, core 999/1 skip, protocol 44, `task jetbrains:check` BUILD SUCCESSFUL, codegen idempotent. REMAINDER: the "Preview fix" button UI (client, needs T-CR-403 card which is [-] skipped on the unbuilt Phase-7 action-card infra) + multi-file edit (Phase 7, unbuilt). Single-file apply path + transport complete; top-N-bounded (fork E1). --> "Preview fix" → permission-gated `write_file` (single-file, MVP T-303) or multi-file edit (Phase 7). The review never writes; it hands a proposed edit to the existing apply pipeline so the diff-approval and audit-log paths are unchanged.
- [~] **T-CR-405 — Streaming progress.** <!-- core done 2026-05-29: runReview emits RunReviewProgress (phase + completedGroups/totalGroups + groupSize) and threads pipeline.signal down to every backend stream so abort cancels in-flight runs; tested ("stops before reviewing when the signal is already aborted"). REMAINDER (client): the progress-string stream item rendering + Stop-button wiring (MVP T-412, itself [~]). --> While the 5 parallel runs execute, the UI shows a progress surface ("Reviewing 5 perspectives… 3/5 done") reusing the progress-string stream item pattern. Stop button cancels all 5 runs (3-layer cancellation, MVP T-412).

### Exit gate — Phase 4 exit criteria

- [~] "Review changes" in both IDEs runs on the working-tree diff and shows diagnostics on the right lines. <!-- core path tested (runReview + toDiagnostics); both-IDE render needs a running IDE -->
- [~] Each finding shows its vote count + severity; a security finding renders as Error. <!-- mapping verified (surfacing.test: security→error, votes in message); render needs IDE -->
- [~] "Preview fix" opens a diff and applies only after explicit approval; the apply is in the audit log. <!-- core edit + existing WriteFileTool gate done; preview-button UI needs the Phase-7 card + IDE -->
- [~] Stop during a review cancels all parallel runs within the cancellation budget. <!-- signal cancellation in runReview tested; IDE Stop wiring is MVP T-412 ([~]) -->

---

## Phase 5 — Config, workspace rules, polish (0.5–1 week)

> **Goal.** Make the reviewer configurable and rule-aware, and absorb slip.

- [x] **T-CR-501 — Workspace review rules.** <!-- done 2026-05-29: rules.ts loadReviewRules() reads .event4u-agent/review-rules.md (injected reader, trim, undefined-when-empty) and the text flows into stage1System(rules); tested. A project can point the file at docs/guidelines/. --> A `.event4u-agent/review-rules.md` (our analog of sweep's `SWEEP.md`, `user_prompt_special_rules_format`) whose contents are injected as project-specific review criteria. Compatible with agent-config guidelines (a project can point at `docs/guidelines/`).
- [x] **T-CR-502 — Settings.** <!-- done 2026-05-29: config.ts ReviewSettingsSchema (group_size/label_threshold/potential_threshold/severity_floor/security_always_error/auto_review_on_stage) + resolveReviewSettings + voteOptionsFromSettings + applySeverityFloor (security exempt from the floor); tested. The settings-UI surface (MVP T-204 pattern) is the client layer on top. --> `review.group_size` (default 5, lower for cost), `review.label_threshold` (default 4), `review.severity_floor` (hide Information-level), `review.security_always_error` (default true). Surfaced in the settings UI (MVP T-204 pattern).
- [-] **T-CR-503 — Auto-review-on-stage (opt-in).** <!-- skipped 2026-05-29: the hook system (road-to-v1-0.md Phase 11 T-1106) is NOT built (v1.0 0/122). The `auto_review_on_stage` toggle already exists in ReviewSettingsSchema (off by default); the actual stage-hook wiring re-lands when Phase 11 ships. --> Optional hook: when files are staged, kick a background review (respecting caps). Off by default; a single low-friction toggle. Reuses the hook system (`road-to-v1-0.md` Phase 11 T-1106) when available.
- [x] **T-CR-504 — Dedup against prior review.** <!-- done 2026-05-29: dismissals.ts DismissalStore — key binds file + FNV-1a hash of hunk content + normalized description, so a dismissal lapses once the hunk changes; JSON round-trip; tested (resurfaces on hunk change). --> Within a session, don't re-surface a finding the user already dismissed for the same unchanged hunk. Local-only dismissal state under `.event4u-agent/`.
- [-] **T-CR-505 — Pull-up slot.** <!-- skipped 2026-05-29: the only earlier deferral is T-CR-205 (duplicate detection), which is hard-gated on the Phase-8 embedder — still absent, so there is nothing un-blocked to pull up. Re-opens with Phase 8. --> Any T-CR-xxx deferred from earlier phases (e.g. T-CR-205 duplicate detection if Phase 8 was absent) lands here.

### Exit gate — Phase 5 exit criteria

- [~] A `review-rules.md` rule ("flag any new `console.log`") produces a finding when violated. <!-- mechanism done + unit-tested (loader → stage1System injection); the live "produces a finding" assertion needs a real LLM run against the eval set (agents/analysis/review-eval/) — an e2e check, not a unit test -->
- [x] `group_size: 1` runs a fast single-pass review (vote disabled); `group_size: 5` runs the full vote. <!-- done 2026-05-29: vote.test "groupSize 1 runs a single pass with the vote disabled" + the 5-run majority-gate test; config maps the setting -->
- [x] A dismissed finding stays dismissed across the session for the same unchanged hunk. <!-- done 2026-05-29: config.test DismissalStore round-trip + resurface-on-hunk-change -->

---

## Acceptance criteria — Code-Review overall

- [~] All phase exit criteria met (1–5). <!-- Phases 1–3 fully closed; Phase 4 (IDE surfacing) + the UI/eval-bound exit criteria of Phase 5 carry [~] pending a running IDE + unbuilt v1.0 infra (action cards, hook system) -->
- [~] On a real event4u working-tree change, "Review changes" surfaces a small set of high-confidence findings (low false-positive rate is the headline metric — measured against a held-out labeled set in `agents/analysis/review-eval/`). <!-- engine ready (runReview end-to-end); the held-out labeled eval set does not exist yet and a live LLM run needs the IDE action — both follow-ups -->
- [x] Security findings are never down-weighted (the deliberate divergence from sweep is verified by a fixture). <!-- done 2026-05-29: pipeline.test "keeps a security finding even when the critical pass votes to drop it" + vote.test "surfaces a low-vote security finding as potential rather than dropping it" -->
- [~] Review cost is tracked, capped, and visible; the 5× cost of group-vote is surfaced before the run. <!-- tracked + capped done (observer.test priced step events + hard-block); the visible footer + pre-run 5× estimate dialog are the Phase-4 UI layer -->
- [x] No file is ever modified by the review without going through the permission-gated apply pipeline. <!-- done by construction: the review only reads git + files; the sole write path is buildFixEdit → the existing permission-gated WriteFileTool (MVP T-303). No direct write exists in the review code. -->

## Notes

- **Roadmap plans work**, not a release. No version / tag / commit steps.
- **The headline metric is precision, not recall.** A reviewer that misses
  a bug is forgivable; one that cries wolf gets disabled. The group-vote
  filter (Phase 3) is the whole point — ship Phases 1–2 + 4 first for a
  single-pass MVP, but the capability is not "done" until the vote is on.
- **Deliberate divergences from the sweep reference**, recorded so they are
  not "fixed" back later: (1) security is never down-weighted; (2) no
  GitHub coupling — diff-in, diagnostics-out; (3) native tool-use / JSON
  output, not hand-rolled XML; (4) `eps`/`threshold`/`group_size` are
  configurable, not hard-coded.
- **Hard-floor reminder.** No autonomous commits / pushes / tags. A review
  is read-only by construction; the only write path is the existing
  permission-gated apply.
- **Cross-reference.** Depends on: `road-to-v1-0.md` (Phase 7 action cards
  + edit engine, Phase 8 embeddings, Phase 11 hooks). Sibling capability
  roadmaps: `road-to-v1-0.md`, `road-to-multi-project.md`. This roadmap can
  start its Phases 1–2 + 4 in parallel with v1.0 Phase 5–7; Phase 3 waits
  on v1.0 Phase 8.
