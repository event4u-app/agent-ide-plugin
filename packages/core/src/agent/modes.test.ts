import { describe, expect, it } from 'vitest';
import { AgentPhaseSchema } from './loop.js';
import {
  AgentModeSchema,
  DEFAULT_MODE,
  MODE_DIRECTIVES,
  phaseRunsInMode,
  resolveMode,
} from './modes.js';

const ALL_MODES = AgentModeSchema.options;
const VALID_PHASES = new Set(AgentPhaseSchema.options);
const PIPELINE_ORDER = AgentPhaseSchema.options.filter((p) => p !== 'done');

describe('MODE_DIRECTIVES', () => {
  it('has a directive for every AgentMode', () => {
    for (const mode of ALL_MODES) {
      expect(MODE_DIRECTIVES[mode]?.mode).toBe(mode);
    }
    expect(Object.keys(MODE_DIRECTIVES).sort()).toEqual([...ALL_MODES].sort());
  });

  it('only lists valid AgentPhases, never `done`, in pipeline order', () => {
    for (const mode of ALL_MODES) {
      const { phases } = MODE_DIRECTIVES[mode];
      expect(phases.length).toBeGreaterThan(0);
      for (const phase of phases) {
        expect(VALID_PHASES.has(phase)).toBe(true);
        expect(phase).not.toBe('done');
      }
      // Subset of the canonical order, preserving relative order.
      const indices = phases.map((p) => PIPELINE_ORDER.indexOf(p));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    }
  });

  it('only `edit` mutates; every read-only mode stops before `implement`', () => {
    for (const mode of ALL_MODES) {
      const dir = MODE_DIRECTIVES[mode];
      if (dir.mutates) {
        expect(mode).toBe('edit');
        expect(dir.phases).toContain('implement');
      } else {
        expect(dir.phases).not.toContain('implement');
      }
    }
  });

  it('every directive ends at `report`', () => {
    for (const mode of ALL_MODES) {
      const { phases } = MODE_DIRECTIVES[mode];
      expect(phases.at(-1)).toBe('report');
    }
  });
});

describe('resolveMode', () => {
  it('defaults to edit (the full pipeline)', () => {
    expect(DEFAULT_MODE).toBe('edit');
    expect(resolveMode().mode).toBe('edit');
    expect(resolveMode().phases).toEqual(['refine', 'plan', 'implement', 'verify', 'report']);
  });

  it('resolves each mode to its own directive', () => {
    expect(resolveMode('plan').phases).toEqual(['refine', 'plan', 'report']);
    expect(resolveMode('ask').mutates).toBe(false);
  });
});

describe('phaseRunsInMode', () => {
  it('reports phase membership per mode', () => {
    expect(phaseRunsInMode('edit', 'implement')).toBe(true);
    expect(phaseRunsInMode('plan', 'implement')).toBe(false);
    expect(phaseRunsInMode('ask', 'plan')).toBe(false);
    expect(phaseRunsInMode('review', 'verify')).toBe(true);
  });
});
