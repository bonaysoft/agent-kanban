import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { REVIEW_SESSIONS_FILE } from "./paths.js";

export interface PersistedReviewSession {
  taskId: string;
  sessionId: string;
  cwd: string;
  repoDir: string;
  branchName: string;
  agentId: string;
  privateKeyJwk: JsonWebKey;
}

export function loadReviewSessions(): PersistedReviewSession[] {
  try {
    return JSON.parse(readFileSync(REVIEW_SESSIONS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function saveReviewSession(session: PersistedReviewSession): void {
  const sessions = loadReviewSessions();
  sessions.push(session);
  writeFileSync(REVIEW_SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

export function removeReviewSession(taskId: string): void {
  const sessions = loadReviewSessions();
  const filtered = sessions.filter((s) => s.taskId !== taskId);
  if (filtered.length === sessions.length) return;
  writeFileSync(REVIEW_SESSIONS_FILE, JSON.stringify(filtered, null, 2));
}

export function clearReviewSessions(): void {
  try {
    unlinkSync(REVIEW_SESSIONS_FILE);
  } catch {
    /* ignore */
  }
}
