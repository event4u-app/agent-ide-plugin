/**
 * Structured review output via native tool-use (road-to-code-review.md
 * Phase 2, T-CR-204 divergence #3: native JSON tool-use, NOT sweep's
 * hand-rolled `<issue>` XML — that XML existed only because 2024 tool-calling
 * was immature).
 *
 * AI-Council (codex + gemini, 2026-05-29) contract: every reported issue MUST
 * carry a `verbatimSnippet` quoted exactly from the new file plus the diff
 * line numbers, so line-mapping can validate it. A finding whose snippet does
 * not resolve to a real line is dropped — never anchored to a guessed line.
 */

import { z } from 'zod';
import type { ToolDefinition } from '@event4u-agent/protocol';

export const SeverityEnum = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export const CategoryEnum = z.enum([
  'bug',
  'security',
  'performance',
  'concurrency',
  'correctness',
  'style',
  'other',
]);

/** One issue as the model is required to report it. */
export const ReportedIssueSchema = z.object({
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  /** Exact bytes quoted from the NEW file — validated, never trusted blindly. */
  verbatimSnippet: z.string().min(1),
  description: z.string().min(1),
  severity: SeverityEnum,
  category: CategoryEnum,
  /** Model self-rating (noisy). The real trust signal is the Phase-3 vote. */
  confidence: z.number().min(0).max(1).optional(),
  /** Optional replacement for the span — never auto-applied. */
  proposedFix: z.string().optional(),
});
export type ReportedIssue = z.infer<typeof ReportedIssueSchema>;

/** Stage 1 / Stage 2 submission: a change summary plus candidate issues. */
export const SubmitFindingsSchema = z.object({
  changeSummary: z.string(),
  issues: z.array(ReportedIssueSchema).default([]),
});
export type SubmitFindings = z.infer<typeof SubmitFindingsSchema>;

export const SUBMIT_FINDINGS_TOOL: ToolDefinition = {
  name: 'submit_findings',
  description:
    'Submit your review of the change. Provide a one-paragraph changeSummary ' +
    'and the list of merge-blocking functional issues you found. Quote the ' +
    'EXACT bytes of the offending code from the new file in verbatimSnippet ' +
    'and give its new-file startLine/endLine. Report no style nits.',
  input_schema: {
    type: 'object',
    properties: {
      changeSummary: { type: 'string', description: 'One paragraph: what this change does.' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            startLine: { type: 'integer', minimum: 1 },
            endLine: { type: 'integer', minimum: 1 },
            verbatimSnippet: {
              type: 'string',
              description: 'Exact code copied from the new file — 1 to 8 contiguous lines.',
            },
            description: { type: 'string' },
            severity: { type: 'string', enum: SeverityEnum.options },
            category: { type: 'string', enum: CategoryEnum.options },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            proposedFix: { type: 'string' },
          },
          required: [
            'file',
            'startLine',
            'endLine',
            'verbatimSnippet',
            'description',
            'severity',
            'category',
          ],
        },
      },
    },
    required: ['changeSummary', 'issues'],
  },
};

/** One critical-pass decision about a previously-found candidate issue. */
export const ReviewDecisionSchema = z.object({
  issueId: z.string(),
  keep: z.boolean(),
  /** Re-rated severity (the critical pass may up/down-rate). */
  severity: SeverityEnum.optional(),
  reason: z.string().optional(),
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const SubmitDecisionsSchema = z.object({
  decisions: z.array(ReviewDecisionSchema).default([]),
});
export type SubmitDecisions = z.infer<typeof SubmitDecisionsSchema>;

export const SUBMIT_DECISIONS_TOOL: ToolDefinition = {
  name: 'submit_decisions',
  description:
    'For each candidate issue, decide whether it is a SEVERE, merge-blocking ' +
    'problem worth surfacing. Keep only severe issues. For each, return the ' +
    'issueId, keep (true/false), an optional re-rated severity, and a reason.',
  input_schema: {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            issueId: { type: 'string' },
            keep: { type: 'boolean' },
            severity: { type: 'string', enum: SeverityEnum.options },
            reason: { type: 'string' },
          },
          required: ['issueId', 'keep'],
        },
      },
    },
    required: ['decisions'],
  },
};

/**
 * Find the named tool's input among a stream's tool_uses and parse it with the
 * given schema. Returns `null` when the model did not call the tool.
 */
export function parseToolInput<T>(
  toolUses: Array<{ name: string; input: unknown }>,
  toolName: string,
  schema: z.ZodType<T>,
): T | null {
  const call = toolUses.find((t) => t.name === toolName);
  if (!call) return null;
  const parsed = schema.safeParse(call.input);
  return parsed.success ? parsed.data : null;
}
