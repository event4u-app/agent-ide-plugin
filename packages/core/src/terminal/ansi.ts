/**
 * Minimal ANSI escape stripper for the waiting-for-input heuristic.
 *
 * Council guard (gemini-2.5-pro, 2026-05-31): the ring buffer stores RAW output
 * (xterm.js wants the colour codes), but the prompt heuristic must run over a
 * stripped view — otherwise a coloured `\x1b[32mPassword:\x1b[0m` prompt never
 * matches `/password:\s*$/`. This is the only place core strips ANSI; it does
 * NOT model a terminal screen (no cursor, no scrollback reconstruction).
 */

// Canonical ansi-regex shape (chalk/ansi-regex), authored with \x1b/\x07
// escapes so the source stays pure ASCII. Matches CSI (`ESC [ … final`) and
// OSC (`ESC ] … BEL`) sequences — enough to clean a prompt tail.
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\x1b\x9b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\x07)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

/** Return `input` with ANSI escape sequences removed. Pure, allocation-light. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}
