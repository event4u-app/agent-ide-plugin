// Spike 0-3b — Node sidecar emitter. Simulates LLM-streamed token deltas.
// Run via: node --enable-source-maps sidecar.ts <mode>
// mode = "happy" (5000 tokens over 3s) | "burst" (10000 tokens over 2s)

import { stdout } from "node:process";

type Event =
  | { messageId: string; messageType: "token"; data: { token: string }; done: false }
  | { messageId: string; messageType: "token"; data: {}; done: true };

const mode = process.argv[2] ?? "happy";
const total = mode === "burst" ? 10000 : 5000;
const windowMs = mode === "burst" ? 2000 : 3000;
const batchMs = 50;
const batchSize = Math.ceil((total / windowMs) * batchMs);
const messageId = "spike-0-3b";

let sent = 0;

const tick = setInterval(() => {
  if (sent >= total) {
    const final: Event = { messageId, messageType: "token", data: {}, done: true };
    stdout.write(JSON.stringify(final) + "\n");
    clearInterval(tick);
    process.exit(0);
  }
  const n = Math.min(batchSize, total - sent);
  for (let i = 0; i < n; i++) {
    const ev: Event = {
      messageId,
      messageType: "token",
      data: { token: `tok_${sent + i}` },
      done: false,
    };
    stdout.write(JSON.stringify(ev) + "\n");
  }
  sent += n;
}, batchMs);

process.stderr.write(
  `[sidecar] mode=${mode} total=${total} window=${windowMs}ms batch=${batchSize}/${batchMs}ms\n`,
);
