// Bundle the Agent Core sidecar into the VS Code extension so a packaged `.vsix`
// runs with NO repo checkout. `resolveSidecarPath()` (extension.ts) prefers
// `<extensionPath>/sidecar/server.js`; this script puts it there. The root
// LICENSE is copied alongside so `vsce package` ships it (the manifest declares
// MIT). Both copied files are gitignored — they are build output, not source.
//
// AI council 2026-05-31, UNANIMOUS Fork 2A (copy the built single-file sidecar,
// keep the spawned-process boundary); ADR-017.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, '..');
const repoRoot = join(clientRoot, '..', '..');

const sidecarSrc = join(repoRoot, 'packages', 'core', 'dist', 'server.js');
const licenseSrc = join(repoRoot, 'LICENSE');

if (!existsSync(sidecarSrc)) {
  console.error(
    `[bundle-sidecar] missing ${sidecarSrc}\n` +
      `Run \`pnpm run build\` (or \`task build\`) first so the core sidecar exists.`,
  );
  process.exit(1);
}

const sidecarDir = join(clientRoot, 'sidecar');
mkdirSync(sidecarDir, { recursive: true });
copyFileSync(sidecarSrc, join(sidecarDir, 'server.js'));
console.log(`[bundle-sidecar] sidecar/server.js <- ${sidecarSrc}`);

if (existsSync(licenseSrc)) {
  copyFileSync(licenseSrc, join(clientRoot, 'LICENSE'));
  console.log('[bundle-sidecar] LICENSE <- repo root');
}
