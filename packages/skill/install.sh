#!/bin/bash
# Install the agent-kanban skill for Claude Code

SKILL_DIR="$HOME/.claude/skills/agent-kanban"
mkdir -p "$SKILL_DIR"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/SKILL.md" "$SKILL_DIR/SKILL.md"

echo "Installed agent-kanban skill to $SKILL_DIR"
