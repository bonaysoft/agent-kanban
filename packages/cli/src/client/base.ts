import type { UsageInfo } from "../types.js";
import { getVersion } from "../version.js";

export class ApiError extends Error {
  public code: string;

  constructor(
    public status: number,
    message: string,
    code = `HTTP_${status}`,
  ) {
    super(message);
    this.code = code;
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
          "X-CLI-Version": getVersion(),
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
      throw new ApiError(res.status, msg, (data as any).error?.code);
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
    name?: string;
    username: string;
    bio?: string;
    soul?: string;
    role?: string;
    kind?: "worker" | "leader";
    handoff_to?: string[];
    runtime: import("@agent-kanban/shared").AgentRuntime;
    model?: string;
    skills?: string[];
  }) {
    return this.request("POST", "/api/agents", input);
  }

  // Boards
  createBoard(input: { name: string; type: import("@agent-kanban/shared").BoardType; description?: string }) {
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
