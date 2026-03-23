#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Building ==="
cd "$ROOT"
pnpm --filter @agent-kanban/shared build
pnpm --filter agent-kanban build

echo "=== Linking ==="
cd "$ROOT/packages/cli"
npm link

echo ""
echo "Done! Commands available: ak, agent-kanban"
ak --version
