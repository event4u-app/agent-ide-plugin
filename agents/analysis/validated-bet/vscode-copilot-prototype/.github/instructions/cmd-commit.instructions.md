---
applyTo: "**"
description: When the user wants to commit changes — types "/commit", "commit my changes", "save this to git", "create commits for these changes", or after completing a logical unit of work and asking what's next. Splits dirty working tree into logical commits following Conventional Commits.
---

# /commit — split-and-confirm flow

Compiled from `@event4u/agent-config/.agent-src/commands/commit.md`.

## When this fires

User intent: "commit my changes", "save this", "create commits for these changes", explicit `/commit`. **NEVER** fires from your own initiative — commit is the user's call (per `commit-policy` Iron Law in `copilot-instructions.md`).

## Steps

### 1. Detect uncommitted changes
Run `git status --porcelain` + `git diff --stat`. Clean working tree → tell user "nothing to commit" and stop.

### 2. Split into logical chunks
Group hunks by **concern**, not by file:
- Feature additions → `feat(scope): …`
- Bug fixes → `fix(scope): …`
- Refactors → `refactor(scope): …`
- Docs → `docs(scope): …`
- Config / tooling → `chore(scope): …`
- Tests → bundle with their feature/fix; standalone only if no shippable feature in this batch.

**Foundation-first ordering.** Refactors before features that depend on them. Generated files ride with their source chunk.

### 3. Present plan, wait for approval
Show one numbered list of proposed commits. **Do not auto-execute.** Wait for "ok" / "go" / numbered amendments.

### 4. Execute the approved split
For each approved chunk: `git add <files>` → `git commit -m "<message>"` via HEREDOC for multi-line. Print resulting hash + summary. Final `git status` to confirm clean tree.

### 5. Never push, tag, or branch
`/commit` only commits. Pushing / opening PR / tagging / switching branch needs separate user permission per `scope-control` Iron Law.

## Forbidden

- Emoji in subject line.
- `Co-Authored-By: 🤖 Copilot` or any AI-attribution footer.
- `--no-verify` unless user explicitly asks.
- Squashing or amending already-pushed commits.
