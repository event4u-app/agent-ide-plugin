---
applyTo: "**"
description: When the user wants a critical review of uncommitted changes — types "/review-changes", "review the diff", "code review the changes", "be brutal", "poke holes". Runs four judge lenses (bug-hunter, code-quality, test-coverage, security-auditor) plus optional architecture lens.
---

# /review-changes — multi-judge diff review

Compiled from `@event4u/agent-config/.agent-src/commands/review-changes.md`.

## When this fires

User intent: "/review-changes", "review my diff", "code review this", "be brutal about this", "do-and-judge".

## Steps

### 1. Capture the diff
```bash
git diff HEAD                # working tree vs HEAD
git diff --cached            # staged
git diff <base>...HEAD       # full branch diff if base named
```
Default: `git diff HEAD`.

### 2. Run the four judges sequentially

**Judge 1 — bug-hunter (correctness):** off-by-one · null-safety · edge cases · type coercion · races · error paths fail-closed-or-open · hidden input-shape assumptions. Output: file:line + severity.

**Judge 2 — code-quality (readability):** naming carries meaning · single responsibility · DRY (missed abstractions) · dead code / unused params / leftover debug · mismatch with codebase conventions.

**Judge 3 — test-coverage (assertions):** tests proportional to new behavior · negative cases tested, not just happy path · over-mocking (testing mock not unit) · regression test for bug fix included?

**Judge 4 — security-auditor (abuse cases):** auth/authz silent permission loosening · injection / XSS / path traversal · secrets in diff (.env, tokens) · new external HTTP to vetted endpoints · file/shell ops with user-controlled paths.

**Judge 5 — architecture (optional, ≥ 5 files OR cross-module):** boundary breaks · dependency direction · service-contract changes for consumers.

### 3. Synthesize
Numbered list, **critical** first (bug/security), then quality/test-coverage, finally nit. Each item:
```
[severity] file:line — <finding>
  fix-sketch: <one sentence>
```

### 4. Close prompt
Three options: 1) apply fixes (equivalent to /simplify) · 2) post as PR comments (only if PR exists) · 3) just stop (user triages).

## Forbidden

- Soft "looks good overall" verdicts without naming a finding.
- Praising the diff before listing issues (per `direct-answers` no-flattery).
- Auto-applying fixes (Step 4 option 1) without explicit user pick.
- Posting PR comments (Step 4 option 2) without explicit user pick — per `no-pr-progress-comments` rule.
