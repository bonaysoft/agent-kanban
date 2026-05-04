// @vitest-environment node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = join(__dirname, "../scripts/daemon-smoke-test.sh");

function readScript() {
  return readFileSync(scriptPath, "utf8");
}

describe("daemon smoke script", () => {
  it("has valid bash syntax", () => {
    execFileSync("bash", ["-n", scriptPath], { stdio: "pipe" });
  });

  it("creates temporary agents instead of discovering reusable smoke agents", () => {
    const script = readScript();

    expect(script).toContain("Usage: ./scripts/daemon-smoke-test.sh <runtime> [board_id] [repo_id]");
    expect(script).toContain("runtime is required");
    expect(script).toContain("CREATED_AGENT_IDS=()");
    expect(script).toContain("trap cleanup EXIT");
    expect(script).toContain('ak delete agent "$agent_id"');
    expect(script).toContain("codex, claude, gemini, or copilot");
  });

  it("creates smoke agents for each supported runtime", () => {
    const script = readScript();

    expect(script).toContain("codex)");
    expect(script).toContain('username="codex-smoke-$TIMESTAMP"');
    expect(script).toContain("claude)");
    expect(script).toContain('username="claude-smoke-$TIMESTAMP"');
    expect(script).toContain("gemini)");
    expect(script).toContain('username="gemini-smoke-$TIMESTAMP"');
    expect(script).toContain("copilot)");
    expect(script).toContain('username="copilot-smoke-$TIMESTAMP"');
  });

  it("checks runtime-specific subagent definition paths", () => {
    const script = readScript();

    expect(script).toContain('codex) expected=".codex/agents/$SUBAGENT_USERNAME.toml"');
    expect(script).toContain('claude | copilot) expected=".claude/agents/$SUBAGENT_USERNAME.md"');
    expect(script).toContain('gemini) expected=".gemini/agents/$SUBAGENT_USERNAME.md"');
  });
});
