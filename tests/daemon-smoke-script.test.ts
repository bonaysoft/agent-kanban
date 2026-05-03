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

  it("accepts all subagent-capable runtimes during agent discovery", () => {
    const script = readScript();

    expect(script).toContain("['codex', 'claude', 'gemini', 'copilot'].includes(a.runtime)");
    expect(script).toContain("codex, claude, gemini, or copilot");
  });

  it("creates smoke agents for each supported runtime", () => {
    const script = readScript();

    expect(script).toContain("codex)");
    expect(script).toContain('username="codex-smoke-nomodel"');
    expect(script).toContain("claude)");
    expect(script).toContain('username="claude-smoke"');
    expect(script).toContain("gemini)");
    expect(script).toContain('username="gemini-smoke"');
    expect(script).toContain("copilot)");
    expect(script).toContain('username="copilot-smoke"');
  });

  it("checks runtime-specific subagent definition paths", () => {
    const script = readScript();

    expect(script).toContain('codex) expected=".codex/agents/$SUBAGENT_USERNAME.toml"');
    expect(script).toContain('claude | copilot) expected=".claude/agents/$SUBAGENT_USERNAME.md"');
    expect(script).toContain('gemini) expected=".gemini/agents/$SUBAGENT_USERNAME.md"');
  });
});
