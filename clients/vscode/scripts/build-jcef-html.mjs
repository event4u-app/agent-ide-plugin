// Build the self-contained JCEF chat document for the JetBrains plugin
// (road-to-jcef-chat-parity Phase 1, council forks 1A + 2A: webview source
// stays in clients/vscode, the JetBrains client receives a build artifact).
//
// Two esbuild passes:
//   1. Bundle src/webview/chat-app.ts exactly like the VS Code webview build
//      (browser IIFE) — this is the SAME code path both IDEs run.
//   2. Bundle src/webview/chat-html-jcef.ts as CJS, evaluate it in-process,
//      and substitute the JS text into the `%E4U_BUNDLE%` placeholder.
//
// Output: clients/jetbrains/src/main/resources/webview/chat.html (gitignored
// build output — Gradle `processResources` picks it up when present; the
// Kotlin host degrades to a notice panel when it is absent, so `gradle check`
// never depends on the Node build).

import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, '..');
const repoRoot = join(clientRoot, '..', '..');
const outDir = join(repoRoot, 'clients', 'jetbrains', 'src', 'main', 'resources', 'webview');
const outFile = join(outDir, 'chat.html');

async function bundleText(entry, options) {
  const result = await build({
    entryPoints: [join(clientRoot, entry)],
    bundle: true,
    write: false,
    target: 'es2020',
    ...options,
  });
  return result.outputFiles[0].text;
}

const appJs = await bundleText('src/webview/chat-app.ts', {
  platform: 'browser',
  format: 'iife',
});

const builderCjs = await bundleText('src/webview/chat-html-jcef.ts', {
  platform: 'node',
  format: 'cjs',
});

// Evaluate the HTML builder without touching disk: route the CJS text through
// a data-URL-free Module shim via `module._compile` (node-internal but stable).
const require = createRequire(import.meta.url);
const Module = require('node:module');
const mod = new Module('chat-html-jcef', null);
mod._compile(builderCjs, join(clientRoot, 'src', 'webview', 'chat-html-jcef.cjs'));
const { buildJcefChatHtml } = mod.exports;

// `</script` inside the inlined bundle (only plausible inside string
// literals) would terminate the inline <script> early — escape it the
// standard way. `<\/` is identical to `</` inside a JS string literal.
const inlineSafeJs = appJs.replace(/<\/script/gi, '<\\/script');

const html = buildJcefChatHtml().replace('%E4U_BUNDLE%', () => inlineSafeJs);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
console.log(`[build-jcef-html] ${outFile} (${(html.length / 1024).toFixed(1)} KiB)`);
