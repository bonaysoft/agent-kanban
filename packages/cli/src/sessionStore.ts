import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime } from "@agent-kanban/shared";
import { LEGACY_SAVED_SESSIONS_FILE, LEGACY_SESSION_PIDS_FILE, SESSIONS_DIR } from "./paths.js";
import type { WorkspaceInfo } from "./workspace.js";

export type SessionStatus = "active" | "rate_limited" | "in_review";

export interface SessionFile {
  type: "worker" | "leader";
  agentId: string;
  sessionId: string;
  pid: number;
  runtime: AgentRuntime;
  startedAt: number;
  apiUrl: string;
  privateKeyJwk: JsonWebKey;
  // worker fields
  taskId?: string;
  workspace?: WorkspaceInfo;
  status?: SessionStatus;
  model?: string;
  gpgSubkeyId?: string | null;
  agentUsername?: string;
  agentName?: string;
}

interface SessionFilter {
  type?: "worker" | "leader";
  status?: SessionStatus;
}

function sessionPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.json`);
}

function ensureDir(): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function writeSession(session: SessionFile): void {
  ensureDir();
  // Atomic write: tmp file + rename
  const tmp = join(tmpdir(), `ak-session-${randomUUID()}.json`);
  writeFileSync(tmp, JSON.stringify(session, null, 2));
  renameSync(tmp, sessionPath(session.sessionId));
}

export function readSession(sessionId: string): SessionFile | null {
  try {
    return JSON.parse(readFileSync(sessionPath(sessionId), "utf-8"));
  } catch {
    return null;
  }
}

export function findLeaderSession(pid: number): SessionFile | null {
  for (const session of listSessions()) {
    if (session.type === "leader" && session.pid === pid) return session;
  }
  return null;
}

export function removeSession(sessionId: string): void {
  try {
    unlinkSync(sessionPath(sessionId));
  } catch {
    /* already gone */
  }
}

export function listSessions(filter?: SessionFilter): SessionFile[] {
  ensureDir();
  const results: SessionFile[] = [];
  for (const file of readdirSync(SESSIONS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const session: SessionFile = JSON.parse(readFileSync(join(SESSIONS_DIR, file), "utf-8"));
      if (filter?.type && session.type !== filter.type) continue;
      if (filter?.status && session.status !== filter.status) continue;
      results.push(session);
    } catch {
      /* skip corrupt files */
    }
  }
  return results;
}

export function updateSession(sessionId: string, updates: Partial<SessionFile>): boolean {
  const session = readSession(sessionId);
  if (!session) return false;
  writeSession({ ...session, ...updates });
  return true;
}

/**
 * DANGEROUS — wipes the entire sessions directory.
 *
 * Only legitimate caller: test setup/teardown.
 *
 * Do NOT call from daemon shutdown, scheduler cleanup, or any production code
 * path. Worker sessions with `status: "in_review"` are reject-resume entry
 * points and MUST survive every kind of restart. Bulk-wiping them leaves
 * tasks stuck in `in_progress` with no way to resume.
 *
 * The only non-test use is `commands/start.ts` when the `apiUrl` changes, and
 * that site inlines `rmSync(SESSIONS_DIR)` on purpose so it can't accidentally
 * share this helper.
 */
export function clearAllSessions(): void {
  try {
    rmSync(SESSIONS_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Migrate legacy saved-sessions.json + session-pids.json to per-session files. */
export function migrateLegacySessions(): void {
  let legacySessions: any[] = [];
  try {
    legacySessions = JSON.parse(readFileSync(LEGACY_SAVED_SESSIONS_FILE, "utf-8"));
  } catch {
    return; // No legacy file — nothing to migrate
  }

  let legacyPids: Record<string, number> = {};
  try {
    legacyPids = JSON.parse(readFileSync(LEGACY_SESSION_PIDS_FILE, "utf-8"));
  } catch {
    /* no PID file — fine */
  }

  for (const s of legacySessions) {
    writeSession({
      type: "worker",
      agentId: s.agentId,
      sessionId: s.sessionId,
      pid: legacyPids[s.sessionId] ?? 0,
      runtime: s.runtime,
      startedAt: 0,
      apiUrl: "",
      privateKeyJwk: s.privateKeyJwk,
      taskId: s.taskId,
      workspace: s.workspace,
      status: s.status ?? "active",
      model: s.model,
      gpgSubkeyId: s.gpgSubkeyId,
      agentUsername: s.agentUsername,
      agentName: s.agentName,
    });
  }

  // Remove legacy files
  try {
    unlinkSync(LEGACY_SAVED_SESSIONS_FILE);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(LEGACY_SESSION_PIDS_FILE);
  } catch {
    /* ignore */
  }
}
