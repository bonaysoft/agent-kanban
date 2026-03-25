import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Command } from "commander";
import { deleteConfigValue, getConfigValue, setConfigValue } from "../config.js";
import { LOGS_DIR, PID_FILE, STATE_DIR } from "../paths.js";
import { getAvailableProviders } from "../providers/registry.js";

const MAX_LOG_ARCHIVES = 5;

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

function rotateLogs(): void {
  mkdirSync(LOGS_DIR, { recursive: true });
  const logFile = join(LOGS_DIR, "daemon.log");
  if (!existsSync(logFile)) return;

  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d+Z$/, "");
  renameSync(logFile, join(LOGS_DIR, `daemon-${timestamp}.log`));

  const archives = readdirSync(LOGS_DIR)
    .filter((f) => f.startsWith("daemon-") && f.endsWith(".log"))
    .sort();

  while (archives.length > MAX_LOG_ARCHIVES) {
    unlinkSync(join(LOGS_DIR, archives.shift()!));
  }
}

function readDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
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
        }
        setConfigValue("api-key", opts.apiKey);
      }

      if (!getConfigValue("api-url") || !getConfigValue("api-key")) {
        console.error("API URL and key required. Pass --api-url and --api-key, or set via: ak config set api-url <url>");
        process.exit(1);
      }

      // Resolve default provider
      let defaultProvider = opts.provider;
      if (!defaultProvider && opts.agentCli) {
        console.warn("Warning: --agent-cli is deprecated, use --provider instead");
        defaultProvider = opts.agentCli;
      }

      if (!defaultProvider) {
        const available = getAvailableProviders();
        if (available.length === 0) {
          console.error("No agent providers found. Install claude, codex, or gemini CLI.");
          process.exit(1);
        }
        defaultProvider = available[0].name;
      }

      // Check if already running
      const existingPid = readDaemonPid();
      if (existingPid) {
        console.error(`Daemon already running (PID ${existingPid}). Stop it first or remove ${PID_FILE}`);
        process.exit(1);
      }
      if (existsSync(PID_FILE)) unlinkSync(PID_FILE);

      // Rotate logs
      rotateLogs();

      // Open daemon.log for child stdout/stderr
      const logFile = join(LOGS_DIR, "daemon.log");
      const logFd = openSync(logFile, "a");

      // Spawn daemon as detached child
      const child = spawn(
        process.execPath,
        [
          process.argv[1],
          "__daemon",
          "--max-concurrent",
          String(opts.maxConcurrent),
          "--default-provider",
          defaultProvider,
          "--poll-interval",
          String(opts.pollInterval),
          "--task-timeout",
          String(opts.taskTimeout),
        ],
        { detached: true, stdio: ["ignore", logFd, logFd] },
      );

      // Write child PID and detach
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(PID_FILE, String(child.pid));
      child.unref();

      console.log(`Daemon started (PID ${child.pid})`);
      process.exit(0);
    });
}

export function registerStopCommand(program: Command) {
  program
    .command("stop")
    .description("Stop the Machine daemon")
    .action(() => {
      const pid = readDaemonPid();
      if (!pid) {
        console.log("Daemon is not running");
        return;
      }
      process.kill(pid, "SIGTERM");
      console.log(`Daemon stopped (PID ${pid})`);
    });
}

export function registerStatusCommand(program: Command) {
  program
    .command("status")
    .description("Show Machine daemon status")
    .action(() => {
      const pid = readDaemonPid();
      if (!pid) {
        console.log("Daemon is not running");
        return;
      }

      let uptime = "";
      try {
        const stat = statSync(PID_FILE);
        const seconds = Math.floor((Date.now() - stat.mtimeMs) / 1000);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const parts: string[] = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        parts.push(`${secs}s`);
        uptime = ` — uptime ${parts.join(" ")}`;
      } catch {
        // PID file stat unavailable, skip uptime
      }

      console.log(`Daemon is running (PID ${pid})${uptime}`);
    });
}

export function registerLogsCommand(program: Command) {
  program
    .command("logs")
    .description("Show Machine daemon logs")
    .option("--lines <n>", "Number of lines to show", "50")
    .option("--no-follow", "Print and exit without streaming")
    .action((opts) => {
      const logFile = join(LOGS_DIR, "daemon.log");
      if (!existsSync(logFile)) {
        console.log("No daemon logs found");
        return;
      }

      const args = opts.follow ? ["-n", String(opts.lines), "-f", logFile] : ["-n", String(opts.lines), logFile];

      const tail = spawn("tail", args, { stdio: "inherit" });
      tail.on("exit", (code) => process.exit(code ?? 0));
    });
}
