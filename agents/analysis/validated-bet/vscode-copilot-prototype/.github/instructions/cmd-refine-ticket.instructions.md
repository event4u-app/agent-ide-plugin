---
applyTo: "**"
description: When the user wants to sharpen a Jira/Linear ticket before planning — types "/refine-ticket PROJ-123", "tighten the AC on PROJ-456", "is this ticket clear enough", "refine das Ticket". Produces rewritten ticket + Top-5 risks + persona voices + close-prompt.
---

# /refine-ticket — sharpen the ticket before planning

Compiled from `@event4u/agent-config/.agent-src/commands/refine-ticket.md`.

## When this fires

User intent: "/refine-ticket PROJ-123", "tighten the AC on this", "is this ticket clear?", "kann ich das so umsetzen?".

## Steps

### 1. Resolve input
Four accepted shapes: explicit key (`/refine-ticket PROJ-123`) · branch detection (`git branch --show-current` + regex) · pasted markdown · URL. API unavailable AND key given → ask user to paste.

### 2. Audit the original ticket
Flag: **ambiguity** (each AC entry falsifiable in one sentence?) · **scope creep** (description names 3+ concerns?) · **missing test plan** · **hidden dependencies** ("requires X" / "depends on PROJ-456").

### 3. Rewrite the ticket
Produce tightened version: **Goal** (one sentence, user-value) · **Acceptance criteria** (numbered, each falsifiable) · **Out of scope** (explicit, 2-4 bullets) · **Test plan** (one bullet per AC) · **Open questions** (numbered, with default + escape).

### 4. Surface Top-5 risks
Five distinct risk shapes, one sentence each: **Implementation** (hard part technically) · **Scope** (likely silent expansion) · **Dependency** (we're assuming exists) · **Data** (production data affected) · **Reversal** (if lands wrong, hard to undo).

### 5. Persona voices (optional, if user asks)
Run mental personas: product-owner ("business value at stake?") · senior-engineer ("cheapest way?") · critical-challenger ("the bet we haven't named?") · stakeholder ("who notices if this slips?").

### 6. Close prompt
End with three options: 1) plan + implement (runs `/work`) · 2) open questions need answering first · 3) save the refined version to the ticket and stop.

## Forbidden

- Rewriting AC silently (every change is surfaced).
- Adding speculative dependencies the original ticket didn't mention.
- Trimming AC to make ticket "look smaller" without flagging the trim.
