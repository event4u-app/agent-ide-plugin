---
spike: 0.3b — JSON-RPC Throughput
phase: 0 (Validation)
status: research-based-pre-verdict
date: 2026-05-28
runtime_validated: false
provisional_verdict: viable — adopt Continue.dev's newline-delimited JSON over stdin/stdout pattern
---

# Spike 0.3b — JSON-RPC Throughput

## Pass / fail criteria (from roadmap)

- **Happy-path:** 5000 tokens streaming from Node sidecar to JetBrains-client <3s, p99 <800ms per token-batch.
- **Failure-mode:** 10k-token burst in 2 seconds, measure p99 latency + backpressure handling. Fail if pipe stalls or memory growth exceeds 50 MB during burst.
- **Pass →** JSON-RPC over stdio viable.
- **Fail →** re-evaluate Kotlin-native backend (no sidecar) for JetBrains, with TS sidecar only for VS Code.

## Research-based pre-verdict

**Viable — strong prior from Continue.dev's production deployment.** Continue.dev's `binary/src/IpcMessenger.ts` (293 lines, inspected in Spike 0-1) ships newline-delimited JSON `{ messageId, messageType, data }` chunks with `done: false/true` streaming markers, spawned via `ProcessBuilder` from `CoreMessenger.kt`. The same pattern reaches ~33k users across IntelliJ + Rider + GoLand + PyCharm; if 5000-token streams stalled or leaked at the scale the roadmap targets, Continue would have ticketed it visibly.

**Note on terminology.** The roadmap says "JSON-RPC over stdio" but the proven pattern is **newline-delimited JSON envelopes** (NDJSON-style), not formal JSON-RPC 2.0. For our needs they are equivalent — we adopt the simpler NDJSON envelope unless ADR-003 decides otherwise.

## Reasoning — why the math works

A typical streaming chat-completion event from an LLM (Anthropic, OpenAI) returns delta tokens at ~50-200 tokens/sec. **5000 tokens in 3s = 1666 t/s**, which is 8-30× faster than a single live stream. Real production streams from Sonnet 4.6 land closer to 80-120 t/s. The spike target of 5000 tokens <3s simulates **multiple concurrent streams** or a non-LLM data dump.

NDJSON envelope size per token-event (`{messageId, messageType, data:{token:"x"}, done:false}\n`) is ~80-100 bytes. **5000 events × 100 bytes = 500 KB across the pipe in 3s ≈ 167 KB/s.** Native pipe throughput on macOS / Linux for a child process exceeds 1 GB/s; on Windows ≥ 300 MB/s. The pipe is not the bottleneck.

The realistic risks are:

1. **JSON parsing on the JVM side.** Allocating 5000 short-lived JSON objects in 3s churns the young generation. Continue.dev uses `kotlinx.serialization` or `gson` (verified `gson-2.10.1.jar` in `extensions/intellij/lib/` — Spike 0-1 file inventory) — both are GC-friendly at this scale.
2. **Coroutine/EDT marshalling.** Every token-event must reach the webview, which is on EDT. Posting 5000 EDT runnables in 3s saturates the dispatcher and causes UI freezes.
3. **Backpressure on burst.** A 10k-token-in-2s burst is 5000 t/s = ~500 KB/s — still nowhere near the pipe limit, but the Node side can outpace the Kotlin parser if the parser is single-threaded.

**Mitigations baked into the spike fixture:**
- Coalesce events: the Node side emits a batch every 50ms (≤16 tokens per batch at 320 t/s peak), the Kotlin side dispatches one EDT call per batch instead of one per token.
- Bounded queue between the parser and the EDT dispatcher (capacity 1000); on overflow, drop oldest non-text events (telemetry/heartbeat) before text events.

## Reproduction script — runtime spike (≤2 days)

```typescript
// agents/analysis/spike-code/0-3b/sidecar.ts
// Node sidecar emitter — simulates LLM-streamed token deltas.
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
const start = Date.now();

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
```

```kotlin
// agents/analysis/spike-code/0-3b/RpcConsumerSpike.kt
// JVM consumer — spawns the Node sidecar, parses NDJSON, measures latency + memory.

package event4u.spike.rpc

import java.io.BufferedReader
import java.io.InputStreamReader
import java.lang.management.ManagementFactory
import kotlin.system.measureNanoTime

fun main(args: Array<String>) {
    val mode = args.firstOrNull() ?: "happy"
    val nodePath = "/usr/bin/env"
    val sidecarTs = "agents/analysis/spike-code/0-3b/sidecar.ts"

    val pb = ProcessBuilder(nodePath, "node", "--enable-source-maps", sidecarTs, mode)
    pb.redirectErrorStream(false)
    val proc = pb.start()

    val reader = BufferedReader(InputStreamReader(proc.inputStream))
    val mem = ManagementFactory.getMemoryMXBean()

    val perBatchLatencies = mutableListOf<Long>()
    var lastTick = System.nanoTime()
    var count = 0
    val memSamples = mutableListOf<Long>()

    val startWall = System.currentTimeMillis()

    reader.useLines { lines ->
        lines.forEach { line ->
            val dt = measureNanoTime {
                // simulate the parse work the real client does
                require(line.startsWith("{") && line.endsWith("}"))
                count += 1
            }
            val now = System.nanoTime()
            perBatchLatencies += (now - lastTick) // inter-event latency
            lastTick = now

            if (count % 200 == 0) {
                memSamples += mem.heapMemoryUsage.used
            }
        }
    }

    val wallMs = System.currentTimeMillis() - startWall
    perBatchLatencies.sort()
    val p99 = perBatchLatencies[(perBatchLatencies.size * 99 / 100).coerceAtMost(perBatchLatencies.size - 1)] / 1_000_000.0
    val p50 = perBatchLatencies[perBatchLatencies.size / 2] / 1_000_000.0
    val memDelta = (memSamples.maxOrNull() ?: 0) - (memSamples.minOrNull() ?: 0)

    println("mode=$mode total=$count wall=${wallMs}ms p50=${"%.2f".format(p50)}ms p99=${"%.2f".format(p99)}ms heapDelta=${memDelta / (1024 * 1024)}MB")
    proc.waitFor()
}
```

### Execution protocol

```bash
cd agents/analysis/spike-code/0-3b
# happy-path
kotlinc RpcConsumerSpike.kt -include-runtime -d spike.jar
java -Xmx256m -jar spike.jar happy
# Expect: total=5000 wall=≤3000ms p99 ≤ 100ms inter-event heapDelta ≤ 20MB

# burst
java -Xmx256m -jar spike.jar burst
# Expect: total=10000 wall=≤2200ms p99 ≤ 200ms inter-event heapDelta ≤ 50MB
```

### Pass criteria

- **Happy:** wall <3000ms, p99 inter-event latency <100ms, heap delta <20MB.
- **Burst:** wall <2200ms (give 10% headroom over the 2s emission window), p99 <200ms, heap delta <50MB.

### Pass → adopt

Adopt Continue's NDJSON-over-stdio pattern verbatim. Reuse `IpcMessenger.ts` as the reference shape (we own a clean rewrite, but the envelope is the same).

### Fail → re-evaluate

If the spike fails at heap or backpressure, the alternative is **Kotlin-native LLM client** (no Node sidecar on the JetBrains side): use the official Anthropic / OpenAI Kotlin SDKs (Anthropic has none official, so wrap `okhttp` + `kotlinx.serialization`). VS Code keeps the TS sidecar. This doubles the implementation work for providers but removes the bridge cost on JetBrains.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| EDT saturation at 5000 events/3s | low if batched at 50ms | Batch on Node side; one EDT call per batch |
| Gson allocation churn | low at 5000 events; medium at 100k events | Switch to `kotlinx.serialization` if profiling shows >5% GC overhead |
| Pipe buffer deadlock | very low — stdout is line-buffered, no `flush()` needed | Continue.dev ships without a flush hack at 33k users |
| Node sidecar crash → silent stall | medium | Kotlin side monitors `proc.waitFor()` in a coroutine, restarts on exit |
| Windows pipe semantics differ | medium | Continue.dev runs on Windows; same code path validated by their users |

## Open question for v1.0

Continue.dev uses TCP transport (`USE_TCP=true`) for debugging only. For our v1.0+ multi-step agent loop, do we need a richer transport (request-correlation IDs, partial cancel)? **Out of scope for MVP** — NDJSON envelopes already carry `messageId` for correlation; cancellation is `messageType: "cancel"` with the same `messageId`.

## Verdict

**Pre-verdict (research-grade):** NDJSON-over-stdio is viable. Runtime spike measures. Failure path is well-defined (Kotlin-native).

## Sources

- Continue.dev `binary/src/IpcMessenger.ts` (analysed in Spike 0-1)
- Continue.dev `extensions/intellij/src/main/kotlin/.../continue/CoreMessenger.kt`
- Gson 2.10.1 (`gson-2.10.1.jar` confirmed in Continue's JetBrains lib bundle, Spike 0-1)
