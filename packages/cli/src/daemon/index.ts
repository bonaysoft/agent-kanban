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
import { migrateLegacySessions } from "../session/store.js";
import { getVersion } from "../version.js";
import { auditOrphanedTasks, cleanupLeaderSessions, cleanupStaleSessions } from "./cleanup.js";
import { DaemonLoop } from "./loop.js";
import { PrMonitor } from "./prMonitor.js";
import { RateLimiter } from "./rateLimiter.js";
import { RuntimePool } from "./runtimePool.js";
import { TunnelClient } from "./tunnel.js";
import { UsageCollector } from "./usageCollector.js";

const logger = createLogger("daemon");

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

  const usageCollector = new UsageCollector({ providers: availableProviders });
  usageCollector.start();

  const prMonitor = new PrMonitor(client);

  const { apiUrl, apiKey } = getCredentials();
  const tunnel = new TunnelClient(apiUrl, apiKey);
  try {
    await tunnel.connect();
  } catch (err) {
    logger.warn(`Tunnel connection failed: ${err instanceof Error ? err.message : err}`);
  }

  let loop: DaemonLoop;

  const rateLimiter = new RateLimiter({
    onResumed: (runtime) => loop.resumeRateLimitedSessions(runtime).catch((e) => logger.error(`Resume error: ${(e as Error).message}`)),
  });

  const pool = new RuntimePool(
    client,
    { onSlotFreed: () => loop.onSlotFreed() },
    {
      onRateLimited: (runtime, resetAt) => rateLimiter.pause(runtime, resetAt),
      onRateLimitResumed: (runtime) => rateLimiter.resumeRateLimit(runtime),
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
    const delivered = await pool.sendToSession(sessionId, content);
    if (!delivered) {
      logger.warn(`Human message for session ${sessionId.slice(0, 8)} dropped: no live agent`);
    }
  });

  loop = new DaemonLoop(client, pool, rateLimiter, prMonitor, {
    maxConcurrent: opts.maxConcurrent,
    pollInterval,
  });

  const heartbeatInterval = setInterval(() => {
    (async () => {
      await client.heartbeat(machineId!, {
        version: machineInfo.version,
        runtimes: machineInfo.runtimes,
        usage_info: usageCollector.getSnapshot(),
      });
      await cleanupLeaderSessions(client);
    })().catch((err: any) => logger.warn(`Heartbeat failed: ${err.message}`));
  }, 30000);

  const shutdown = async () => {
    logger.info("Shutting down daemon...");
    loop.stop();
    rateLimiter.stop();
    prMonitor.stop();
    usageCollector.stop();
    clearInterval(heartbeatInterval);
    await pool.killAll();
    tunnel.disconnect();
    await cleanupLeaderSessions(client);
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
  loop.start();
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
