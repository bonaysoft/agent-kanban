import { createInterface } from "node:readline";
import type { Command } from "commander";
import { deleteConfigValue, getConfigValue, setConfigValue } from "../config.js";
import { startDaemon } from "../daemon.js";
import { clearLinks } from "../links.js";
import { createLogger } from "../logger.js";

const logger = createLogger("start");

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
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
    .option("--task-timeout <ms>", "Task timeout in ms (0 to disable)", "7200000")
    .action(async (opts) => {
      if (opts.apiUrl) setConfigValue("api-url", opts.apiUrl);
      if (opts.apiKey) {
        const oldKey = getConfigValue("api-key");
        if (oldKey && oldKey !== opts.apiKey && getConfigValue("machine-id")) {
          const machineId = getConfigValue("machine-id");
          const yes = await confirm(
            `This machine is already registered (${machineId}) with a different API key.\nSwitch to the new key and re-register? [y/N] `,
          );
          if (!yes) {
            logger.info("Aborted.");
            process.exit(0);
          }
          deleteConfigValue("machine-id");
          clearLinks();
        }
        setConfigValue("api-key", opts.apiKey);
      }

      if (!getConfigValue("api-url") || !getConfigValue("api-key")) {
        logger.error("API URL and key required. Pass --api-url and --api-key, or set via: ak config set api-url <url>");
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
