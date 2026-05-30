---
adr: 007
title: Pricing-Book Signature (Ed25519 over Sigstore for v0) + Telemetry Privacy Floor
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex/gpt-5.5 + gemini-2.5-pro, 2026-05-31 Phase 14 design round)
related: road-to-v1-0 Phase 14 (T-1401, T-1403, T-1404)
date: 2026-05-31
---

# ADR-007 — Pricing-Book Signature + Telemetry Privacy Floor

## Status

**Proposed** — drafted alongside the road-to-v1-0 Phase 14 core implementation
(`packages/core/src/pricing/verify.ts`, `packages/core/src/telemetry/`). Awaits
explicit user sign-off before flip to **Accepted**.

## Context

Phase 14 lands ship-readiness plumbing. Two design forks needed a decision and
both were put to the AI Council (codex/gpt-5.5 + gemini-2.5-pro):

1. **Pricing-book signature (T-1401).** The roadmap wording says "Sigstore", but
   a full sigstore-js verification pulls heavy dependencies and needs network
   access to a transparency log — neither fits the no-native-deps law or an
   offline IDE sidecar. The signing *pipeline* (T-1402, GitHub Actions) is
   deferred, so no signed feed even exists yet. What verifier ships now?
2. **Telemetry shape (T-1403).** Engagement logging must record which
   skills/tools/commands ran with a hard guarantee that no prompt/completion/
   source content can leak — even via a buggy caller.

## Decision

### 1. Offline Ed25519 detached-signature verification now; Sigstore/SLSA is T-1402

`verify.ts` uses Node's built-in `crypto` for detached Ed25519 verification
against a bundled SPKI/PEM public key (`pricing-pubkey.pem`). Zero dependencies,
fully offline. The Sigstore/SLSA *bundle* (transparency log + provenance) is the
T-1402 signing-pipeline upgrade; the verify contract is forward-compatible (swap
the verifier internals, keep `resolvePricing`).

**Separation of concerns (council, unanimous):** signature authenticity and the
">50% price-drop" business rule are different failures with different remedies,
so they are two pure functions —

- `verifyPricingSignature({ pricesYaml, signature, publicKey })` → answers only
  "do these bytes match this detached signature under this key?" Never throws;
  every failure is a typed `reason`.
- `priceDropGuard({ current, candidate, maxDropRatio })` → flags per-model
  input/output price drops beyond 50%. A large drop is the fingerprint of a
  tampered or corrupt feed that would silently under-bill the user.

`resolvePricing` orchestrates them and **fails open to the bundled baseline**
on any of: parse error, invalid/missing signature, or a blocked price drop. The
matching private key is never committed — it is held by the release pipeline
(T-1402). Until that pipeline ships, `resolvePricing` always falls back to the
trusted bundled `prices.yml`, which is exactly the conservative v0 posture.

### 2. Telemetry privacy floor is structural, not conventional

`telemetry/engagement.ts` records content-free engagement events. The floor is
enforced by construction, not by reviewer vigilance:

- **Opt-in.** Default `telemetry.artifact_engagement.enabled: false`. A disabled
  recorder is a `NoOpEngagementRecorder` (zero disk I/O); the factory decides
  once at construction.
- **No free text.** `EngagementEventSchema` is `.strict()` over an enum-driven
  shape (`kind` ∈ skill/tool/command, `name` = artefact id, optional
  `outcome`/`duration_ms`). The recorder builds the row from an allowlist of
  fields — it never spreads caller input — so a stray `{ prompt: ... }` cannot
  reach the schema, and an unknown key fails validation and the event is dropped
  (fail-open, never thrown).
- **Local-only, date-rotated JSONL** under `.event4u-agent/telemetry/`, mirroring
  the calibration log (T-706) so a user can delete a single day.
- The exported markdown report carries an explicit no-content-guarantee footer.

Council was unanimous on the strict schema, NoOp-when-disabled, date-rotated
files, and the top-N report with a no-content footer.

## Consequences

- **Positive.** Zero new dependencies; CI matrix stays green by construction.
  Pricing updates can never silently under-bill (drop guard) or be tampered with
  (signature) without failing open to a trusted baseline. Telemetry cannot leak
  content even with a buggy caller. Both layers are fully unit-testable
  (ephemeral keypairs for verify; a `FakeWatcher`-style injected clock for the
  recorder).
- **Negative / accepted.** Ed25519 alone does not give transparency-log /
  provenance guarantees — that is the deferred T-1402 upgrade. The bundled
  `pricing-pubkey.pem` is a development placeholder until the release pipeline
  generates the real key. The roadmap's "Sigstore" wording for T-1401 is
  superseded by this ADR (Sigstore proper moves to T-1402).
- **Follow-up.** The IDE surfaces remain `[~]`: the hard-block confirm dialog for
  a blocked price drop (T-1401 UI), the telemetry opt-in toggle + `event4u:
  Export Telemetry Report` command (T-1403 UI), and the shadow-cost line in the
  Cost Dashboard (T-1404 UI / T-707). Core landed ahead of surfacing, consistent
  with Phases 7/11/12.

## Alternatives considered

- **Full sigstore-js verification now.** Rejected: heavy deps + network, breaks
  the offline sidecar and no-native-deps law; the signing pipeline that would
  produce the bundle is itself deferred. Revisit in T-1402.
- **Stub T-1401 entirely until T-1402.** Rejected: the verify + drop-guard
  machinery is independently useful and testable, and shipping it now makes the
  T-1402 pipeline a drop-in (generate key, sign, point the feed at it).
- **Free-form telemetry metadata field.** Rejected outright: any free-text field
  is a content-leak vector. Enum-driven allowlist only.

## Sign-off

On flip to **Accepted**: no code change required (the implementation already
embodies the decision). Replace `pricing-pubkey.pem` with the real release key
when T-1402 ships, and update `agents/analysis/PLAN.md` §14 if it references the
signing mechanism.
