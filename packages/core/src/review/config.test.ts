import { describe, expect, it } from 'vitest';
import { applySeverityFloor, resolveReviewSettings, voteOptionsFromSettings } from './config.js';
import { loadReviewRules, type RulesReader } from './rules.js';
import { DismissalStore } from './dismissals.js';
import type { ReviewIssue } from './types.js';

function issue(over: Partial<ReviewIssue>): ReviewIssue {
  return {
    id: Math.random().toString(36).slice(2),
    file: 'a.ts',
    line: 1,
    description: 'finding',
    severity: 'low',
    category: 'bug',
    ...over,
  };
}

describe('review settings', () => {
  it('applies defaults', () => {
    const s = resolveReviewSettings();
    expect(s.group_size).toBe(5);
    expect(s.label_threshold).toBe(4);
    expect(s.security_always_error).toBe(true);
  });

  it('maps to group-vote options', () => {
    const s = resolveReviewSettings({ group_size: 1, label_threshold: 2, potential_threshold: 1 });
    expect(voteOptionsFromSettings(s)).toEqual({
      groupSize: 1,
      labelThreshold: 2,
      potentialThreshold: 1,
    });
  });

  it('severity floor drops low findings but never security', () => {
    const s = resolveReviewSettings({ severity_floor: 'high' });
    const filtered = applySeverityFloor(
      [
        issue({ severity: 'low', category: 'bug' }),
        issue({ severity: 'high', category: 'bug' }),
        issue({ severity: 'low', category: 'security' }),
      ],
      s,
    );
    expect(filtered).toHaveLength(2);
    expect(filtered.some((i) => i.category === 'security')).toBe(true);
    expect(filtered.some((i) => i.severity === 'low' && i.category === 'bug')).toBe(false);
  });
});

describe('loadReviewRules', () => {
  it('returns trimmed rules text when present', async () => {
    const reader: RulesReader = { read: async () => '  flag any new console.log  ' };
    expect(await loadReviewRules('/repo', reader)).toBe('flag any new console.log');
  });

  it('returns undefined when the file is missing or empty', async () => {
    const missing: RulesReader = {
      read: async () => {
        throw new Error('ENOENT');
      },
    };
    const empty: RulesReader = { read: async () => '   ' };
    expect(await loadReviewRules('/repo', missing)).toBeUndefined();
    expect(await loadReviewRules('/repo', empty)).toBeUndefined();
  });
});

describe('DismissalStore', () => {
  const HUNK = 'function f() { return 1; }';
  const issA = issue({ description: 'this is a multi word finding description', line: 3 });

  it('filters out a finding dismissed for the same hunk', () => {
    const store = new DismissalStore();
    store.dismiss(issA, HUNK);
    expect(store.isDismissed(issA, HUNK)).toBe(true);
    expect(store.filter([issA], () => HUNK)).toHaveLength(0);
  });

  it('resurfaces the finding once the hunk content changes', () => {
    const store = new DismissalStore();
    store.dismiss(issA, HUNK);
    expect(store.isDismissed(issA, 'function f() { return 2; }')).toBe(false);
  });

  it('round-trips through JSON with spaces in the description', () => {
    const store = new DismissalStore();
    store.dismiss(issA, HUNK);
    const restored = DismissalStore.fromJson(store.toJson());
    expect(restored.isDismissed(issA, HUNK)).toBe(true);
  });
});
