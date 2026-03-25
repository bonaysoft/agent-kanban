import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { MachineClient } from "./client.js";
import { createLogger } from "./logger.js";
import { SESSION_PIDS_FILE } from "./paths.js";

const logger = createLogger("session-pids");

function load(): Map<string, number> {
  try {
    const data = JSON.parse(readFileSync(SESSION_PIDS_FILE, "utf-8"));
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

function write(pids: Map<string, number>): void {
  writeFileSync(SESSION_PIDS_FILE, JSON.stringify(Object.fromEntries(pids)));
}

export function savePid(sessionId: string, pid: number): void {
  const pids = load();
  pids.set(sessionId, pid);
  write(pids);
}

export function removePid(sessionId: string): void {
  const pids = load();
  if (pids.delete(sessionId)) write(pids);
}

export function clearAll(): void {
  try {
    unlinkSync(SESSION_PIDS_FILE);
  } catch {
    /* ignore */
  }
}

export function isProcessAlive(sessionId: string): boolean {
  const pid = load().get(sessionId);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function cleanupStale(client: MachineClient, machineId: string): Promise<void> {
  try {
    const agents = (await client.listAgents()) as any[];
    const closedIds: string[] = [];
    for (const agent of agents) {
      const sessions = (await client.listSessions(agent.id)) as any[];
      for (const session of sessions) {
        if (session.status !== "active" || session.machine_id !== machineId) continue;
        if (!isProcessAlive(session.id)) {
          await client.closeSession(agent.id, session.id).catch(() => {});
          closedIds.push(session.id);
        }
      }
    }
    if (closedIds.length > 0) {
      const pids = load();
      for (const id of closedIds) pids.delete(id);
      write(pids);
      logger.info(`Cleaned up ${closedIds.length} stale session(s) from previous run`);
    }
  } catch (err: any) {
    logger.warn(`Session cleanup failed: ${err.message}`);
  }
}
