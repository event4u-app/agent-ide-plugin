# Cross-platform notes (sidecar)

> Sprint-5 buffer item B-3. The Node sidecar runs on macOS / Linux / Windows;
> the unit-test suite executes on all three under the GitHub Actions matrix
> (Node 20 + 22, ubuntu / macos / windows latest). Manual checks for the
> JetBrains / VS Code surfaces live in `docs/MANUAL_VERIFICATION.md`.

## What CI covers

| Platform | Node 20 | Node 22 |
|---|:-:|:-:|
| ubuntu-latest | ✅ build · test · lint · format · typecheck | ✅ same |
| macos-latest | ✅ same | ✅ same |
| windows-latest | ✅ same | ✅ same |

Plus a JetBrains `gradle check` job (Kotlin compile + detekt + ktlint) on
JDK 17 / ubuntu-latest.

## Known platform gotchas

### Line endings (Windows)

The repo's `.gitattributes` pins LF for source files. Without it, Windows
checkouts ship CRLF, prettier flips them on `format:write`, and CI fails
the formatting check. Touching `.gitattributes` requires running
`git add --renormalize .` once.

### Spawn shell semantics

The cancellation token (T-412) calls `child.kill('SIGTERM')`. On Windows,
SIGTERM is mapped to TerminateProcess by Node — there's no grace period
between SIGTERM and SIGKILL. The test suite still asserts the timing
contract because it spawns Node directly (not a shell), and Node honours
the kill on every platform.

The Claude CLI backend (T-406) shells out to `claude -p`. On Windows we
expect the binary to live as `claude.cmd` on PATH; `spawn('claude', …)`
works because Node 20+ does the lookup. If you see "spawn claude ENOENT"
on Windows, check that `where claude` returns a path.

### `which` vs `where`

`packages/core/src/cli/claude-detection.ts` uses `which` on POSIX and
`where` on Windows; the platform check is `process.platform === 'win32'`.

### File-watch + hot-reload (T-207 future)

Hot-reload of `.agent-settings.yml` is deferred to T-207. When it lands,
expect a chokidar dependency; chokidar polls on Windows by default which
adds ~50 ms latency vs macOS / Linux. That's acceptable for a settings
file edited by hand.

### SQLite

The roadmap nominates `better-sqlite3` for T-408. Local Node 25 has no
prebuilds for that version of the package, so v0 ships JSONL persistence
under the same schema. The v1.0 upgrade path is a JSONL → INSERT loop
once we lock the supported Node range and `better-sqlite3` rebuilds
become reliable across the matrix.

### Permission semantics on Windows

The permission gate's hard-floor regex (`rm -rf /`, `git push --force`,
…) is platform-agnostic — patterns match the **command string** the model
emits regardless of which shell would run it. Windows-equivalent
patterns (`del /F /S /Q`, `format C:` …) are NOT in the v0 set; users
who run Windows-shell tools should add them via the v1.0 Sprint-6
permission-editing UI.

## Manual cross-platform verification

The Node sidecar is exercised by CI on every PR. The JetBrains and VS Code
plugin surfaces are not — they need a human-driven IDE. Walk
`docs/MANUAL_VERIFICATION.md § T-103 + T-105` on each platform you ship:

- macOS Apple Silicon (arm64)
- macOS Intel (x64)
- Linux x64
- Windows x64

Record each pass in the verification log at the bottom of that file.
