import type { Command } from "commander";
import { startDaemon } from "../daemon.js";

export function registerStartCommand(program: Command) {
  program
    .command("start")
    .description("Start the Machine daemon — auto-claim and execute tasks")
    .option("--max-concurrent <n>", "Max concurrent agents", "3")
    .option("--agent-cli <cmd>", "Agent CLI command to spawn", "claude")
    .option("--poll-interval <ms>", "Poll interval in ms", "10000")
    .action(async (opts) => {
      await startDaemon({
        maxConcurrent: parseInt(opts.maxConcurrent, 10),
        agentCli: opts.agentCli,
        pollInterval: parseInt(opts.pollInterval, 10),
      });
    });
}
