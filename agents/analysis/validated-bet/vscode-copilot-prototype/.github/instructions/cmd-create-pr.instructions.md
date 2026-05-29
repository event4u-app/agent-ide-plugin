---
applyTo: "**"
description: When the user wants to open a pull request — types "/create-pr", "open a PR", "create pull request for this branch", "ship das jetzt". Drafts title + body, pushes if needed, opens via gh CLI, strips server-side attribution re-injection.
---

# /create-pr — draft and open a pull request

Compiled from `@event4u/agent-config/.agent-src/commands/create-pr.md`.

## When this fires

User intent: "/create-pr", "open a PR", "raise the PR", "ship this branch".

## Pre-flight gate

`scope-control` Iron Law: opening a PR is a git-op that needs explicit user permission. The intent above IS the permission for this turn. **One PR per invocation.** Do not auto-open follow-up PRs.

## Steps

### 1. State of the branch
Run in parallel: `git status` (uncommitted?) · `git rev-list --left-right --count HEAD...@{upstream}` (ahead/behind?) · `git log <base>..HEAD --oneline` · `git diff <base>...HEAD --stat`. Uncommitted → ask user: commit first via `/commit`, or stash?

### 2. Detect base branch
`git symbolic-ref refs/remotes/origin/HEAD` → `.github/PULL_REQUEST_TEMPLATE.md` hints → fallback `main`/`master`.

### 3. Draft title + body
**Title:** ≤ 70 chars, Conventional-Commit-shaped, no emoji, no AI-attribution.

**Body:**
```markdown
## Summary
<1-3 bullets, value-not-feature>

## Changes
<file groups by type>

## Test plan
- [ ] <bullet per AC>

## Out of scope
<2-4 bullets, deliberate omissions>

## Risk
<low / medium / high + reason>
```

**Forbidden:** 🤖 Generated with [...], Co-authored-by: [...], decorative emojis, "Pull Request opened by AI".

### 4. Push if needed
Not on origin → `git push -u origin <branch>`. On origin + ahead → `git push`. Diverged → STOP, route to user.

### 5. Open via `gh`
```bash
gh pr create --title "$TITLE" --body "$(cat <<'EOF'
$BODY
EOF
)"
```

### 6. Strip server-side re-injection
`gh pr create` may append `Pull Request opened by …`. Re-fetch body, regex-strip, PATCH back, re-fetch verify.

### 7. Return PR URL
One line: `Opened: <URL>`.

## Never

- Force-push to a shared branch.
- `--no-verify` skipping hooks.
- Auto-close other PRs.
- Push to main/master/prod directly.
