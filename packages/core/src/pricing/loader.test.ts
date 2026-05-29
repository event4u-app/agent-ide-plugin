import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultPricesYmlUrl, PricingBook, PricingBookError } from './loader.js';

const VALID_YAML = `
version: 1
last_updated: '2026-05-29'
currency: USD
models:
  - id: claude-sonnet-4-6
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    cache_write_per_mtok: 3.75
    cache_read_per_mtok: 0.30
    context_window: 200000
subscriptions:
  - id: claude-pro
    family: anthropic
    monthly_usd: 20.00
    messages_per_5h: 45
`;

describe('PricingBook.parse', () => {
  it('parses a valid book', () => {
    const book = PricingBook.parse(VALID_YAML);
    expect(book.data.version).toBe(1);
    expect(book.data.models).toHaveLength(1);
    expect(book.getModel('claude-sonnet-4-6')).toBeDefined();
    expect(book.getSubscription('claude-pro')).toBeDefined();
  });

  it('requireModel throws on unknown id with a useful message', () => {
    const book = PricingBook.parse(VALID_YAML);
    expect(() => book.requireModel('claude-opus-99')).toThrow(/Unknown model id.*Known/);
  });

  it('throws PricingBookError on malformed YAML', () => {
    expect(() => PricingBook.parse('models:\n  - : :')).toThrow(PricingBookError);
  });

  it('throws on missing required field', () => {
    const bad = `
version: 1
last_updated: '2026-05-29'
currency: USD
models:
  - id: claude-sonnet-4-6
    family: anthropic
    input_per_mtok: 3.00
`;
    expect(() => PricingBook.parse(bad)).toThrow(/schema violation/);
  });

  it('rejects wrong date format', () => {
    const bad = VALID_YAML.replace("'2026-05-29'", "'May 29 2026'");
    expect(() => PricingBook.parse(bad)).toThrow(/schema violation/);
  });

  it('rejects non-USD currency', () => {
    const bad = VALID_YAML.replace('currency: USD', 'currency: EUR');
    expect(() => PricingBook.parse(bad)).toThrow(/schema violation/);
  });
});

describe('PricingBook.costFor', () => {
  const book = PricingBook.parse(VALID_YAML);

  it('computes input + output cost per million tokens', () => {
    const cost = book.costFor('claude-sonnet-4-6', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost.input_usd).toBeCloseTo(3.0);
    expect(cost.output_usd).toBeCloseTo(15.0);
    expect(cost.total_usd).toBeCloseTo(18.0);
  });

  it('counts cache buckets when both data + usage carry them', () => {
    const cost = book.costFor('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
      cache_write_tokens: 1_000_000,
      cache_read_tokens: 1_000_000,
    });
    expect(cost.cache_write_usd).toBeCloseTo(3.75);
    expect(cost.cache_read_usd).toBeCloseTo(0.3);
    expect(cost.total_usd).toBeCloseTo(4.05);
  });

  it('zeros cache buckets when usage omits them', () => {
    const cost = book.costFor('claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 1000,
    });
    expect(cost.cache_write_usd).toBe(0);
    expect(cost.cache_read_usd).toBe(0);
  });

  it('produces sub-cent precision for tiny turns', () => {
    const cost = book.costFor('claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 100,
    });
    // 1000/1e6 * 3 = 0.003 ; 100/1e6 * 15 = 0.0015 ; total 0.0045
    expect(cost.total_usd).toBeCloseTo(0.0045, 6);
  });
});

describe('PricingBook.load', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'event4u-pricing-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reads from a path', async () => {
    const path = join(tempDir, 'prices.yml');
    await writeFile(path, VALID_YAML, 'utf8');
    const book = await PricingBook.load(path);
    expect(book.getModel('claude-sonnet-4-6')).toBeDefined();
  });

  it('throws on missing file', async () => {
    await expect(PricingBook.load(join(tempDir, 'nope.yml'))).rejects.toThrow(PricingBookError);
  });

  it('loads the bundled prices.yml via defaultPricesYmlUrl', async () => {
    const path = fileURLToPath(defaultPricesYmlUrl());
    const book = await PricingBook.load(path);
    // Bundled book must contain every MVP model.
    for (const id of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5']) {
      expect(book.getModel(id), `missing model ${id}`).toBeDefined();
    }
    // And every subscription tier.
    for (const id of ['claude-pro', 'claude-max', 'claude-max-20x']) {
      expect(book.getSubscription(id), `missing subscription ${id}`).toBeDefined();
    }
  });
});
