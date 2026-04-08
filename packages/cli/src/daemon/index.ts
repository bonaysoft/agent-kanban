import { execSync } from "node:child_process";
import { mkdirSync, unlinkSync } from "node:fs";
import { arch, hostname, platform, release } from "node:os";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { MachineClient } from "../client/index.js";
import { getCredentials } from "../config.js";
import { generateDeviceId } from "../device.js";
import { createLogger } from "../logger.js";
import { PID_FILE, STATE_DIR } from "../paths.js";
import { getAvailableProviders } from "../providers/registry.js";
import type { AgentProvider, UsageInfo } from "../providers/types.js";
import { migrateLegacySessions, updateSession } from "../session/store.js";
import { getVersion } from "../version.js";
import { auditOrphanedTasks, cleanupLeaderSessions, cleanupStaleSessions } from "./cleanup.js";
import { PrMonitor } from "./prMonitor.js";
import { ProcessManager } from "./processManager.js";
import { Scheduler } from "./scheduler.js";
import { TaskRunner } from "./taskRunner.js";
import { TunnelClient } from "./tunnel.js";

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
  process.on("unhandledRejection", (err: any) => {
    logger.error(`Unhandled rejection: ${err?.message ?? err}`);
  });

  mkdirSync(STATE_DIR, { recursive: true });

  try {
    execSync("gh auth status", { stdio: "pipe" });
  } catch {
    logger.warn("`gh` is not authenticated — repo-based tasks will be skipped");
  }

  const client = new MachineClient();

  const machineInfo = getMachineInfo();
  const deviceId = generateDeviceId();
  const machine = await client.registerMachine({ ...machineInfo, device_id: deviceId });
  const machineId = machine.id;
  logger.info(`Machine ready: ${machineId} (device: ${deviceId})`);

  await client.heartbeat(machineId, { version: machineInfo.version, runtimes: machineInfo.runtimes });
  migrateLegacySessions();
  await cleanupStaleSessions(client, machineId);
  await auditOrphanedTasks(client, machineId);
  logger.info(`Machine online: ${machineInfo.name} (${machineInfo.os}, runtimes: ${machineInfo.runtimes.join(", ") || "none"})`);

  const MIN_POLL_INTERVAL = 5000;
  const pollInterval = Math.max(opts.pollInterval || 10000, MIN_POLL_INTERVAL);
  const availableProviders = getAvailableProviders();

  // Wire up components
  const prMonitor = new PrMonitor(client);
  let scheduler: Scheduler;

  const { apiUrl, apiKey } = getCredentials();
  const tunnel = new TunnelClient(apiUrl, apiKey);
  try {
    await tunnel.connect();
  } catch (err) {
    logger.warn(`Tunnel connection failed: ${err instanceof Error ? err.message : err}`);
  }

  const pm = new ProcessManager(
    client,
    {
      onSlotFreed: () => scheduler.onSlotFreed(),
      onRateLimited: (runtime, resetAt) => scheduler.pauseForRateLimit(runtime, resetAt),
      onRateLimitResumed: (runtime) => scheduler.resumeRateLimit(runtime),
      onProcessStarted: (sessionId, pid) => updateSession(sessionId, { pid }),
      onProcessExited: () => {},
    },
    opts.taskTimeout,
    tunnel,
  );

  tunnel.onHistoryRequest((sessionId, requestId) => {
    getSessionMessages(sessionId)
      .then((messages) => tunnel.sendHistory(messages, requestId))
      .catch((e) => logger.warn(`History fetch failed for ${sessionId.slice(0, 8)}: ${e instanceof Error ? e.message : e}`));
  });

  tunnel.onHumanMessage(async (sessionId, content) => {
    const delivered = await pm.sendToSession(sessionId, content);
    if (!delivered) {
      const { listSessions } = await import("../session/store.js");
      const session = listSessions({ type: "worker" }).find((s) => s.sessionId === sessionId);
      if (session) {
        logger.info(`Resuming session ${sessionId.slice(0, 8)} for human message`);
        runner.resumeSession(session, content).catch((e) => {
          logger.warn(`Failed to resume session ${sessionId.slice(0, 8)}: ${e instanceof Error ? e.message : e}`);
        });
      }
    }
  });

  const runner = new TaskRunner(client, pm);

  scheduler = new Scheduler(client, pm, runner, prMonitor, {
    maxConcurrent: opts.maxConcurrent,
    pollInterval,
  });

  const heartbeatInterval = setInterval(() => {
    (async () => {
      const usageInfo = await collectUsage(availableProviders);
      await client.heartbeat(machineId!, { version: machineInfo.version, runtimes: machineInfo.runtimes, usage_info: usageInfo });
      await cleanupLeaderSessions(client);
    })().catch((err: any) => logger.warn(`Heartbeat failed: ${err.message}`));
  }, 30000);

  const shutdown = async () => {
    logger.info("Shutting down daemon...");
    scheduler.stop();
    prMonitor.stop();
    clearInterval(heartbeatInterval);
    await pm.killAll();
    tunnel.disconnect();
    await cleanupLeaderSessions(client);
    // DO NOT clearAllSessions() here. Worker sessions in status=in_review
    // represent tasks awaiting a review decision — their session file is the
    // only entry point for reject-resume and must survive daemon restart.
    // Leader sessions and active worker sessions are handled by killAll()
    // and by cleanupStaleSessions() on next startup.
    removePidFile();
    logger.info("Daemon stopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info(
    `Daemon started (PID ${process.pid}, v${machineInfo.version}, max_concurrent=${opts.maxConcurrent}, runtimes=${machineInfo.runtimes.join(",") || "none"})`,
  );

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
  return { name: hostname(), os, version: getVersion(), runtimes };
}
