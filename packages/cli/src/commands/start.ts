import { createInterface } from "node:readline";
import type { Command } from "commander";
import { deleteConfigValue, getConfigValue, setConfigValue } from "../config.js";
import { startDaemon } from "../daemon.js";
import { clearLinks } from "../links.js";
import { getAvailableProviders, getProvider } from "../providers/registry.js";
import type { AgentProvider } from "../providers/types.js";

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
    .option("--provider <name>", "Agent provider to use (auto-detect if omitted)")
    .option("--agent-cli <cmd>", "(deprecated) Use --provider instead")
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
            console.log("Aborted.");
            process.exit(0);
          }
          deleteConfigValue("machine-id");
          clearLinks();
        }
        setConfigValue("api-key", opts.apiKey);
      }

      if (!getConfigValue("api-url") || !getConfigValue("api-key")) {
        console.error("API URL and key required. Pass --api-url and --api-key, or set via: ak config set api-url <url>");
        process.exit(1);
      }

      // Resolve provider: --provider flag > --agent-cli (deprecated) > auto-detect
      let providerName = opts.provider;
      if (!providerName && opts.agentCli) {
        console.warn("Warning: --agent-cli is deprecated, use --provider instead");
        providerName = opts.agentCli;
      }

      let provider: AgentProvider;
      if (providerName) {
        provider = getProvider(providerName);
      } else {
        const available = getAvailableProviders();
        if (available.length === 0) {
          console.error("No agent providers found. Install claude, codex, or gemini CLI.");
          process.exit(1);
        }
        provider = available[0];
      }

      await startDaemon({
        maxConcurrent: parseInt(opts.maxConcurrent, 10),
        provider,
        pollInterval: parseInt(opts.pollInterval, 10),
        taskTimeout: parseInt(opts.taskTimeout, 10),
      });
    });
}
