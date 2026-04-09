import { collectUsage as collectLeaderUsage } from "../agent/usage.js";
import type { MachineClient } from "../client/index.js";
import { createLogger } from "../logger.js";
import { isPidAlive, listSessions, removeSession } from "../session/store.js";

const logger = createLogger("daemon");

export async function cleanupLeaderSessions(client: MachineClient): Promise<void> {
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
        if (local) {
          logger.info(`Closing stale session ${session.id.slice(0, 8)} for agent ${agent.id.slice(0, 8)}`);
          removeSession(local.sessionId);
        }
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
