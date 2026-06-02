/**
 * Git-loop RPC handler (product-readiness Phase 4 transport, T-PRD14/15/16).
 *
 * Exposes the shipped pure-core builders (`commit-message.ts`,
 * `pr-description.ts`, `review-summary.ts`) as full-turn methods behind the
 * dispatcher. Mirrors {@link ChatHandler}: the composition root injects a
 * backend resolver + a default cwd, the handler reads the diff, runs the
 * provider, and returns the PARSED / SANITISED result.
 *
 * AI council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31, UNANIMOUS):
 *  - fork A1 — full turn server-side (single round-trip, testable with a
 *    scripted backend) over a prompt-only method the nonexistent client drives.
 *  - fork B1 — a dedicated injected handler keeps the dispatcher a thin router.
 *  - fork C1 — one terminal result carrying the final sanitised text; never
 *    stream raw tokens (they would flash un-stripped attribution / emoji).
 *  - fork D1 — `gitCommitMessage` re-prompts internally on a parse failure,
 *    bounded (default 2 attempts), then returns a structured `{ ok:false }`.
 *  - fork E1 — `gitReviewSummary` runs `runReview` internally and returns a
 *    minimal wire finding subset (no votes/confidence leak into the protocol).
 *  - fork F1 — `cwd` rides on the request (multi-root ready); `base`/`head`
 *    select the range.
 *
 * The Core NEVER commits or opens a PR — it only returns editable text
 * (`commit-policy`). The card render stays IDE-runtime.
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type {
  ChatMessage,
  GitCommitMessageRequest,
  GitCommitMessageResponse,
  GitDiffSource,
  GitPrDescriptionRequest,
  GitPrDescriptionResponse,
  GitReviewApplyFixRequest,
  GitReviewApplyFixResponse,
  GitReviewFinding,
  GitReviewSummaryRequest,
  GitReviewSummaryResponse,
  GitSeverityCount,
  LlmRequest,
  ToolReview,
} from '@event4u-agent/protocol';
import type { LlmBackend } from '../llm/backend.js';
import { collectStream } from '../llm/backend.js';
import { defaultGitRunner, type GitRunner } from '../commands/commit.js';
import { buildFixEdit } from '../review/apply-fix.js';
import { getDiff, type DiffSource } from '../review/diff-source.js';
import { runReview } from '../review/run.js';
import { createTrackedReviewObserver } from '../review/observer.js';
import { CapsBlockedError } from '../review/pipeline.js';
import type { TrackingDb } from '../tracking/db.js';
import type { CapsEvaluator } from '../tracking/caps.js';
import type { PricingBook } from '../pricing/loader.js';
import { unifiedDiff } from '../tools/write-file.js';
import type { Severity } from '../review/types.js';
import { SEVERITY_RANK } from '../review/types.js';
import {
  buildCommitMessagePrompt,
  parseCommitMessage,
  type ParsedCommitMessage,
} from './commit-message.js';
import {
  buildPrDescriptionPrompt,
  readCommitLog,
  sanitizePrBody,
  sanitizePrTitle,
} from './pr-description.js';
import { summarizeReview } from './review-summary.js';

/** A coded error so the dispatcher surfaces a specific `code` (not `handler_error`). */
export class GitRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GitRequestError';
  }
}

export interface GitHandlerDeps {
  /** Resolve the backend for a turn. `providerId` is the per-request selector. */
  resolveBackend: (providerId?: string) => LlmBackend;
  /** Model id for the request. May depend on the resolved provider. */
  resolveModel: (providerId?: string) => string;
  /** Workspace root used when a request omits `cwd` (production: `process.cwd()`). */
  defaultCwd: string;
  /** Git shell abstraction; injected in tests. */
  runner?: GitRunner;
  /** Output cap per turn. Default 2048 (matches `LlmRequest`). */
  maxTokens?: number;
  /** Max `gitCommitMessage` attempts before returning a structured failure (D1). */
  maxCommitAttempts?: number;
  /**
   * Step-event trail for the review pipeline (T-CR-206). When present together
   * with {@link pricing}, `reviewSummary` runs through a
   * {@link createTrackedReviewObserver} so each LLM review stage is recorded as
   * a priced `activity:"review"` step event. Absent → review is untracked
   * (recording no-ops without a pricing book, mirroring the chat/agent gate).
   */
  tracking?: TrackingDb;
  /** Pricing book used to price review step events. See {@link tracking}. */
  pricing?: PricingBook;
  /**
   * Optional cost-cap gate. When present, a review stage whose pre-flight
   * projection exceeds a hard cap is blocked before the LLM call (council
   * Q2=A — same budget contract as the chat/agent pre-send gate); the block
   * surfaces as a coded `cost_cap_blocked` error.
   */
  caps?: CapsEvaluator;
}

const ALL_SEVERITIES = Object.keys(SEVERITY_RANK) as Severity[];

export class GitHandler {
  private readonly runner: GitRunner;
  private readonly maxTokens: number;
  private readonly maxCommitAttempts: number;

  constructor(private readonly deps: GitHandlerDeps) {
    this.runner = deps.runner ?? defaultGitRunner;
    this.maxTokens = deps.maxTokens ?? 2048;
    this.maxCommitAttempts = Math.max(1, deps.maxCommitAttempts ?? 2);
  }

  /**
   * Propose a Conventional-Commit message from the selected diff. Re-prompts up
   * to `maxCommitAttempts` on a parse failure, then returns `{ ok:false }`.
   */
  async commitMessage(req: GitCommitMessageRequest): Promise<GitCommitMessageResponse> {
    const cwd = req.cwd || this.deps.defaultCwd;
    const source = this.toDiffSource(req.source ?? 'staged', req.base, req.head);
    const changes = await getDiff(cwd, source, this.runner);
    if (changes.length === 0) {
      return {
        ok: false,
        message: null,
        text: '',
        errors: ['no changes in the selected diff source'],
        attempts: 0,
      };
    }

    const messages: ChatMessage[] = buildCommitMessagePrompt(changes, {
      ...(req.branch ? { branch: req.branch } : {}),
      ...(req.extraInstruction ? { extraInstruction: req.extraInstruction } : {}),
    });

    let lastErrors: string[] = [];
    for (let attempt = 1; attempt <= this.maxCommitAttempts; attempt++) {
      const raw = await this.runTurn(messages, req.providerId);
      const parsed = parseCommitMessage(raw);
      if (parsed.ok) {
        return {
          ok: true,
          message: toWireCommit(parsed.message),
          text: assembleCommitText(parsed.message),
          errors: [],
          attempts: attempt,
        };
      }
      lastErrors = parsed.errors;
      // Append a corrective turn so the next attempt sees what was wrong (D1).
      if (attempt < this.maxCommitAttempts) {
        messages.push({ role: 'assistant', content: raw });
        messages.push({
          role: 'user',
          content: `That reply was invalid: ${parsed.errors.join('; ')}. Re-emit a corrected Conventional-Commit message — output only the message.`,
        });
      }
    }

    return {
      ok: false,
      message: null,
      text: '',
      errors: lastErrors,
      attempts: this.maxCommitAttempts,
    };
  }

  /** Draft a sanitised PR description from the branch diff + commit log. */
  async prDescription(req: GitPrDescriptionRequest): Promise<GitPrDescriptionResponse> {
    const cwd = req.cwd || this.deps.defaultCwd;
    const head = req.head ?? 'HEAD';
    const changes = await getDiff(cwd, { mode: 'range', base: req.base, head }, this.runner);
    const log = await readCommitLog(cwd, req.base, head, this.runner);

    const messages = buildPrDescriptionPrompt(changes, log, {
      ...(req.branch ? { branch: req.branch } : {}),
      base: req.base,
      ...(req.extraInstruction ? { extraInstruction: req.extraInstruction } : {}),
    });
    const raw = await this.runTurn(messages, req.providerId);

    const { body, warnings: bodyWarnings } = sanitizePrBody(raw);
    // Title candidate (no extra LLM call): the newest commit subject, or the
    // branch name — the user edits it. Sanitised emoji-free per house rules.
    const candidate = log.entries[0]?.subject ?? req.branch ?? '';
    const { title, warnings: titleWarnings } = sanitizePrTitle(candidate);

    return {
      title,
      body,
      warnings: [...bodyWarnings, ...titleWarnings],
      commitCount: log.total,
      truncated: log.truncated,
    };
  }

  /** Run the review engine over the selected diff and fold it into a summary. */
  async reviewSummary(req: GitReviewSummaryRequest): Promise<GitReviewSummaryResponse> {
    const cwd = req.cwd || this.deps.defaultCwd;
    const source = this.toDiffSource(req.source ?? 'unstaged', req.base, req.head);
    const backend = this.deps.resolveBackend(req.providerId);
    const model = this.deps.resolveModel(req.providerId);

    // Wire the tracked observer (T-CR-206) only when a pricing book + tracking
    // trail are available — recording no-ops without pricing (the same gate the
    // chat/agent step recorder uses). The review action has no conversation, so
    // events group under a stable `review:<cwd>` id (council Q1=A). The optional
    // caps gate blocks a cap-blowing diff before the stage (council Q2=A).
    const observer =
      this.deps.pricing && this.deps.tracking
        ? createTrackedReviewObserver({
            db: this.deps.tracking,
            pricing: this.deps.pricing,
            ...(this.deps.caps ? { caps: this.deps.caps } : {}),
            conversationId: `review:${cwd}`,
            cwd,
            mode: 'api',
          })
        : undefined;

    let result;
    try {
      result = await runReview(backend, {
        cwd,
        source,
        runner: this.runner,
        pipeline: {
          config: { model, maxTokens: this.maxTokens },
          ...(observer ? { observer } : {}),
        },
      });
    } catch (error) {
      // A hard-cap block is a controlled policy refusal, not a crash — surface
      // it as a coded error mirroring the chat/agent `cost_cap_blocked` stop
      // reason (council Q3=A), so the IDE can show a budget-exceeded notice.
      if (error instanceof CapsBlockedError) {
        throw new GitRequestError('cost_cap_blocked', error.message);
      }
      throw error;
    }
    const changes = await getDiff(cwd, source, this.runner);
    const summary = summarizeReview(result, changes);

    const findingsBySeverity: GitSeverityCount[] = ALL_SEVERITIES.map((severity) => ({
      severity,
      count: summary.findingsBySeverity[severity],
    }));
    const topFindings: GitReviewFinding[] = summary.topFindings.map((f) => ({
      file: f.file,
      line: f.line ?? null,
      severity: f.severity,
      category: f.category,
      description: f.description,
      // quotedSpan + proposedFix are FUNCTIONAL apply-fix inputs (T-CR-404),
      // not the votes/confidence trust signals E1 keeps off the wire.
      quotedSpan: f.quotedSpan,
      proposedFix: f.proposedFix,
      fixable: Boolean(f.proposedFix && f.quotedSpan),
    }));

    return {
      filesChanged: summary.filesChanged,
      additions: summary.additions,
      deletions: summary.deletions,
      findingsBySeverity,
      totalFindings: summary.totalFindings,
      potentialFindings: summary.potentialFindings,
      topFindings,
    };
  }

  /**
   * Turn one review finding's proposed fix into a permission-gated edit
   * (T-CR-404). Stateless (fork A1): the client echoes the `file` + `quotedSpan`
   * + `proposedFix` it received on a `gitReviewSummary` finding. The Core NEVER
   * writes — it re-reads the CURRENT file (span-drift safe), runs the shipped
   * `buildFixEdit`, and returns the approval `review` diff (same DTO other write
   * proposals carry, so the IDE renders it identically). A no-op / drifted span
   * / missing file yields `applicable:false` + a `reason` (not an error) so the
   * client greys out the affordance. The write itself rides the user-approved
   * `write_file` path — the diff-approval + audit-log contract is unchanged.
   */
  async reviewApplyFix(req: GitReviewApplyFixRequest): Promise<GitReviewApplyFixResponse> {
    const cwd = req.cwd || this.deps.defaultCwd;
    const abs = resolve(cwd, req.file);
    const rel = relative(cwd, abs);
    // Reject a path that escapes the workspace root (`..` on POSIX, a different
    // drive on Windows yields an absolute `relative()` result).
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      return { applicable: false, reason: 'path_escapes_workspace' };
    }

    const content = await readFile(abs, 'utf8').catch(() => undefined);
    if (content === undefined) return { applicable: false, reason: 'file_not_found' };

    const edit = buildFixEdit(
      { file: req.file, quotedSpan: req.quotedSpan, proposedFix: req.proposedFix },
      content,
    );
    if (!edit) {
      // Distinguish the two non-applicable causes for the UI affordance.
      const reason = content.includes(req.quotedSpan) ? 'no_op' : 'span_drift';
      return { applicable: false, reason };
    }

    const review: ToolReview = {
      kind: 'diff',
      files: [
        {
          path: rel.split(/[\\/]/).join('/'),
          diff: unifiedDiff(content, edit.content, req.file),
          isNewFile: false,
        },
      ],
    };
    return { applicable: true, review };
  }

  /** Run one non-streaming LLM turn and return the aggregated text. */
  private async runTurn(messages: ChatMessage[], providerId?: string): Promise<string> {
    const backend = this.deps.resolveBackend(providerId);
    const model = this.deps.resolveModel(providerId);
    const request: LlmRequest = { model, messages, max_tokens: this.maxTokens };
    const aggregate = await collectStream(backend.stream(request));
    return aggregate.text;
  }

  private toDiffSource(source: GitDiffSource, base?: string, head?: string): DiffSource {
    if (source === 'range') {
      if (!base) {
        throw new GitRequestError('git_bad_request', 'source "range" requires a `base` ref');
      }
      return { mode: 'range', base, ...(head ? { head } : {}) };
    }
    return { mode: source };
  }
}

/** Build the canonical commit text from the parsed message (house-rule-clean). */
function assembleCommitText(msg: ParsedCommitMessage): string {
  const scope = msg.scope ? `(${msg.scope})` : '';
  // Re-emit `!` only when the breaking flag did not come from a body footer.
  const bang = msg.breaking && !/^BREAKING CHANGE:/m.test(msg.body ?? '') ? '!' : '';
  const header = `${msg.type}${scope}${bang}: ${msg.subject}`;
  return msg.body ? `${header}\n\n${msg.body}` : header;
}

function toWireCommit(msg: ParsedCommitMessage): {
  type: string;
  scope?: string;
  breaking: boolean;
  subject: string;
  body?: string;
} {
  return {
    type: msg.type,
    ...(msg.scope ? { scope: msg.scope } : {}),
    breaking: msg.breaking,
    subject: msg.subject,
    ...(msg.body ? { body: msg.body } : {}),
  };
}
