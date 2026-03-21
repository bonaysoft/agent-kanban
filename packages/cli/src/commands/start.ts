import { mkdirSync, cpSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Command } from "commander";
import { startDaemon } from "../daemon.js";
import { setConfigValue, getConfigValue } from "../config.js";

function installSkills() {
  // dist/commands/ → dist/skills/ (copied at build time from packages/skill/skills/)
  const skillsDir = join(import.meta.dirname, "../skills");
  if (!existsSync(skillsDir)) return;

  const destRoot = join(homedir(), ".claude/skills");
  const names = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const name of names) {
    const src = join(skillsDir, name);
    const dest = join(destRoot, name);
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  }

  if (names.length > 0) {
    console.log(`[INFO] Skills synced: ${names.join(", ")}`);
  }
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

      installSkills();

      await startDaemon({
        maxConcurrent: parseInt(opts.maxConcurrent, 10),
        agentCli: opts.agentCli,
        pollInterval: parseInt(opts.pollInterval, 10),
      });
    });
}
