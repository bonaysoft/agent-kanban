#!/usr/bin/env bash
set -euo pipefail

# Daemon smoke test: covers the full task scheduling lifecycle.
#
# Scenarios tested:
#   1. Dispatch    — create task → daemon claims → agent runs → in_review
#   2. Reject/Resume — reject in_review task → daemon resumes agent → back to in_review
#   3. Complete    — complete task → daemon cleans up session + worktree
#   4. Cancel      — create task → cancel while agent is running → daemon kills agent
#
# Usage: ./scripts/daemon-smoke-test.sh <board_id> <agent_id> <repo_id>
# All three arguments are required.

BOARD_ID="${1:?Usage: $0 <board_id> <agent_id> <repo_id>}"
AGENT_ID="${2:?Usage: $0 <board_id> <agent_id> <repo_id>}"
REPO_ID="${3:?Usage: $0 <board_id> <agent_id> <repo_id>}"

PASS=0
FAIL=0
TASKS=()
TIMESTAMP=$(date +%s)

# ── Helpers ──────────────────────────────────────────────────────────────────

create_task() {
  local title="$1"
  local desc="$2"
  local id
  id=$(ak create task \
    --board "$BOARD_ID" \
    --title "$title" \
    --description "$desc" \
    --repo "$REPO_ID" \
    --assign-to "$AGENT_ID" \
    --priority low 2>&1 | sed -n 's/Created task \([^: ]*\).*/\1/p')
  if [ -z "$id" ]; then
    echo "  FATAL: failed to create task"
    exit 1
  fi
  TASKS+=("$id")
  echo "$id"
}

wait_status() {
  local task_id="$1" status="$2" timeout="${3:-10m}"
  ak wait task "$task_id" --until "$status" --timeout "$timeout" >/dev/null 2>&1
}

task_status() {
  ak describe task "$1" 2>/dev/null | sed -n 's/^Status: *//p'
}

task_session_file() {
  local task_id="$1"
  ls ~/.local/state/agent-kanban/sessions/*.json 2>/dev/null \
    | xargs grep -l "\"taskId\": *\"$task_id\"" 2>/dev/null | head -1
}

task_session_status() {
  local task_id="$1"
  local file
  file="$(task_session_file "$task_id")"
  [ -n "$file" ] && python3 -c "import json,sys; print(json.load(open('$file')).get('status',''))" 2>/dev/null || echo ""
}

# Sessions are retained as "closed" after cleanup (for history lookup).
# "cleaned up" means: session reached "closed" state (or file is gone).
wait_session_cleanup() {
  local task_id="$1" timeout_secs="${2:-120}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout_secs" ]; do
    local status
    status="$(task_session_status "$task_id")"
    if [ -z "$status" ] || [ "$status" = "closed" ]; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# ── Preflight ────────────────────────────────────────────────────────────────

echo "=== Daemon Smoke Test ==="
echo "  Board: $BOARD_ID"
echo "  Agent: $AGENT_ID"
echo "  Repo:  $REPO_ID"
echo ""

DAEMON_STATUS=$(ak status 2>&1 | head -1)
if ! echo "$DAEMON_STATUS" | grep -q "running"; then
  echo "FATAL: daemon is not running. Start with: ak start"
  exit 1
fi
echo "Daemon: $DAEMON_STATUS"
echo ""

# ── Test 1: Dispatch (create → claim → in_review) ───────────────────────────

echo "[Test 1/4] Dispatch — create task, wait for in_review"
T1=$(create_task "smoke-dispatch-$TIMESTAMP" "Run pnpm install. Add file smoke-dispatch-$TIMESTAMP.txt with timestamp. Commit and PR.")
echo "  Task: $T1"

if wait_status "$T1" in_review; then
  pass "task reached in_review"
  # Verify PR was created
  PR=$(ak describe task "$T1" 2>/dev/null | sed -n 's/^PR: *//p')
  if [ -n "$PR" ]; then
    pass "PR created: $PR"
  else
    fail "no PR link on in_review task"
  fi
else
  fail "task did not reach in_review"
fi
echo ""

# ── Test 2: Reject/Resume (reject → daemon resumes → back to in_review) ─────

echo "[Test 2/4] Reject/Resume — reject task, wait for re-review"
# Wait for daemon to finish finalize (session preservation) after in_review
sleep 5
ak task reject "$T1" --reason "Smoke test: change file content to REJECTED" >/dev/null 2>&1

STATUS_AFTER_REJECT=$(task_status "$T1")
if [ "$STATUS_AFTER_REJECT" = "in_progress" ]; then
  pass "task back to in_progress after reject"
else
  fail "expected in_progress after reject, got: $STATUS_AFTER_REJECT"
fi

if wait_status "$T1" in_review; then
  pass "task reached in_review again after reject-resume"
else
  fail "task did not reach in_review after reject"
fi
echo ""

# ── Test 3: Complete (complete task → session cleaned up) ────────────────────

echo "[Test 3/4] Complete — mark task done, verify cleanup"
ak task complete "$T1" >/dev/null 2>&1

STATUS_AFTER_COMPLETE=$(task_status "$T1")
if [ "$STATUS_AFTER_COMPLETE" = "done" ]; then
  pass "task is done"
else
  fail "expected done, got: $STATUS_AFTER_COMPLETE"
fi

if wait_session_cleanup "$T1" 120; then
  pass "session cleaned up after completion"
else
  fail "session still exists after completion timeout"
fi
echo ""

# ── Test 4: Cancel (create → cancel while running → agent killed) ────────────

echo "[Test 4/4] Cancel — create task, cancel while running, verify cleanup"
T4=$(create_task "smoke-cancel-$TIMESTAMP" "Run pnpm install. Then run: sleep 300. This task will be cancelled.")
echo "  Task: $T4"

# Wait for agent to start (in_progress)
if wait_status "$T4" in_progress 2m; then
  pass "task reached in_progress"
else
  fail "task did not reach in_progress"
fi

# Cancel while agent is running
sleep 3
ak task cancel "$T4" >/dev/null 2>&1

STATUS_AFTER_CANCEL=$(task_status "$T4")
if [ "$STATUS_AFTER_CANCEL" = "cancelled" ]; then
  pass "task is cancelled"
else
  fail "expected cancelled, got: $STATUS_AFTER_CANCEL"
fi

# Wait for cancelled task's session to reach "closed" state
if wait_session_cleanup "$T4" 60; then
  T4_STATUS="$(task_session_status "$T4")"
  pass "cancelled task session cleaned up (status=${T4_STATUS:-gone})"
else
  T4_STATUS="$(task_session_status "$T4")"
  fail "cancelled task session not cleaned up after 60s (status=$T4_STATUS)"
fi
echo ""

# ── Summary ──────────────────────────────────────────────────────────────────

echo "==============================="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "==============================="

# Cleanup test tasks
if [ "${#TASKS[@]}" -gt 0 ]; then
  for tid in "${TASKS[@]}"; do
    ak task cancel "$tid" >/dev/null 2>&1 || true
  done
fi

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
