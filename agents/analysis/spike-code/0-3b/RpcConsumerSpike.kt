// Spike 0-3b — JVM consumer. Spawns the Node sidecar, parses NDJSON,
// measures inter-event latency + heap delta.
//
// Build + run:
//   kotlinc RpcConsumerSpike.kt -include-runtime -d spike.jar
//   java -Xmx256m -jar spike.jar happy
//   java -Xmx256m -jar spike.jar burst

package event4u.spike.rpc

import java.io.BufferedReader
import java.io.InputStreamReader
import java.lang.management.ManagementFactory
import kotlin.system.measureNanoTime

fun main(args: Array<String>) {
    val mode = args.firstOrNull() ?: "happy"
    val sidecarTs = "agents/analysis/spike-code/0-3b/sidecar.ts"

    val pb = ProcessBuilder("node", "--enable-source-maps", sidecarTs, mode)
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
            measureNanoTime {
                require(line.startsWith("{") && line.endsWith("}"))
                count += 1
            }
            val now = System.nanoTime()
            perBatchLatencies += (now - lastTick)
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

    println(
        "mode=$mode total=$count wall=${wallMs}ms " +
            "p50=${"%.2f".format(p50)}ms p99=${"%.2f".format(p99)}ms " +
            "heapDelta=${memDelta / (1024 * 1024)}MB",
    )
    proc.waitFor()
}
