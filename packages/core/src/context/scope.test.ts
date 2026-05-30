import { describe, expect, it } from 'vitest';
import { resolveContextScope } from './scope.js';

const enabled = ['file:///a', 'file:///b', 'file:///c'];

describe('resolveContextScope (T-MR13)', () => {
  it('maps `all` to undefined (every indexed segment)', () => {
    expect(resolveContextScope({ kind: 'all' }, enabled)).toBeUndefined();
  });

  it('maps `none` to the explicit empty scope', () => {
    expect(resolveContextScope({ kind: 'none' }, enabled)).toEqual([]);
  });

  it('maps `roots` to the explicit set, in order', () => {
    expect(
      resolveContextScope({ kind: 'roots', rootIds: ['file:///b', 'file:///a'] }, enabled),
    ).toEqual(['file:///b', 'file:///a']);
  });

  it('drops a stale root that is no longer enabled', () => {
    expect(
      resolveContextScope({ kind: 'roots', rootIds: ['file:///a', 'file:///gone'] }, enabled),
    ).toEqual(['file:///a']);
  });

  it('yields no code context when every selected root has vanished', () => {
    expect(resolveContextScope({ kind: 'roots', rootIds: ['file:///gone'] }, enabled)).toEqual([]);
  });
});
