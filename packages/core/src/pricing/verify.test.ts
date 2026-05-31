import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PricingBook } from './loader.js';
import {
  priceDropGuard,
  resolvePricing,
  verifyPricingSignature,
  loadBundledPublicKey,
  defaultPublicKeyUrl,
} from './verify.js';

function bookYaml(opts: { sonnetIn?: number; sonnetOut?: number; opusIn?: number } = {}): string {
  const { sonnetIn = 3.0, sonnetOut = 15.0, opusIn = 15.0 } = opts;
  return `
version: 1
last_updated: '2026-05-31'
currency: USD
models:
  - id: claude-sonnet-4-6
    family: anthropic
    input_per_mtok: ${sonnetIn}
    output_per_mtok: ${sonnetOut}
    context_window: 200000
  - id: claude-opus-4-6
    family: anthropic
    input_per_mtok: ${opusIn}
    output_per_mtok: 75.00
    context_window: 200000
`;
}

function keypair(): { privateKey: KeyObject; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

function detachedSig(data: string, privateKey: KeyObject): string {
  return cryptoSign(null, Buffer.from(data, 'utf8'), privateKey).toString('base64');
}

describe('verifyPricingSignature', () => {
  it('accepts a valid detached Ed25519 signature', () => {
    const { privateKey, publicKeyPem } = keypair();
    const yaml = bookYaml();
    const signature = detachedSig(yaml, privateKey);
    expect(
      verifyPricingSignature({ pricesYaml: yaml, signature, publicKey: publicKeyPem }),
    ).toEqual({
      valid: true,
    });
  });

  it('rejects a tampered payload', () => {
    const { privateKey, publicKeyPem } = keypair();
    const signature = detachedSig(bookYaml(), privateKey);
    const result = verifyPricingSignature({
      pricesYaml: bookYaml({ sonnetIn: 0.01 }),
      signature,
      publicKey: publicKeyPem,
    });
    expect(result).toEqual({ valid: false, reason: 'invalid_signature' });
  });

  it('rejects a signature from the wrong key', () => {
    const { publicKeyPem } = keypair();
    const other = keypair();
    const yaml = bookYaml();
    const signature = detachedSig(yaml, other.privateKey);
    expect(
      verifyPricingSignature({ pricesYaml: yaml, signature, publicKey: publicKeyPem }),
    ).toEqual({
      valid: false,
      reason: 'invalid_signature',
    });
  });

  it('reports missing signature and key without throwing', () => {
    const { publicKeyPem } = keypair();
    expect(
      verifyPricingSignature({ pricesYaml: 'x', signature: undefined, publicKey: publicKeyPem }),
    ).toEqual({
      valid: false,
      reason: 'missing_signature',
    });
    expect(
      verifyPricingSignature({ pricesYaml: 'x', signature: 'abc', publicKey: undefined }),
    ).toEqual({
      valid: false,
      reason: 'invalid_public_key',
    });
  });

  it('reports an unparseable public key', () => {
    expect(
      verifyPricingSignature({ pricesYaml: 'x', signature: 'YWJj', publicKey: 'not a pem' }),
    ).toEqual({ valid: false, reason: 'invalid_public_key' });
  });
});

describe('priceDropGuard', () => {
  const current = PricingBook.parse(bookYaml());

  it('passes when prices are stable or rise', () => {
    const candidate = PricingBook.parse(bookYaml({ sonnetIn: 4.0 }));
    expect(priceDropGuard({ current, candidate })).toEqual({ blocked: false, violations: [] });
  });

  it('blocks a >50% input-price drop', () => {
    const candidate = PricingBook.parse(bookYaml({ sonnetIn: 1.0 })); // 3 → 1 = 66% drop
    const result = priceDropGuard({ current, candidate });
    expect(result.blocked).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      model: 'claude-sonnet-4-6',
      field: 'input_per_mtok',
    });
    expect(result.violations[0].dropRatio).toBeCloseTo(2 / 3, 5);
  });

  it('allows a drop at exactly the threshold', () => {
    const candidate = PricingBook.parse(bookYaml({ sonnetIn: 1.5 })); // 3 → 1.5 = exactly 50%
    expect(priceDropGuard({ current, candidate }).blocked).toBe(false);
  });

  it('ignores models absent from the current book', () => {
    const candidate = PricingBook.parse(`
version: 2
last_updated: '2026-05-31'
currency: USD
models:
  - id: brand-new-model
    family: anthropic
    input_per_mtok: 0.01
    output_per_mtok: 0.01
    context_window: 200000
`);
    expect(priceDropGuard({ current, candidate }).blocked).toBe(false);
  });
});

describe('resolvePricing', () => {
  const baseline = PricingBook.parse(bookYaml());

  it('adopts an authentic, sane candidate', () => {
    const { privateKey, publicKeyPem } = keypair();
    const candidateYaml = bookYaml({ sonnetIn: 3.5 });
    const result = resolvePricing({
      candidateYaml,
      signature: detachedSig(candidateYaml, privateKey),
      publicKey: publicKeyPem,
      baseline,
    });
    expect(result.source).toBe('candidate');
    expect(result.book.requireModel('claude-sonnet-4-6').input_per_mtok).toBe(3.5);
  });

  it('falls back to baseline on an invalid signature', () => {
    const { publicKeyPem } = keypair();
    const candidateYaml = bookYaml({ sonnetIn: 3.5 });
    const result = resolvePricing({
      candidateYaml,
      signature: detachedSig(candidateYaml, keypair().privateKey),
      publicKey: publicKeyPem,
      baseline,
    });
    expect(result.source).toBe('baseline');
    expect(result.signature.valid).toBe(false);
    expect(result.book.requireModel('claude-sonnet-4-6').input_per_mtok).toBe(3.0);
  });

  it('falls back to baseline (no signed feed) when no key is bundled', () => {
    const candidateYaml = bookYaml({ sonnetIn: 3.5 });
    const result = resolvePricing({
      candidateYaml,
      signature: undefined,
      publicKey: undefined,
      baseline,
    });
    expect(result.source).toBe('baseline');
    expect(result.signature.reason).toBe('missing_signature');
  });

  it('blocks an authentic candidate that drops a price >50%', () => {
    const { privateKey, publicKeyPem } = keypair();
    const candidateYaml = bookYaml({ sonnetIn: 0.5 }); // 3 → 0.5 = 83% drop
    const result = resolvePricing({
      candidateYaml,
      signature: detachedSig(candidateYaml, privateKey),
      publicKey: publicKeyPem,
      baseline,
    });
    expect(result.source).toBe('baseline');
    expect(result.priceDropBlocked).toBe(true);
    expect(result.violations[0].model).toBe('claude-sonnet-4-6');
  });

  it('falls back to baseline on an unparseable authentic candidate', () => {
    const { privateKey, publicKeyPem } = keypair();
    const candidateYaml = 'version: -1\nthis: [is, not, valid';
    const result = resolvePricing({
      candidateYaml,
      signature: detachedSig(candidateYaml, privateKey),
      publicKey: publicKeyPem,
      baseline,
    });
    expect(result.source).toBe('baseline');
    expect(result.parseError).toBeDefined();
  });
});

describe('loadBundledPublicKey', () => {
  it('reads the bundled placeholder key as valid PEM usable by verify', async () => {
    const pem = await loadBundledPublicKey();
    expect(pem).toContain('BEGIN PUBLIC KEY');
    // A key is bundled, so a missing signature reports `missing_signature`,
    // not `invalid_public_key` — proving the PEM parses.
    expect(
      verifyPricingSignature({ pricesYaml: 'x', signature: undefined, publicKey: pem }),
    ).toEqual({
      valid: false,
      reason: 'missing_signature',
    });
  });

  it('returns undefined for a non-existent key url', async () => {
    expect(await loadBundledPublicKey(new URL('file:///nonexistent/key.pem'))).toBeUndefined();
  });

  it('exposes a default key url next to the module', () => {
    expect(defaultPublicKeyUrl().pathname).toContain('pricing-pubkey.pem');
  });
});
