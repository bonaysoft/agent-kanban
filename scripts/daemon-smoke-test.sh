#!/usr/bin/env bash
set -euo pipefail

# Daemon smoke test: covers the full task scheduling lifecycle.
#
# Scenarios tested:
#   1. Dispatch    — create task → daemon claims → installs subagents → agent runs → in_review
#   2. Reject/Resume — reject in_review task → daemon resumes agent → back to in_review
#   3. Complete    — complete task → daemon cleans up session + worktree
#   4. Cancel      — create task → cancel while agent is running → daemon kills agent
#
# Usage: ./scripts/daemon-smoke-test.sh [board_id] [agent_id] [repo_id]
# Missing arguments are discovered or created. Defaults target the Demo board
# and the slink repository.

BOARD_ID="${1:-}"
AGENT_ID="${2:-}"
REPO_ID="${3:-}"

PASS=0
FAIL=0
TASKS=()
TIMESTAMP=$(date +%s)
SUBAGENT_ID=""
SUBAGENT_USERNAME=""
AGENT_RUNTIME=""

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

json_query() {
  local query="$1"
  node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(0, 'utf8'));
const result = ($query);
if (result === undefined || result === null) process.exit(1);
if (typeof result === 'object') console.log(JSON.stringify(result));
else console.log(result);
"
}

discover_board() {
  ak get board -o json | json_query "data.find((b) => b.id === 'k847fy7k')?.id || data.find((b) => b.name === 'Demo')?.id || data[0]?.id"
}

create_board() {
  ak create board --name "Demo" --type dev -o json | json_query "data.id"
}

discover_repo() {
  ak get repo -o json | json_query "data.find((r) => r.name === 'slink' || r.full_name === 'saltbo/slink')?.id || data[0]?.id"
}

create_repo() {
  ak create repo --name "slink" --url "https://github.com/saltbo/slink" -o json | json_query "data.id"
}

discover_agent() {
  ak get agent -o json | json_query "data.find((a) => a.builtin !== 1 && a.username === 'codex-smoke-nomodel' && a.runtime_available && a.active_task_count === 0)?.id || data.find((a) => a.builtin !== 1 && a.username === 'codex-smoke-nomodel' && a.runtime_available)?.id || data.find((a) => a.builtin !== 1 && (a.runtime === 'codex' || a.runtime === 'claude') && a.runtime_available && a.active_task_count === 0)?.id || data.find((a) => a.builtin !== 1 && (a.runtime === 'codex' || a.runtime === 'claude') && a.runtime_available)?.id"
}

discover_runtime() {
  local status
  status="$(ak status)"
  if echo "$status" | grep -q "codex"; then
    echo "codex"
    return 0
  fi
  if echo "$status" | grep -q "claude"; then
    echo "claude"
    return 0
  fi
  return 1
}

create_agent() {
  local runtime="$1"
  local name username bio
  if [ "$runtime" = "codex" ]; then
    name="Codex Smoke NoModel"
    username="codex-smoke-nomodel"
    bio="Codex worker for daemon smoke tests"
  else
    name="Claude Smoke"
    username="claude-smoke"
    bio="Claude worker for daemon smoke tests"
  fi
  ak create agent \
    --name "$name" \
    --username "$username" \
    --runtime "$runtime" \
    --role "fullstack-developer" \
    --bio "$bio" \
    -o json | json_query "data.id"
}

agent_field() {
  local agent_id="$1" field="$2"
  ak get agent "$agent_id" -o json | json_query "data['$field']"
}

ensure_smoke_subagent() {
  local runtime="$1"
  local username="smoke-subagent-$runtime"
  local existing
  existing=$(ak get agent -o json | json_query "data.find((a) => a.username === '$username')?.id" 2>/dev/null || true)
  if [ -n "$existing" ]; then
    SUBAGENT_ID="$existing"
  else
    SUBAGENT_ID=$(ak create agent \
      --name "Smoke Subagent $runtime" \
      --username "$username" \
      --runtime "$runtime" \
      --role "smoke-subagent" \
      --bio "Registered worker used by daemon smoke tests to verify task-local subagent installation" \
      --soul "I am a smoke-test helper subagent. Keep answers short and verify delegated work precisely." \
      -o json | json_query "data.id")
  fi
  SUBAGENT_USERNAME="$username"
}

ensure_agent_subagent_link() {
  local current
  current=$(ak get agent "$AGENT_ID" -o json | json_query "((data.subagents || []).includes('$SUBAGENT_ID') ? (data.subagents || []) : [...(data.subagents || []), '$SUBAGENT_ID']).join(',')")
  ak update agent "$AGENT_ID" --subagents "$current" >/dev/null
}

wait_subagent_file() {
  local task_id="$1" timeout_secs="${2:-120}"
  local elapsed=0
  local expected
  case "$AGENT_RUNTIME" in
    codex) expected=".codex/agents/$SUBAGENT_USERNAME.toml" ;;
    claude) expected=".claude/agents/$SUBAGENT_USERNAME.md" ;;
    *) fail "unsupported smoke runtime for subagent file check: $AGENT_RUNTIME"; return 1 ;;
  esac

  while [ "$elapsed" -lt "$timeout_secs" ]; do
    local file cwd
    file="$(task_session_file "$task_id")"
    if [ -n "$file" ]; then
      cwd=$(node -e "const s=require('$file'); console.log(s.workspace && s.workspace.cwd || '')" 2>/dev/null || true)
      if [ -n "$cwd" ] && [ -f "$cwd/$expected" ]; then
        return 0
      fi
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
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

if [ -z "$BOARD_ID" ]; then BOARD_ID="$(discover_board 2>/dev/null || true)"; fi
if [ -z "$BOARD_ID" ]; then BOARD_ID="$(create_board)"; fi
if [ -z "$REPO_ID" ]; then REPO_ID="$(discover_repo 2>/dev/null || true)"; fi
if [ -z "$REPO_ID" ]; then REPO_ID="$(create_repo)"; fi
if [ -z "$AGENT_ID" ]; then AGENT_ID="$(discover_agent 2>/dev/null || true)"; fi
if [ -z "$AGENT_ID" ]; then
  RUNTIME_TO_CREATE="$(discover_runtime 2>/dev/null || true)"
  if [ -z "$RUNTIME_TO_CREATE" ]; then
    echo "FATAL: no available subagent-capable runtime found (codex or claude). Start a daemon with one of those providers ready."
    exit 1
  fi
  AGENT_ID="$(create_agent "$RUNTIME_TO_CREATE")"
fi
if [ -z "$BOARD_ID" ] || [ -z "$REPO_ID" ] || [ -z "$AGENT_ID" ]; then
  echo "FATAL: failed to discover board, repo, or agent"
  echo "  Board: ${BOARD_ID:-missing}"
  echo "  Repo:  ${REPO_ID:-missing}"
  echo "  Agent: ${AGENT_ID:-missing}"
  exit 1
fi

AGENT_RUNTIME="$(agent_field "$AGENT_ID" runtime)"
if [ "$AGENT_RUNTIME" != "codex" ] && [ "$AGENT_RUNTIME" != "claude" ]; then
  echo "FATAL: smoke agent runtime must support subagents (codex or claude), got: $AGENT_RUNTIME"
  exit 1
fi
ensure_smoke_subagent "$AGENT_RUNTIME"
ensure_agent_subagent_link

echo "  Board: $BOARD_ID"
echo "  Agent: $AGENT_ID"
echo "  Runtime: $AGENT_RUNTIME"
echo "  Subagent: $SUBAGENT_ID ($SUBAGENT_USERNAME)"
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

echo "[Test 1/4] Dispatch — create task, verify subagent install, wait for in_review"
T1=$(create_task "smoke-dispatch-$TIMESTAMP" "Run pnpm install. Verify that the smoke subagent definition is installed in this workspace. Add file smoke-dispatch-$TIMESTAMP.txt with timestamp. Commit and PR.")
echo "  Task: $T1"

if wait_status "$T1" in_progress 2m; then
  pass "task reached in_progress"
  if wait_subagent_file "$T1" 120; then
    pass "subagent definition installed in task workspace"
  else
    fail "subagent definition was not installed in task workspace"
  fi
else
  fail "task did not reach in_progress"
fi

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
