import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { getCredentials, saveCredentials, setCurrent } from "../config.js";
import { DAEMON_STATE_FILE, LOGS_DIR, PID_FILE, SESSION_PIDS_FILE, STATE_DIR } from "../paths.js";
import { getAvailableProviders } from "../providers/registry.js";

const MAX_LOG_ARCHIVES = 5;

interface DaemonState {
  providers: string[];
  maxConcurrent: number;
  pollInterval: number;
  taskTimeout: number;
  apiUrl: string;
  startedAt: string;
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

function readDaemonState(): DaemonState | null {
  try {
    return JSON.parse(readFileSync(DAEMON_STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function formatUptime(startMs: number): string {
  const seconds = Math.floor((Date.now() - startMs) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function countActiveSessions(): number {
  try {
    const data = JSON.parse(readFileSync(SESSION_PIDS_FILE, "utf-8"));
    let alive = 0;
    for (const pid of Object.values(data)) {
      try {
        process.kill(pid as number, 0);
        alive++;
      } catch {
        /* dead */
      }
    }
    return alive;
  } catch {
    return 0;
  }
}

function formatProviders(all: string[]): string {
  if (all.length === 0) return "none";
  return all.join(", ");
}

function maskApiUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

export function registerStartCommand(program: Command) {
  program
    .command("start")
    .description("Start the Machine daemon — auto-claim and execute tasks")
    .option("--api-url <url>", "API server URL")
    .option("--api-key <key>", "Machine API key")
    .option("--max-concurrent <n>", "Max concurrent agents", "3")
    .option("--poll-interval <ms>", "Poll interval in ms", "10000")
    .option("--task-timeout <ms>", "Task timeout in ms (0 to disable)", "7200000")
    .action(async (opts) => {
      // Save or resolve credentials
      if (opts.apiUrl && opts.apiKey) {
        saveCredentials(opts.apiUrl, opts.apiKey);
      } else if (opts.apiUrl) {
        // Switch to existing credentials for this host
        try {
          setCurrent(opts.apiUrl);
        } catch {
          console.error(`No saved credentials for ${opts.apiUrl}. Pass --api-key as well.`);
          process.exit(1);
        }
      }

      let creds: { apiUrl: string; apiKey: string };
      try {
        creds = getCredentials();
      } catch {
        console.error("API URL and key required. Pass --api-url and --api-key.");
        process.exit(1);
      }
      const apiUrl = creds.apiUrl;

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

      // Detect available providers
      const available = getAvailableProviders();

      // Spawn daemon as detached child
      const child = spawn(
        process.execPath,
        [
          process.argv[1],
          "__daemon",
          "--max-concurrent",
          String(opts.maxConcurrent),
          "--poll-interval",
          String(opts.pollInterval),
          "--task-timeout",
          String(opts.taskTimeout),
        ],
        { detached: true, stdio: ["ignore", logFd, logFd] },
      );

      // Write child PID and daemon state
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(PID_FILE, String(child.pid));

      const state: DaemonState = {
        providers: available.map((p) => p.name),
        maxConcurrent: parseInt(String(opts.maxConcurrent), 10),
        pollInterval: parseInt(String(opts.pollInterval), 10),
        taskTimeout: parseInt(String(opts.taskTimeout), 10),
        apiUrl,
        startedAt: new Date().toISOString(),
      };
      writeFileSync(DAEMON_STATE_FILE, JSON.stringify(state, null, 2));

      child.unref();

      const timeoutLabel = state.taskTimeout === 0 ? "none" : `${state.taskTimeout / 1000}s`;
      const providersLabel = formatProviders(state.providers);
      console.log(`● Daemon started (PID ${child.pid})`);
      console.log(`  Providers:   ${providersLabel}`);
      console.log(`  Concurrency: ${state.maxConcurrent}`);
      console.log(`  Poll:        ${state.pollInterval / 1000}s`);
      console.log(`  Timeout:     ${timeoutLabel}`);
      console.log(`  API:         ${maskApiUrl(state.apiUrl)}`);
      console.log(`  Logs:        ak logs -f`);
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
        console.log("○ Daemon is not running");
        return;
      }

      let uptimeStr = "";
      const state = readDaemonState();
      if (state?.startedAt) {
        uptimeStr = formatUptime(new Date(state.startedAt).getTime());
      }

      process.kill(pid, "SIGTERM");

      console.log(`● Daemon stopped (PID ${pid})`);
      if (uptimeStr) console.log(`  Uptime: ${uptimeStr}`);
    });
}

export function registerStatusCommand(program: Command) {
  program
    .command("status")
    .description("Show Machine daemon status")
    .action(() => {
      const pid = readDaemonPid();
      if (!pid) {
        console.log("○ Daemon is not running");
        return;
      }

      const state = readDaemonState();

      let uptimeStr = "";
      if (state?.startedAt) {
        uptimeStr = formatUptime(new Date(state.startedAt).getTime());
      } else {
        try {
          uptimeStr = formatUptime(statSync(PID_FILE).mtimeMs);
        } catch {
          /* skip */
        }
      }

      const sessions = countActiveSessions();

      console.log(`● Daemon running (PID ${pid})`);
      if (uptimeStr) console.log(`  Uptime:      ${uptimeStr}`);
      if (state) {
        const providersLabel = formatProviders(state.providers ?? []);
        console.log(`  Providers:   ${providersLabel}`);
        console.log(`  Concurrency: ${state.maxConcurrent}`);
        console.log(`  API:         ${maskApiUrl(state.apiUrl)}`);
      }
      console.log(`  Sessions:    ${sessions} active`);
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
