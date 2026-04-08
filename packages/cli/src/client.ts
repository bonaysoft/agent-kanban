import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Agent, AgentRuntime, BoardType } from "@agent-kanban/shared";
import { SignJWT } from "jose";
import { getCredentials } from "./config.js";
import { loadIdentity, type StoredIdentity, saveIdentity } from "./identity.js";
import { PID_FILE } from "./paths.js";
import { detectRuntime, findRuntimeAncestorPid } from "./runtime.js";
import { findLeaderSession, isPidAlive, writeSession } from "./sessionStore.js";
import type { UsageInfo } from "./types.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export abstract class ApiClient {
  protected baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  protected abstract authorize(): Promise<string>;

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const authorization = await this.authorize();
    const doFetch = () =>
      fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });

    let res: Response;
    try {
      res = await doFetch();
    } catch (err: any) {
      if (err?.cause?.code === "ECONNRESET") {
        res = await doFetch();
      } else {
        throw err;
      }
    }

    const data = (await res.json()) as T & { error?: { code: string; message: string } };

    if (!res.ok) {
      let msg = (data as any).error?.message || `HTTP ${res.status}`;
      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        if (retryAfter) msg += ` (retry after ${retryAfter}s)`;
      }
      throw new ApiError(res.status, msg);
    }

    return data;
  }

  // Tasks
  createTask(input: Record<string, unknown>) {
    return this.request("POST", "/api/tasks", input);
  }
  listTasks(params?: Record<string, string>) {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request("GET", `/api/tasks${qs}`);
  }
  getTask(id: string) {
    return this.request("GET", `/api/tasks/${id}`);
  }
  claimTask(id: string) {
    return this.request("POST", `/api/tasks/${id}/claim`);
  }
  completeTask(id: string, body: Record<string, unknown>) {
    return this.request("POST", `/api/tasks/${id}/complete`, body);
  }
  updateTask(id: string, body: Record<string, unknown>) {
    return this.request("PATCH", `/api/tasks/${id}`, body);
  }
  releaseTask(id: string) {
    return this.request("POST", `/api/tasks/${id}/release`);
  }
  cancelTask(id: string, body: Record<string, unknown> = {}) {
    return this.request("POST", `/api/tasks/${id}/cancel`, body);
  }
  reviewTask(id: string, body: Record<string, unknown> = {}) {
    return this.request("POST", `/api/tasks/${id}/review`, body);
  }
  assignTask(id: string, agentId: string) {
    return this.request("POST", `/api/tasks/${id}/assign`, { agent_id: agentId });
  }
  addNote(taskId: string, detail: string) {
    return this.request("POST", `/api/tasks/${taskId}/notes`, { detail });
  }
  deleteTask(id: string) {
    return this.request("DELETE", `/api/tasks/${id}`);
  }
  rejectTask(id: string, body: Record<string, unknown> = {}) {
    return this.request("POST", `/api/tasks/${id}/reject`, body);
  }
  getTaskNotes(taskId: string, since?: string) {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.request("GET", `/api/tasks/${taskId}/notes${qs}`);
  }
  getAgent(agentId: string) {
    return this.request("GET", `/api/agents/${agentId}`);
  }
  getAgentGpgKey(agentId: string) {
    return this.request<{ armored_private_key: string; gpg_subkey_id: string | null }>("GET", `/api/agents/${agentId}/gpg-key`);
  }
  updateAgent(agentId: string, body: Record<string, unknown>) {
    return this.request("PATCH", `/api/agents/${agentId}`, body);
  }
  deleteAgent(agentId: string) {
    return this.request("DELETE", `/api/agents/${agentId}`);
  }

  // Machines
  registerMachine(info: { name: string; os: string; version: string; runtimes: string[]; device_id: string }) {
    return this.request<{ id: string; name: string }>("POST", "/api/machines", info);
  }
  heartbeat(machineId: string, info: { version?: string; runtimes?: string[]; usage_info?: UsageInfo | null }) {
    return this.request("POST", `/api/machines/${machineId}/heartbeat`, info);
  }

  // Agent Sessions
  createSession(agentId: string, sessionId: string, sessionPublicKey: string) {
    return this.request<{ delegation_proof: string }>("POST", `/api/agents/${agentId}/sessions`, {
      session_id: sessionId,
      session_public_key: sessionPublicKey,
    });
  }
  closeSession(agentId: string, sessionId: string) {
    return this.request("DELETE", `/api/agents/${agentId}/sessions/${sessionId}`);
  }
  reopenSession(agentId: string, sessionId: string) {
    return this.request("POST", `/api/agents/${agentId}/sessions/${sessionId}/reopen`);
  }
  listAgents() {
    return this.request("GET", "/api/agents");
  }
  listSessions(agentId: string) {
    return this.request<any[]>("GET", `/api/agents/${agentId}/sessions`);
  }
  createAgent(input: {
    name: string;
    username?: string;
    bio?: string;
    soul?: string;
    role?: string;
    kind?: "worker" | "leader";
    handoff_to?: string[];
    runtime: AgentRuntime;
    model?: string;
    skills?: string[];
  }) {
    return this.request("POST", "/api/agents", input);
  }

  // Boards
  createBoard(input: { name: string; type: BoardType; description?: string }) {
    return this.request("POST", "/api/boards", input);
  }
  listBoards() {
    return this.request<any[]>("GET", "/api/boards");
  }
  getBoardByName(name: string) {
    return this.request("GET", `/api/boards?name=${encodeURIComponent(name)}`);
  }
  getBoard(boardId: string) {
    return this.request("GET", `/api/boards/${boardId}`);
  }
  updateBoard(boardId: string, body: Record<string, unknown>) {
    return this.request("PATCH", `/api/boards/${boardId}`, body);
  }
  deleteBoard(boardId: string) {
    return this.request("DELETE", `/api/boards/${boardId}`);
  }

  // Repositories
  createRepository(input: { name: string; url: string }) {
    return this.request("POST", "/api/repositories", input);
  }
  listRepositories(filters?: { url?: string }) {
    const params = new URLSearchParams();
    if (filters?.url) params.set("url", filters.url);
    const qs = params.toString();
    return this.request<any[]>("GET", `/api/repositories${qs ? `?${qs}` : ""}`);
  }
  getRepository(repoId: string) {
    return this.request("GET", `/api/repositories/${repoId}`);
  }
  deleteRepository(repoId: string) {
    return this.request("DELETE", `/api/repositories/${repoId}`);
  }

  // Session usage
  updateSessionUsage(
    agentId: string,
    sessionId: string,
    usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; cost_micro_usd: number },
  ) {
    return this.request("PATCH", `/api/agents/${agentId}/sessions/${sessionId}/usage`, usage);
  }

  // Messages
  sendMessage(taskId: string, body: { sender_type: string; sender_id: string; content: string }) {
    return this.request("POST", `/api/tasks/${taskId}/messages`, body);
  }
  getMessages(taskId: string, since?: string) {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.request<any[]>("GET", `/api/tasks/${taskId}/messages${qs}`);
  }
}

export class MachineClient extends ApiClient {
  private apiKey: string;

  constructor() {
    const { apiUrl, apiKey } = getCredentials();
    super(apiUrl);
    this.apiKey = apiKey;
  }

  protected async authorize(): Promise<string> {
    return `Bearer ${this.apiKey}`;
  }
}

export class AgentClient extends ApiClient {
  private agentId: string;
  private sessionId: string;
  private privateKey: CryptoKey;

  constructor(baseUrl: string, agentId: string, sessionId: string, privateKey: CryptoKey) {
    super(baseUrl);
    this.agentId = agentId;
    this.sessionId = sessionId;
    this.privateKey = privateKey;
  }

  static async fromEnv(): Promise<AgentClient | null> {
    const agentId = process.env.AK_AGENT_ID;
    const sessionId = process.env.AK_SESSION_ID;
    const keyJson = process.env.AK_AGENT_KEY;
    const apiUrl = process.env.AK_API_URL;
    if (!agentId || !sessionId || !keyJson || !apiUrl) return null;

    const privateKey = await crypto.subtle.importKey("jwk", JSON.parse(keyJson), { name: "Ed25519" } as any, false, ["sign"]);
    return new AgentClient(apiUrl, agentId, sessionId, privateKey);
  }

  protected async authorize(): Promise<string> {
    const jwt = await new SignJWT({ sub: this.sessionId, aid: this.agentId, jti: randomUUID(), aud: this.baseUrl })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(this.privateKey);
    return `Bearer ${jwt}`;
  }

  getAgentId(): string {
    return this.agentId;
  }
  getSessionId(): string {
    return this.sessionId;
  }
}

// ─── Leader auto-init ───

function isDaemonAlive(): boolean {
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureIdentity(runtime: AgentRuntime, client: MachineClient): Promise<StoredIdentity> {
  const existing = loadIdentity(runtime);
  if (existing) return existing;

  const agents = (await client.listAgents()) as Agent[];
  const match = agents.find((a) => a.runtime === runtime && a.kind === "leader");
  if (match) {
    const identity: StoredIdentity = { agent_id: match.id, name: match.name, fingerprint: match.fingerprint };
    saveIdentity(runtime, identity);
    return identity;
  }

  const agent = (await client.createAgent({ name: runtime, runtime, kind: "leader" })) as Agent;
  const identity: StoredIdentity = { agent_id: agent.id, name: agent.name, fingerprint: agent.fingerprint };
  saveIdentity(runtime, identity);
  return identity;
}

let cachedLeaderClient: AgentClient | null = null;

/**
 * Returns AgentClient for the current identity.
 * - Daemon-spawned workers: reads AK_AGENT_* env vars
 * - Leader agents: auto-initializes from runtime detection + session file
 * - No runtime: throws (human in terminal)
 */
export async function createClient(): Promise<ApiClient> {
  const fromEnv = await AgentClient.fromEnv();
  if (fromEnv) return fromEnv;

  if (cachedLeaderClient) return cachedLeaderClient;

  const runtime = detectRuntime() as AgentRuntime | null;
  if (!runtime) {
    throw new Error("This command requires agent identity. Run inside an agent runtime.");
  }

  // Anchor the leader session to the long-lived runtime process PID so it outlives
  // the ephemeral shell that spawns `ak`. Without this, every ak invocation would
  // create a fresh session that the daemon's heartbeat immediately reaps.
  const leaderPid = findRuntimeAncestorPid(runtime);
  if (leaderPid === null) {
    throw new Error(`Could not locate ${runtime} process in ancestry. ak must be invoked from inside a ${runtime} session.`);
  }

  const existing = findLeaderSession(leaderPid);
  if (existing && existing.runtime === runtime && isPidAlive(leaderPid)) {
    const key = await crypto.subtle.importKey("jwk", existing.privateKeyJwk, { name: "Ed25519" } as any, false, ["sign"]);
    cachedLeaderClient = new AgentClient(existing.apiUrl, existing.agentId, existing.sessionId, key);
    return cachedLeaderClient;
  }

  if (!isDaemonAlive()) {
    throw new Error("Daemon is not running. Start it with: ak start");
  }

  // First call — auto-init leader session
  const machineClient = new MachineClient();
  const identity = await ensureIdentity(runtime, machineClient);
  const { publicKey, privateKey } = (await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"])) as CryptoKeyPair;
  const pubJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", privateKey);
  if (!pubJwk.x) throw new Error("Ed25519 key export missing x component");
  const sessionId = randomUUID();
  const apiUrl = getCredentials().apiUrl;
  await machineClient.createSession(identity.agent_id, sessionId, pubJwk.x);

  writeSession({
    type: "leader",
    agentId: identity.agent_id,
    sessionId,
    pid: leaderPid,
    runtime,
    startedAt: Date.now(),
    apiUrl,
    privateKeyJwk: privJwk,
  });

  cachedLeaderClient = new AgentClient(apiUrl, identity.agent_id, sessionId, privateKey);
  return cachedLeaderClient;
}
