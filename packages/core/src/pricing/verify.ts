import { verify as cryptoVerify, createPublicKey, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PricingBook, type ModelPrice } from './loader.js';

/**
 * T-1401 — Pricing Book signature verification + price-drop guard.
 *
 * The plugin ships a trusted baseline `prices.yml`. When an over-the-wire
 * pricing update arrives it must be (a) cryptographically authentic and
 * (b) economically sane before it replaces the baseline.
 *
 * **Why Ed25519 over Sigstore for v0 (AI council, codex/gpt-5.5 +
 * gemini-2.5-pro, 2026-05-31 — UNANIMOUS):** a full sigstore-js verification
 * pulls heavy deps and needs network access, neither of which fit the
 * no-native-deps law or an offline IDE sidecar. Node's built-in `crypto`
 * does detached Ed25519 verification with zero dependencies. The
 * Sigstore/SLSA *bundle* (transparency log + provenance) is the T-1402
 * signing-pipeline upgrade; the verify contract here is forward-compatible
 * (swap the verifier, keep `resolvePricing`).
 *
 * **Separation of concerns (council):** signature authenticity and the
 * >50%-price-drop business rule are different failures with different
 * remedies, so they live in two pure functions —
 * {@link verifyPricingSignature} and {@link priceDropGuard} —
 * orchestrated by {@link resolvePricing}, which fails open to the baseline.
 */

export type SignatureFailureReason =
  | 'missing_signature'
  | 'invalid_public_key'
  | 'invalid_signature'
  | 'verify_error';

export interface SignatureResult {
  valid: boolean;
  reason?: SignatureFailureReason;
}

export interface VerifySignatureInput {
  /** Raw `prices.yml` bytes that were signed. */
  pricesYaml: string | Buffer;
  /** Detached Ed25519 signature, base64-encoded (or raw bytes). */
  signature: string | Buffer | undefined;
  /** Signing public key — PEM string or a pre-built {@link KeyObject}. */
  publicKey: string | KeyObject | undefined;
}

/**
 * Verify a detached Ed25519 signature over the `prices.yml` bytes. Pure and
 * offline — never throws; every failure is reported as `{ valid: false,
 * reason }` so callers can fail open without a try/catch.
 */
export function verifyPricingSignature(input: VerifySignatureInput): SignatureResult {
  if (!input.signature) return { valid: false, reason: 'missing_signature' };
  if (!input.publicKey) return { valid: false, reason: 'invalid_public_key' };

  let key: KeyObject;
  try {
    key = typeof input.publicKey === 'string' ? createPublicKey(input.publicKey) : input.publicKey;
  } catch {
    return { valid: false, reason: 'invalid_public_key' };
  }

  const data = Buffer.isBuffer(input.pricesYaml)
    ? input.pricesYaml
    : Buffer.from(input.pricesYaml, 'utf8');
  const sig = Buffer.isBuffer(input.signature)
    ? input.signature
    : Buffer.from(input.signature, 'base64');

  try {
    // Ed25519 is a one-shot algorithm — the digest algorithm argument is null.
    const ok = cryptoVerify(null, data, key, sig);
    return ok ? { valid: true } : { valid: false, reason: 'invalid_signature' };
  } catch {
    return { valid: false, reason: 'verify_error' };
  }
}

export interface PriceDropViolation {
  model: string;
  field: 'input_per_mtok' | 'output_per_mtok';
  current: number;
  candidate: number;
  /** Fractional drop: (current - candidate) / current, in [0, 1]. */
  dropRatio: number;
}

export interface PriceDropResult {
  blocked: boolean;
  violations: PriceDropViolation[];
}

export interface PriceDropGuardInput {
  current: PricingBook;
  candidate: PricingBook;
  /** Block when a price drops by more than this fraction. Default 0.5 (50%). */
  maxDropRatio?: number;
}

const DROP_FIELDS: PriceDropViolation['field'][] = ['input_per_mtok', 'output_per_mtok'];

/**
 * Flag models whose input or output price drops by more than `maxDropRatio`
 * vs the current book. A large drop is the signature of a tampered or
 * corrupt feed that would silently under-bill the user, so it hard-blocks
 * (the IDE surfaces a confirm dialog; the engine keeps the current book).
 *
 * Only models present in BOTH books are compared — a brand-new model can't
 * "drop". A price rise never blocks.
 */
export function priceDropGuard(input: PriceDropGuardInput): PriceDropResult {
  const maxDrop = input.maxDropRatio ?? 0.5;
  const violations: PriceDropViolation[] = [];

  for (const candidateModel of allModels(input.candidate)) {
    const currentModel = input.current.getModel(candidateModel.id);
    if (!currentModel) continue;
    for (const field of DROP_FIELDS) {
      const cur = currentModel[field];
      const cand = candidateModel[field];
      if (cur <= 0) continue;
      const dropRatio = (cur - cand) / cur;
      if (dropRatio > maxDrop) {
        violations.push({
          model: candidateModel.id,
          field,
          current: cur,
          candidate: cand,
          dropRatio,
        });
      }
    }
  }

  return { blocked: violations.length > 0, violations };
}

function allModels(book: PricingBook): ModelPrice[] {
  return [...book.data.models, ...book.data.custom_endpoints];
}

export type PricingSource = 'candidate' | 'baseline';

export interface ResolvePricingInput {
  /** Candidate `prices.yml` text fetched over the wire. */
  candidateYaml: string;
  /** Detached signature for the candidate bytes. */
  signature: string | Buffer | undefined;
  /** Signing public key (PEM or KeyObject). `undefined` → no signed feed yet. */
  publicKey: string | KeyObject | undefined;
  /** The trusted, plugin-bundled baseline book. Always the fallback. */
  baseline: PricingBook;
  /** Override the 50% drop threshold. */
  maxDropRatio?: number;
}

export interface ResolvePricingResult {
  /** The book the engine should use. */
  book: PricingBook;
  source: PricingSource;
  signature: SignatureResult;
  /** True when the candidate was rejected by {@link priceDropGuard}. */
  priceDropBlocked: boolean;
  violations: PriceDropViolation[];
  /** Set when the candidate YAML itself failed to parse. */
  parseError?: string;
}

/**
 * Resolve which pricing book to trust. Fails open to `baseline` on any of:
 * candidate parse error, invalid/missing signature, or a >50% price drop.
 * Only an authentic, sane candidate is adopted. Never throws.
 */
export function resolvePricing(input: ResolvePricingInput): ResolvePricingResult {
  const signature = verifyPricingSignature({
    pricesYaml: input.candidateYaml,
    signature: input.signature,
    publicKey: input.publicKey,
  });

  const baseFail = (extra: Partial<ResolvePricingResult>): ResolvePricingResult => ({
    book: input.baseline,
    source: 'baseline',
    signature,
    priceDropBlocked: false,
    violations: [],
    ...extra,
  });

  if (!signature.valid) return baseFail({});

  let candidate: PricingBook;
  try {
    candidate = PricingBook.parse(input.candidateYaml);
  } catch (err) {
    return baseFail({ parseError: err instanceof Error ? err.message : String(err) });
  }

  const guard = priceDropGuard({
    current: input.baseline,
    candidate,
    maxDropRatio: input.maxDropRatio,
  });
  if (guard.blocked) {
    return baseFail({ priceDropBlocked: true, violations: guard.violations });
  }

  return {
    book: candidate,
    source: 'candidate',
    signature,
    priceDropBlocked: false,
    violations: [],
  };
}

/** URL of the bundled signing public key, next to this module. */
export function defaultPublicKeyUrl(): URL {
  return new URL('./pricing-pubkey.pem', import.meta.url);
}

/**
 * Read the bundled signing public key. Returns `undefined` when no key is
 * bundled (or it cannot be read) — the v0 state, where `resolvePricing` then
 * fails open to the baseline because no signed feed can be verified yet.
 */
export async function loadBundledPublicKey(
  url: URL = defaultPublicKeyUrl(),
): Promise<string | undefined> {
  try {
    return await readFile(url, 'utf8');
  } catch {
    return undefined;
  }
}
