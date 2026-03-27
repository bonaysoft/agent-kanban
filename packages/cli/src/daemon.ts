import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { arch, hostname, platform, release } from "node:os";
import { join } from "node:path";
import { MachineClient } from "./client.js";
import { generateDeviceId } from "./device.js";
import { createLogger } from "./logger.js";
import { PID_FILE, STATE_DIR } from "./paths.js";
import { PrMonitor } from "./prMonitor.js";
import { ProcessManager } from "./processManager.js";
import { getAvailableProviders } from "./providers/registry.js";
import type { AgentProvider, UsageInfo } from "./providers/types.js";
import { Scheduler } from "./scheduler.js";
import { cleanupStale, clearAll as clearSessionPids, removePid, savePid } from "./sessionPids.js";
import { TaskRunner } from "./taskRunner.js";

const logger = createLogger("daemon");

async function collectUsage(providers: AgentProvider[]): Promise<UsageInfo | null> {
  const results = await Promise.allSettled(providers.filter((p) => p.getUsage).map((p) => p.getUsage!()));
  const windows = results
    .filter((r): r is PromiseFulfilledResult<UsageInfo | null> => r.status === "fulfilled" && r.value !== null)
    .flatMap((r) => r.value!.windows);
  if (windows.length === 0) return null;
  return { windows, updated_at: new Date().toISOString() };
}

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

  // Register machine (upsert by device_id on server)
  const machineInfo = getMachineInfo();
  const deviceId = generateDeviceId();
  const machine = await client.registerMachine({ ...machineInfo, device_id: deviceId });
  const machineId = machine.id;
  logger.info(`Machine ready: ${machineId} (device: ${deviceId})`);

  await client.heartbeat(machineId, { version: machineInfo.version, runtimes: machineInfo.runtimes });
  await cleanupStale(client, machineId);
  logger.info(`Machine online: ${machineInfo.name} (${machineInfo.os}, runtimes: ${machineInfo.runtimes.join(", ") || "none"})`);

  const MIN_POLL_INTERVAL = 5000;
  const pollInterval = Math.max(opts.pollInterval || 10000, MIN_POLL_INTERVAL);
  const availableProviders = getAvailableProviders();

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
      const usageInfo = await collectUsage(availableProviders);
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
