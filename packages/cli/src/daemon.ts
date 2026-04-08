import { execSync } from "node:child_process";
import { mkdirSync, unlinkSync } from "node:fs";
import { arch, hostname, platform, release } from "node:os";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { MachineClient } from "./client.js";
import { getCredentials } from "./config.js";
import { generateDeviceId } from "./device.js";
import { createLogger } from "./logger.js";
import { PID_FILE, STATE_DIR } from "./paths.js";
import { PrMonitor } from "./prMonitor.js";
import { ProcessManager } from "./processManager.js";
import { getAvailableProviders } from "./providers/registry.js";
import type { AgentProvider, UsageInfo } from "./providers/types.js";
import { Scheduler } from "./scheduler.js";
import { isPidAlive, listSessions, migrateLegacySessions, removeSession, updateSession } from "./sessionStore.js";
import { TaskRunner } from "./taskRunner.js";
import { TunnelClient } from "./tunnelClient.js";
import { collectUsage as collectLeaderUsage } from "./usageCollector.js";
import { getVersion } from "./version.js";

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

async function cleanupLeaderSessions(client: MachineClient): Promise<void> {
  for (const session of listSessions({ type: "leader" })) {
    if (isPidAlive(session.pid)) continue;
    const usage = await collectLeaderUsage(session.runtime, session.startedAt);
    if (usage) {
      await client.updateSessionUsage(session.agentId, session.sessionId, usage).catch((err: any) => {
        logger.warn(`Leader usage report failed for ${session.sessionId.slice(0, 8)}: ${err.message}`);
      });
    }
    await client.closeSession(session.agentId, session.sessionId).catch((err: any) => {
      logger.warn(`Leader session close failed for ${session.sessionId.slice(0, 8)}: ${err.message}`);
    });
    removeSession(session.sessionId);
    logger.info(`Cleaned up leader session ${session.sessionId.slice(0, 8)} (${session.runtime}, PID ${session.pid})`);
  }
}

export async function cleanupStaleSessions(client: MachineClient, machineId: string): Promise<void> {
  try {
    const agents = (await client.listAgents()) as any[];
    let closedCount = 0;
    for (const agent of agents) {
      const sessions = (await client.listSessions(agent.id)) as any[];
      for (const session of sessions) {
        if (session.status !== "active" || session.machine_id !== machineId) continue;
        const local = listSessions().find((s) => s.sessionId === session.id);
        // NEVER wipe a session that's waiting on a review decision — its file
        // is the only entry point for the reject-resume path.
        if (local?.status === "in_review") continue;
        if (local && isPidAlive(local.pid)) continue;
        await client.closeSession(agent.id, session.id).catch(() => {});
        if (local) removeSession(local.sessionId);
        closedCount++;
      }
    }
    if (closedCount > 0) logger.info(`Cleaned up ${closedCount} stale session(s) from previous run`);
  } catch (err: any) {
    logger.warn(`Session cleanup failed: ${err.message}`);
  }
}

// Startup health check — cross-reference local worker sessions against server
// task state and log any divergence loudly. Catches the "silent orphan" class
// of bugs where a reject-resume entry point (in_review session file) was lost
// for any reason: previous daemon crash, manual cleanup, bugs in shutdown/
// cleanup code paths, disk corruption, etc.
//
// Non-destructive by design: only logs. Recovery is left to the operator because
// the right action depends on context (release vs cancel vs manual merge).
export async function auditOrphanedTasks(client: MachineClient, _machineId: string): Promise<void> {
  try {
    const workers = listSessions({ type: "worker" });
    let resumeQueued = 0;
    let diverged = 0;

    for (const s of workers) {
      if (!s.taskId) continue;
      let task: any;
      try {
        task = await client.getTask(s.taskId);
      } catch (err: any) {
        logger.warn(`Startup audit: failed to fetch task ${s.taskId}: ${err.message}`);
        continue;
      }
      if (!task) {
        logger.warn(`Startup audit: local session ${s.sessionId.slice(0, 8)} references missing task ${s.taskId}`);
        continue;
      }

      if (s.status === "in_review" && task.status === "in_progress") {
        logger.info(`Startup audit: task ${s.taskId} was rejected while daemon was down — will resume on next tick`);
        resumeQueued++;
      } else if (s.status === "in_review" && task.status !== "in_review") {
        logger.warn(
          `Startup audit: local session ${s.sessionId.slice(0, 8)} is in_review but server task ${s.taskId} is ${task.status} — session is stale`,
        );
        diverged++;
      }
    }

    if (resumeQueued > 0 || diverged > 0) {
      logger.info(`Startup audit: ${resumeQueued} task(s) queued for resume, ${diverged} session(s) diverged`);
    }
  } catch (err: any) {
    logger.warn(`Startup audit failed: ${err.message}`);
  }
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
