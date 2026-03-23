#!/usr/bin/env bash
set -euo pipefail

# Smoke test: create repo → create task (assigned to agent) → daemon picks it up
# Usage: ./scripts/smoke-test.sh [repo_url]

REPO_URL="${1:-https://github.com/saltbo/hello-agent-test}"
REPO_NAME="$(basename "$REPO_URL" .git)"

echo "=== Agent Kanban Smoke Test ==="
echo ""

# 1. Check board exists
echo "[1/5] Checking board..."
BOARD=$(ak board list --format json)
BOARD_ID=$(echo "$BOARD" | jq -r '.[0].id // empty')
if [ -z "$BOARD_ID" ]; then
  echo "  No board found, creating one..."
  BOARD_ID=$(ak board create --name "Smoke Test Board" --format json | jq -r '.id')
fi
echo "  Board: $BOARD_ID"

# 2. Check agent exists
echo "[2/5] Checking agent..."
AGENTS=$(ak agent list --format json)
AGENT_ID=$(echo "$AGENTS" | jq -r '.[0].id // empty')
if [ -z "$AGENT_ID" ]; then
  echo "  ERROR: No agent registered. Create one first:"
  echo "    ak agent create --template fullstack-developer"
  exit 1
fi
AGENT_NAME=$(echo "$AGENTS" | jq -r '.[0].name')
AGENT_STATUS=$(echo "$AGENTS" | jq -r '.[0].status')
echo "  Agent: $AGENT_NAME ($AGENT_ID) — status: $AGENT_STATUS"

# 3. Add repository (idempotent)
echo "[3/5] Adding repository: $REPO_URL"
EXISTING_REPO=$(ak repo list --format json | jq -r --arg url "$REPO_URL" '.[] | select(.url == $url) | .id // empty')
if [ -n "$EXISTING_REPO" ]; then
  REPO_ID="$EXISTING_REPO"
  echo "  Already exists: $REPO_ID"
else
  REPO_ID=$(ak repo add --name "$REPO_NAME" --url "$REPO_URL" --format json | jq -r '.id')
  echo "  Created: $REPO_ID"
fi

# 4. Create task and assign to agent in one step
TIMESTAMP=$(date +%H:%M:%S)
TASK_TITLE="Smoke test — $TIMESTAMP"
echo "[4/5] Creating task: $TASK_TITLE (assigned to $AGENT_NAME)"
TASK=$(ak task create \
  --title "$TASK_TITLE" \
  --description "Automated smoke test. Add a file named smoke-test-$TIMESTAMP.txt with the current timestamp. Then commit and open a PR." \
  --repo "$REPO_ID" \
  --assign-to "$AGENT_ID" \
  --priority low \
  --labels "smoke-test" \
  --format json)
TASK_ID=$(echo "$TASK" | jq -r '.id')
echo "  Task: $TASK_ID"

# 5. Verify task state
echo "[5/5] Verifying task..."
ak task list --format json | jq --arg id "$TASK_ID" '.[] | select(.id == $id) | {id, title, status, assigned_to}'

echo ""
echo "=== Smoke test complete ==="
echo "Task $TASK_ID is assigned and waiting for daemon to claim + execute."
echo ""
echo "Monitor:"
echo "  ak task list --status todo"
echo "  ak task list --status in_progress"
