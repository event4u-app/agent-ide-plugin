import { readFile } from 'node:fs/promises';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';

/**
 * Pricing Book v0 — Anthropic-only, plugin-bundled.
 *
 * Roadmap: T-206. Future T-501 (Sprint 14) replaces this with a remote-fetched,
 * Sigstore-verified pricing feed. v0 ships with a static YAML file under
 * `src/pricing/prices.yml`.
 */

const ModelPriceSchema = z.object({
  id: z.string().min(1),
  family: z.enum(['anthropic']),
  input_per_mtok: z.number().nonnegative(),
  output_per_mtok: z.number().nonnegative(),
  cache_write_per_mtok: z.number().nonnegative().optional(),
  cache_read_per_mtok: z.number().nonnegative().optional(),
  context_window: z.number().int().positive(),
});

const SubscriptionPriceSchema = z.object({
  id: z.string().min(1),
  family: z.enum(['anthropic']),
  monthly_usd: z.number().nonnegative(),
  messages_per_5h: z.number().int().positive(),
  notes: z.string().optional(),
});

export const PricingBookSchema = z.object({
  version: z.number().int().positive(),
  last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.literal('USD'),
  models: z.array(ModelPriceSchema).min(1),
  subscriptions: z.array(SubscriptionPriceSchema).default([]),
});

export type ModelPrice = z.infer<typeof ModelPriceSchema>;
export type SubscriptionPrice = z.infer<typeof SubscriptionPriceSchema>;
export type PricingBookData = z.infer<typeof PricingBookSchema>;

export class PricingBookError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PricingBookError';
  }
}

export interface UsageBreakdown {
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens?: number;
  cache_read_tokens?: number;
}

export interface CostBreakdown {
  input_usd: number;
  output_usd: number;
  cache_write_usd: number;
  cache_read_usd: number;
  total_usd: number;
}

const PER_MTOK = 1_000_000;

/**
 * Pricing-book wrapper that exposes model + subscription lookups and a
 * cost-of-usage calculator. Callers use {@link PricingBook.load} (file-backed)
 * or {@link PricingBook.parse} (string-backed) — tests typically pass a YAML
 * string fixture directly.
 */
export class PricingBook {
  private readonly modelsById = new Map<string, ModelPrice>();
  private readonly subscriptionsById = new Map<string, SubscriptionPrice>();

  private constructor(readonly data: PricingBookData) {
    for (const m of data.models) this.modelsById.set(m.id, m);
    for (const s of data.subscriptions) this.subscriptionsById.set(s.id, s);
  }

  /** Look up a model price by id. Returns `undefined` when the model is unknown. */
  getModel(id: string): ModelPrice | undefined {
    return this.modelsById.get(id);
  }

  /** Look up a model price by id. Throws when unknown — for cost-tracking call sites. */
  requireModel(id: string): ModelPrice {
    const m = this.modelsById.get(id);
    if (!m) {
      throw new PricingBookError(
        `Unknown model id "${id}". Known: ${[...this.modelsById.keys()].join(', ')}`,
      );
    }
    return m;
  }

  getSubscription(id: string): SubscriptionPrice | undefined {
    return this.subscriptionsById.get(id);
  }

  /** Cost of one turn against one model. Unset cache buckets count as zero. */
  costFor(modelId: string, usage: UsageBreakdown): CostBreakdown {
    const m = this.requireModel(modelId);
    const input_usd = (usage.input_tokens / PER_MTOK) * m.input_per_mtok;
    const output_usd = (usage.output_tokens / PER_MTOK) * m.output_per_mtok;
    const cache_write_usd =
      usage.cache_write_tokens && m.cache_write_per_mtok
        ? (usage.cache_write_tokens / PER_MTOK) * m.cache_write_per_mtok
        : 0;
    const cache_read_usd =
      usage.cache_read_tokens && m.cache_read_per_mtok
        ? (usage.cache_read_tokens / PER_MTOK) * m.cache_read_per_mtok
        : 0;
    return {
      input_usd,
      output_usd,
      cache_write_usd,
      cache_read_usd,
      total_usd: input_usd + output_usd + cache_write_usd + cache_read_usd,
    };
  }

  static parse(yamlText: string): PricingBook {
    let raw: unknown;
    try {
      raw = parseYaml(yamlText);
    } catch (err) {
      if (err instanceof YAMLParseError) {
        throw new PricingBookError(
          `prices.yml: malformed YAML at line ${err.linePos?.[0]?.line ?? '?'}: ${err.message}`,
          err,
        );
      }
      throw new PricingBookError(`prices.yml: parse failed`, err);
    }
    const parsed = PricingBookSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  · ${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('\n');
      throw new PricingBookError(`prices.yml: schema violation\n${issues}`, parsed.error);
    }
    return new PricingBook(parsed.data);
  }

  static async load(path: string): Promise<PricingBook> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      throw new PricingBookError(`prices.yml: cannot read ${path}`, err);
    }
    return PricingBook.parse(text);
  }
}

/**
 * Resolves the bundled `prices.yml` path. The MVP keeps `prices.yml` next to
 * the source file; future T-406 packaging may move it to a known dist path.
 */
export function defaultPricesYmlUrl(): URL {
  return new URL('./prices.yml', import.meta.url);
}
