import { readFileSync, writeFileSync } from "node:fs";
import { SAVED_SESSIONS_FILE } from "./paths.js";

export type SessionStatus = "active" | "rate_limited" | "in_review";

export interface SavedSession {
  taskId: string;
  sessionId: string;
  cwd: string;
  repoDir: string;
  branchName: string;
  agentId: string;
  privateKeyJwk: JsonWebKey;
  runtime: string;
  model?: string;
  status: SessionStatus;
}

function readAll(): SavedSession[] {
  try {
    return JSON.parse(readFileSync(SAVED_SESSIONS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeAll(sessions: SavedSession[]): void {
  writeFileSync(SAVED_SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

export function loadSessions(status?: SessionStatus): SavedSession[] {
  const all = readAll();
  return status ? all.filter((s) => s.status === status) : all;
}

export function saveSession(session: SavedSession): void {
  const sessions = readAll();
  const idx = sessions.findIndex((s) => s.taskId === session.taskId);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }
  writeAll(sessions);
}

export function updateSessionStatus(taskId: string, status: SessionStatus): void {
  const sessions = readAll();
  const session = sessions.find((s) => s.taskId === taskId);
  if (!session) return;
  session.status = status;
  writeAll(sessions);
}

export function removeSession(taskId: string): void {
  const sessions = readAll();
  const filtered = sessions.filter((s) => s.taskId !== taskId);
  if (filtered.length < sessions.length) writeAll(filtered);
}
