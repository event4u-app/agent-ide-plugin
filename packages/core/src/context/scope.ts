import type { ContextScope } from '@event4u-agent/protocol';

/**
 * T-MR13 — resolve a per-turn {@link ContextScope} to the `rootIds` value
 * {@link ContextEngine.retrieve} expects.
 *
 * The mapping is the contract between the picker selection and retrieval:
 *  - `all`   → `undefined` — every indexed segment (the engine's "all" path).
 *  - `none`  → `[]`        — the explicit "no code context" flag.
 *  - `roots` → the explicit set, filtered to the currently-known enabled roots
 *              (a restored / stale selection that references a vanished root is
 *              dropped silently, per T-MR14 / T-MR15). If nothing survives the
 *              filter, the turn carries no code context (`[]`) rather than
 *              silently widening to "all".
 *
 * Pure and engine-free so the resolution rule is unit-testable on its own; the
 * turn-message wiring + selection snapshot land with the Phase C picker.
 */
export function resolveContextScope(
  scope: ContextScope,
  enabledRootIds: readonly string[],
): string[] | undefined {
  switch (scope.kind) {
    case 'all':
      return undefined;
    case 'none':
      return [];
    case 'roots': {
      const enabled = new Set(enabledRootIds);
      return scope.rootIds.filter((id) => enabled.has(id));
    }
  }
}
