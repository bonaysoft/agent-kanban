import type { Command } from "commander";
import { startDaemon } from "../daemon.js";
import { setConfigValue, getConfigValue } from "../config.js";

export function registerStartCommand(program: Command) {
  program
    .command("start")
    .description("Start the Machine daemon — auto-claim and execute tasks")
    .option("--api-url <url>", "API server URL")
    .option("--api-key <key>", "Machine API key")
    .option("--max-concurrent <n>", "Max concurrent agents", "3")
    .option("--agent-cli <cmd>", "Agent CLI command to spawn", "claude")
    .option("--poll-interval <ms>", "Poll interval in ms", "10000")
    .option("--task-timeout <ms>", "Task timeout in ms (0 to disable)", "7200000")
    .action(async (opts) => {
      if (opts.apiUrl) setConfigValue("api-url", opts.apiUrl);
      if (opts.apiKey) setConfigValue("api-key", opts.apiKey);

      if (!getConfigValue("api-url") || !getConfigValue("api-key")) {
        console.error("API URL and key required. Pass --api-url and --api-key, or set via: ak config set api-url <url>");
        process.exit(1);
      }

      await startDaemon({
        maxConcurrent: parseInt(opts.maxConcurrent, 10),
        agentCli: opts.agentCli,
        pollInterval: parseInt(opts.pollInterval, 10),
        taskTimeout: parseInt(opts.taskTimeout, 10),
      });
    });
}
