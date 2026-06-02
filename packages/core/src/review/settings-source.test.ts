import { describe, expect, it } from 'vitest';
import { loadReviewSettings, type SettingsReader } from './settings-source.js';

/** A reader that returns fixed YAML text, or rejects to simulate a missing file. */
function reader(yaml: string | Error): SettingsReader {
  return {
    read: () => (yaml instanceof Error ? Promise.reject(yaml) : Promise.resolve(yaml)),
  };
}

describe('loadReviewSettings', () => {
  it('parses the review block and applies the values', async () => {
    const settings = await loadReviewSettings(
      '/repo',
      reader('review:\n  group_size: 1\n  severity_floor: high\n  security_always_error: false\n'),
    );
    expect(settings.group_size).toBe(1);
    expect(settings.severity_floor).toBe('high');
    expect(settings.security_always_error).toBe(false);
    // Unset keys fall back to schema defaults.
    expect(settings.label_threshold).toBe(4);
  });

  it('returns full defaults when the file is missing (fail-open)', async () => {
    const settings = await loadReviewSettings('/repo', reader(new Error('ENOENT')));
    expect(settings.group_size).toBe(5);
    expect(settings.severity_floor).toBe('info');
    expect(settings.security_always_error).toBe(true);
  });

  it('returns defaults when the file has no review block', async () => {
    const settings = await loadReviewSettings('/repo', reader('llm:\n  default_mode: api\n'));
    expect(settings.group_size).toBe(5);
    expect(settings.severity_floor).toBe('info');
  });

  it('returns defaults when the review block is malformed (fail-open, no throw)', async () => {
    // group_size must be a positive int — a string makes the schema throw; the
    // reader catches it and resolves to defaults rather than breaking review.
    const settings = await loadReviewSettings('/repo', reader('review:\n  group_size: "five"\n'));
    expect(settings.group_size).toBe(5);
    expect(settings.severity_floor).toBe('info');
  });

  it('returns defaults when the YAML is unparseable (fail-open)', async () => {
    const settings = await loadReviewSettings('/repo', reader('review: : : not yaml\n  - ['));
    expect(settings.group_size).toBe(5);
  });
});
