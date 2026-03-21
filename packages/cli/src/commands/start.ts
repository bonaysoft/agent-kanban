import { mkdirSync, copyFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Command } from "commander";
import { startDaemon } from "../daemon.js";
import { setConfigValue, getConfigValue } from "../config.js";

function installSkill() {
  // import.meta.dirname → dist/commands/, go up to package root then to sibling skill package
  const cliRoot = join(import.meta.dirname, "../..");
  const src = join(cliRoot, "../skill/SKILL.md");
  if (!existsSync(src)) return;
  const dest = join(homedir(), ".claude/skills/agent-kanban");
  mkdirSync(dest, { recursive: true });
  copyFileSync(src, join(dest, "SKILL.md"));
  console.log("[INFO] Skill installed to ~/.claude/skills/agent-kanban/");
}

export function registerStartCommand(program: Command) {
  program
    .command("start")
    .description("Start the Machine daemon — auto-claim and execute tasks")
    .option("--api-url <url>", "API server URL")
    .option("--api-key <key>", "Machine API key")
    .option("--max-concurrent <n>", "Max concurrent agents", "3")
    .option("--agent-cli <cmd>", "Agent CLI command to spawn", "claude")
    .option("--poll-interval <ms>", "Poll interval in ms", "10000")
    .action(async (opts) => {
      if (opts.apiUrl) setConfigValue("api-url", opts.apiUrl);
      if (opts.apiKey) setConfigValue("api-key", opts.apiKey);

      if (!getConfigValue("api-url") || !getConfigValue("api-key")) {
        console.error("API URL and key required. Pass --api-url and --api-key, or set via: ak config set api-url <url>");
        process.exit(1);
      }

      installSkill();

      await startDaemon({
        maxConcurrent: parseInt(opts.maxConcurrent, 10),
        agentCli: opts.agentCli,
        pollInterval: parseInt(opts.pollInterval, 10),
      });
    });
}
