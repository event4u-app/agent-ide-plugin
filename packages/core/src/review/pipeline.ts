/**
 * Staged review-prompt chain (road-to-code-review.md Phase 2, T-CR-201..206).
 *
 * Turns one file group into a set of candidate issues via sweep's staged
 * reasoning, adapted:
 *   Stage 1  change analysis           — LLM  (T-CR-201)
 *   Stage 2  edge-case Yes/No Q&A       — LLM  (T-CR-202)
 *   Stage 3  critical second pass       — LLM  (T-CR-203)
 *   Stage 4  severity sort + dedup      — code (T-CR-204, deterministic)
 *
 * Single pass here; the N-run self-consistency vote is Phase 3.
 *
 * Divergences (locked):
 *  - Stage 3 NEVER drops a `security` finding — enforced in code, not trusted
 *    to the model (AI-Council E, 2026-05-29).
 *  - Stage 4 is deterministic code, not an LLM sort — cheaper and stable.
 *  - Native tool-use JSON, not sweep's XML.
 *
 * Cost + audit (T-CR-206): every LLM stage is offered to the injected
 * `ReviewObserver` — a pre-flight cap check (throws `CapsBlockedError` on
 * `block`) and an `onStage` callback carrying usage for the `activity:
 * "review"` step event. The actual `TrackingDb`/`AuditLog` wiring lives at
 * the call site; the engine stays decoupled and unit-testable.
 */

import type { LlmBackend, AggregatedUsage } from '../llm/backend.js';
import { collectStream } from '../llm/backend.js';
import type { LlmRequest } from '@event4u-agent/protocol';
import type { FileChange, ReviewIssue, Review, Severity, IssueCategory } from './types.js';
import { SEVERITY_RANK } from './types.js';
import { validateAndMap } from './line-mapping.js';
import {
  SUBMIT_FINDINGS_TOOL,
  SUBMIT_DECISIONS_TOOL,
  SubmitFindingsSchema,
  SubmitDecisionsSchema,
  parseToolInput,
  type ReportedIssue,
} from './report-tool.js';
import {
  stage1System,
  stage1User,
  stage2System,
  stage2User,
  stage3System,
  stage3User,
} from './prompts.js';

export type CapVerdict = 'allow' | 'warn' | 'confirm' | 'block';

export interface ReviewModelConfig {
  model: string;
  maxTokens?: number;
  /** Per-run temperature — Phase 3 varies it across runs for vote independence. */
  temperature?: number;
}

export interface ReviewStageMeta {
  stage: 'analyze' | 'edge-cases' | 'critical';
  model: string;
  usage: AggregatedUsage;
  durationMs: number;
}

export interface ReviewObserver {
  /** Pre-flight cap check before a stage's LLM call. Pipeline throws on 'block'. */
  checkCaps?(input: {
    inputTokens: number;
    outputCapTokens: number;
    model: string;
    stage: string;
  }): Promise<CapVerdict> | CapVerdict;
  /** Called after each completed LLM stage with its usage (cost/audit logging). */
  onStage?(meta: ReviewStageMeta): void | Promise<void>;
  /** Read working-tree file content for span validation. */
  readFile?(file: string): Promise<string | undefined>;
  /** Monotonic clock in ms — injectable for deterministic tests. */
  now?(): number;
}

export interface ReviewPipelineOptions {
  config: ReviewModelConfig;
  /** Workspace review rules injected into Stage 1 (Phase 5, T-CR-501). */
  rules?: string;
  observer?: ReviewObserver;
  signal?: AbortSignal;
  /** Issues at/above this model-confidence land in `issues`, else `potentialIssues`. */
  highConfidenceFloor?: number;
}

export class CapsBlockedError extends Error {
  constructor(
    readonly stage: string,
    readonly projectedReason?: string,
  ) {
    super(`Review blocked by hard cap at stage "${stage}"`);
    this.name = 'CapsBlockedError';
  }
}

const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_HIGH_CONF_FLOOR = 0.6;

/** Rough token estimate when the backend cannot count locally (~4 chars/token). */
function estimateTokens(request: LlmRequest): number {
  const text =
    (request.system ?? '') +
    request.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('');
  return Math.ceil(text.length / 4);
}

async function runStage(
  backend: LlmBackend,
  stage: ReviewStageMeta['stage'],
  request: LlmRequest,
  options: ReviewPipelineOptions,
): Promise<AggregatedUsage> {
  const obs = options.observer;
  const now = obs?.now ?? (() => Date.now());

  if (obs?.checkCaps) {
    const inputTokens = (await backend.countInputTokens?.(request)) ?? estimateTokens(request);
    const verdict = await obs.checkCaps({
      inputTokens,
      outputCapTokens: request.max_tokens ?? DEFAULT_MAX_TOKENS,
      model: request.model,
      stage,
    });
    if (verdict === 'block') throw new CapsBlockedError(stage);
  }

  const started = now();
  const usage = await collectStream(backend.stream(request, options.signal));
  const durationMs = now() - started;
  await obs?.onStage?.({ stage, model: request.model, usage, durationMs });
  return usage;
}

function toReviewIssue(
  reported: ReportedIssue,
  idPrefix: string,
  index: number,
  stage: string,
  loc: { line: number; endLine: number },
): ReviewIssue {
  return {
    id: `${idPrefix}:${stage}:${index}`,
    file: reported.file,
    line: loc.line,
    endLine: loc.endLine,
    quotedSpan: reported.verbatimSnippet,
    description: reported.description,
    severity: reported.severity as Severity,
    category: reported.category as IssueCategory,
    modelConfidence: reported.confidence,
    stage,
    proposedFix: reported.proposedFix,
  };
}

/**
 * Validate + line-map a batch of reported issues, dropping any whose quoted
 * span cannot be confirmed against the real file (the strict council
 * contract — never anchor a diagnostic to a guessed line).
 */
async function materialize(
  reported: ReportedIssue[],
  changes: FileChange[],
  idPrefix: string,
  stage: string,
  observer: ReviewObserver | undefined,
): Promise<ReviewIssue[]> {
  const byPath = new Map(changes.map((c) => [c.file, c]));
  const out: ReviewIssue[] = [];
  for (let i = 0; i < reported.length; i++) {
    const r = reported[i] as ReportedIssue;
    const content = await observer?.readFile?.(r.file);
    const loc = validateAndMap(r.verbatimSnippet, content, byPath.get(r.file));
    if (loc) out.push(toReviewIssue(r, idPrefix, i, stage, loc));
  }
  return out;
}

/** Stage 4 — deterministic dedup + severity sort. */
export function sortAndDedup(issues: ReviewIssue[]): ReviewIssue[] {
  const seen = new Set<string>();
  const deduped: ReviewIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.file}:${issue.line}:${issue.description.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(issue);
  }
  return deduped.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

/**
 * Run one single-pass review over a file group (Stages 1–4). The N-run vote
 * (Phase 3) calls this repeatedly with varied temperature.
 */
export async function reviewGroup(
  backend: LlmBackend,
  files: string[],
  changes: FileChange[],
  options: ReviewPipelineOptions,
): Promise<Review> {
  const { config } = options;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const idPrefix = files.join('+');
  const baseReq = {
    model: config.model,
    max_tokens: maxTokens,
    temperature: config.temperature,
  } satisfies Partial<LlmRequest>;

  // Stage 1 — change analysis.
  const s1 = await runStage(
    backend,
    'analyze',
    {
      ...baseReq,
      system: stage1System(options.rules),
      messages: [{ role: 'user', content: stage1User(files, changes) }],
      tools: [SUBMIT_FINDINGS_TOOL],
    },
    options,
  );
  const s1Parsed = parseToolInput(s1.tool_uses, 'submit_findings', SubmitFindingsSchema);
  const changeSummary = s1Parsed?.changeSummary ?? '';
  const s1Issues = await materialize(
    s1Parsed?.issues ?? [],
    changes,
    idPrefix,
    'analyze',
    options.observer,
  );

  // Stage 2 — edge-case Q&A.
  const s2 = await runStage(
    backend,
    'edge-cases',
    {
      ...baseReq,
      system: stage2System(),
      messages: [{ role: 'user', content: stage2User(files, changes, changeSummary) }],
      tools: [SUBMIT_FINDINGS_TOOL],
    },
    options,
  );
  const s2Parsed = parseToolInput(s2.tool_uses, 'submit_findings', SubmitFindingsSchema);
  const s2Issues = await materialize(
    s2Parsed?.issues ?? [],
    changes,
    idPrefix,
    'edge-cases',
    options.observer,
  );

  const candidates = [...s1Issues, ...s2Issues];

  // Stage 3 — critical second pass. Security findings are exempt and kept
  // regardless of the model's decision.
  let survivors = candidates;
  if (candidates.length > 0) {
    const s3 = await runStage(
      backend,
      'critical',
      {
        ...baseReq,
        system: stage3System(),
        messages: [
          {
            role: 'user',
            content: stage3User(
              files,
              changes,
              candidates.map((c) => ({
                id: c.id,
                description: c.description,
                severity: c.severity,
                category: c.category,
              })),
            ),
          },
        ],
        tools: [SUBMIT_DECISIONS_TOOL],
      },
      options,
    );
    const decisions = parseToolInput(s3.tool_uses, 'submit_decisions', SubmitDecisionsSchema);
    const byId = new Map((decisions?.decisions ?? []).map((d) => [d.issueId, d]));
    survivors = candidates.filter((issue) => {
      if (issue.category === 'security') return true; // never down-weighted
      const decision = byId.get(issue.id);
      return decision?.keep === true;
    });
    // Apply re-rated severity, but never lower a security finding.
    for (const issue of survivors) {
      const decision = byId.get(issue.id);
      if (decision?.severity && issue.category !== 'security') {
        issue.severity = decision.severity as Severity;
      }
    }
  }

  // Stage 4 — sort + dedup, then bucket by model confidence (Phase 3 vote
  // replaces this bucketing).
  const sorted = sortAndDedup(survivors);
  const floor = options.highConfidenceFloor ?? DEFAULT_HIGH_CONF_FLOOR;
  const issues: ReviewIssue[] = [];
  const potentialIssues: ReviewIssue[] = [];
  for (const issue of sorted) {
    const highConf = issue.category === 'security' || (issue.modelConfidence ?? 0.7) >= floor;
    (highConf ? issues : potentialIssues).push(issue);
  }

  return { files, diffSummary: changeSummary, issues, potentialIssues };
}
