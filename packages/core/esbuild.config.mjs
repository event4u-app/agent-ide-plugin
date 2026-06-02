import { build } from 'esbuild';

/**
 * Sidecar bundle (`dist/server.js`).
 *
 * Moved off the inline `esbuild` CLI command (ADR-043) so the banner can carry
 * a multi-line `createRequire` shim cleanly and cross-platform (an embedded
 * newline inside a JSON-escaped npm-script string is fragile on the Windows CI
 * runner).
 *
 * Why the shim: the bundle is ESM (`format: 'esm'`), but some bundled
 * dependencies are CJS and do a dynamic `require(...)` of node builtins —
 * `yaml`'s composer does `require("process")`. esbuild's ESM `__require` shim
 * throws `Dynamic require of "process" is not supported` unless a real
 * `require` exists in scope. `createRequire(import.meta.url)` provides one.
 * `yaml` only ever dynamic-requires node builtins (always resolvable), so the
 * shim is safe for the single-file packaged sidecar. ESM-only — the VS Code
 * extension build is CJS and needs no shim (AI council 2026-06-02 Q1=A).
 */
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/server.js',
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __createRequire } from "node:module";',
      'if (typeof globalThis.require === "undefined") globalThis.require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});
