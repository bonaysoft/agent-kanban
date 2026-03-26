import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { arch, hostname, platform, release } from "node:os";
import { join } from "node:path";
import { MachineClient } from "./client.js";
import { getConfigValue, setConfigValue } from "./config.js";
import { createLogger } from "./logger.js";
import { PID_FILE, STATE_DIR } from "./paths.js";
import { PrMonitor } from "./prMonitor.js";
import { ProcessManager } from "./processManager.js";
import { getAvailableProviders, getProvider } from "./providers/registry.js";
import { Scheduler } from "./scheduler.js";
import { cleanupStale, clearAll as clearSessionPids, removePid, savePid } from "./sessionPids.js";
import { TaskRunner } from "./taskRunner.js";

const logger = createLogger("daemon");

export interface DaemonOptions {
  maxConcurrent: number;
  pollInterval?: number;
  taskTimeout?: number;
}

export async function startDaemon(opts: DaemonOptions): Promise<void> {
  // Safety net — log but don't crash on stray rejections
  process.on("unhandledRejection", (err: any) => {
    logger.error(`Unhandled rejection: ${err?.message ?? err}`);
  });

  mkdirSync(STATE_DIR, { recursive: true });

  // Preflight: gh must be installed and authenticated
  try {
    execSync("gh auth status", { stdio: "pipe" });
  } catch {
    removePidFile();
    logger.fatal("`gh` is not installed or not authenticated. Run `gh auth login` first.");
    process.exit(1);
  }

  const client = new MachineClient();

  // Register machine
  const machineInfo = getMachineInfo();
  let machineId = getConfigValue("machine-id");
  if (!machineId) {
    const machine = await client.registerMachine(machineInfo);
    machineId = machine.id;
    setConfigValue("machine-id", machineId);
    logger.info(`Machine registered: ${machineId}`);
  }

  await client.heartbeat(machineId, { version: machineInfo.version, runtimes: machineInfo.runtimes });
  await cleanupStale(client, machineId);
  logger.info(`Machine online: ${machineInfo.name} (${machineInfo.os}, runtimes: ${machineInfo.runtimes.join(", ") || "none"})`);

  const MIN_POLL_INTERVAL = 5000;
  const pollInterval = Math.max(opts.pollInterval || 10000, MIN_POLL_INTERVAL);
  const availableProviders = getAvailableProviders();
  const primaryProvider = availableProviders.length > 0 ? getProvider(availableProviders[0].name) : null;

  // Wire up components
  const prMonitor = new PrMonitor(client);
  let scheduler: Scheduler;

  const pm = new ProcessManager(
    client,
    {
      onSlotFreed: () => scheduler.onSlotFreed(),
      onRateLimited: (runtime, resetAt) => scheduler.pauseForRateLimit(runtime, resetAt),
      onRateLimitCleared: (runtime) => scheduler.clearRateLimit(runtime),
      onProcessStarted: savePid,
      onProcessExited: removePid,
    },
    opts.taskTimeout,
  );

  const runner = new TaskRunner(client, pm);

  scheduler = new Scheduler(client, pm, runner, prMonitor, {
    maxConcurrent: opts.maxConcurrent,
    pollInterval,
  });

  // Heartbeat
  const heartbeatInterval = setInterval(() => {
    (async () => {
      const usageInfo = primaryProvider?.getUsage ? await primaryProvider.getUsage() : null;
      await client.heartbeat(machineId!, { version: machineInfo.version, runtimes: machineInfo.runtimes, usage_info: usageInfo });
    })().catch((err: any) => logger.warn(`Heartbeat failed: ${err.message}`));
  }, 30000);

  // Shutdown
  const shutdown = async () => {
    logger.info("Shutting down daemon...");
    scheduler.stop();
    prMonitor.stop();
    clearInterval(heartbeatInterval);
    await pm.killAll();
    clearSessionPids();
    removePidFile();
    logger.info("Daemon stopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info(`Daemon started (PID ${process.pid}, max_concurrent=${opts.maxConcurrent}, runtimes=${machineInfo.runtimes.join(",") || "none"})`);

  prMonitor.start();
  scheduler.start();
}

function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

function getMachineInfo() {
  const os = `${platform()} ${arch()} ${release()}`;
  const runtimes = getAvailableProviders().map((p) => p.label);
  let version = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf-8"));
    version = pkg.version;
  } catch {
    /* ignore */
  }
  return { name: hostname(), os, version, runtimes };
}
