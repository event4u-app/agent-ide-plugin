#!/usr/bin/env bash
# Spike 0-3c — Claude CLI Pipe Robustness reproduction.
# Tests the failure-mode subtests defined in spike-0-3c-cli-pipe.md.

set -euo pipefail

# ----------------------------------------------------------------------------
# Test 1: clean abort mid-stream via SIGKILL
# ----------------------------------------------------------------------------
echo "[test 1] SIGKILL mid-stream"
echo "Write a 500-word story about a robot" \
  | claude --print --output-format=stream-json --verbose --max-turns 1 &
PID=$!
sleep 1
kill -9 "$PID" 2>/dev/null || true
sleep 0.5

if kill -0 "$PID" 2>/dev/null; then
  echo "[fail] zombie process $PID still running"
  exit 1
fi
echo "[pass] CLI exited cleanly under SIGKILL"

# ----------------------------------------------------------------------------
# Test 2: concurrent --resume against one session
# ----------------------------------------------------------------------------
echo "[test 2] concurrent --resume"
SESSION=$(echo "hello" \
  | claude --print --output-format=stream-json --max-turns 1 \
  | jq -r 'select(.type=="system") | .session_id' \
  | head -1)
echo "[info] session: $SESSION"

echo "Add a line" \
  | claude --print --resume "$SESSION" --output-format=stream-json --max-turns 1 \
  > /tmp/spike-0-3c-resume-1.ndjson 2>&1 &
P1=$!

echo "Add another line" \
  | claude --print --resume "$SESSION" --output-format=stream-json --max-turns 1 \
  > /tmp/spike-0-3c-resume-2.ndjson 2>&1 &
P2=$!

wait "$P1" "$P2" 2>&1 || true
echo "[info] resume 1 output:"
tail -3 /tmp/spike-0-3c-resume-1.ndjson
echo "[info] resume 2 output:"
tail -3 /tmp/spike-0-3c-resume-2.ndjson
echo "[manual] inspect for session-busy errors vs silent divergence"

# ----------------------------------------------------------------------------
# Test 3: rate-limit envelope detection
# ----------------------------------------------------------------------------
echo "[test 3] rate-limit envelope"
echo "hello" \
  | claude --print --output-format=stream-json --verbose --max-turns 1 \
  | jq -c 'select(.type=="rate_limit_event") | {status: .rate_limit_info.status, reset: .rate_limit_info.resetsAt}'

# ----------------------------------------------------------------------------
# Test 4: version downgrade (manual — requires older claude binary)
# ----------------------------------------------------------------------------
echo "[test 4] version downgrade — manual"
echo "  1. Install older claude binary at /tmp/claude-old"
echo "  2. PATH=/tmp:$PATH ./run-spike.sh"
echo "  3. Verify parser ignores unknown event types, completes turn, warns"
