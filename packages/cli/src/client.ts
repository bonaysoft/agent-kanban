import { getConfigValue } from "./config.js";

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    const url = getConfigValue("api-url");
    const key = getConfigValue("api-key");
    if (!url) throw new Error("API URL not configured. Run: agent-kanban config set api-url <url>");
    if (!key) throw new Error("API key not configured. Run: agent-kanban config set api-key <key>");
    this.baseUrl = url.replace(/\/$/, "");
    this.apiKey = key;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json() as T & { error?: { code: string; message: string } };

    if (!res.ok) {
      const msg = (data as any).error?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  }

  // Tasks
  createTask(input: Record<string, unknown>) { return this.request("POST", "/api/tasks", input); }
  listTasks(params?: Record<string, string>) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return this.request("GET", `/api/tasks${qs}`);
  }
  getTask(id: string) { return this.request("GET", `/api/tasks/${id}`); }
  claimTask(id: string, agentName?: string) {
    return this.request("POST", `/api/tasks/${id}/claim`, agentName ? { agent_id: agentName } : {});
  }
  completeTask(id: string, body: Record<string, unknown>) {
    return this.request("POST", `/api/tasks/${id}/complete`, body);
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
  addLog(taskId: string, detail: string, agentName?: string) {
    return this.request("POST", `/api/tasks/${taskId}/logs`, { detail, agent_id: agentName });
  }

  // Machines
  heartbeat(name: string) {
    return this.request("POST", "/api/machines/heartbeat", { name });
  }

  // Agents
  listAgents() { return this.request("GET", "/api/agents"); }

  // Projects
  createProject(input: { name: string; description?: string }) {
    return this.request("POST", "/api/projects", input);
  }
  listProjects() { return this.request<any[]>("GET", "/api/projects"); }
  getProjectByName(name: string) { return this.request("GET", `/api/projects?name=${encodeURIComponent(name)}`); }
  getProjectBoard(projectId: string) { return this.request("GET", `/api/projects/${projectId}/board`); }

  // Repositories
  addRepository(projectId: string, input: { name: string; url: string }) {
    return this.request("POST", `/api/projects/${projectId}/repositories`, input);
  }
  listRepositories(projectId: string) { return this.request("GET", `/api/projects/${projectId}/repositories`); }

  // Agent usage
  updateAgentUsage(agentId: string, usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; cost_micro_usd: number }) {
    return this.request("PATCH", `/api/agents/${agentId}/usage`, usage);
  }

  // Messages
  sendMessage(taskId: string, body: { agent_id: string; role: string; content: string }) {
    return this.request("POST", `/api/tasks/${taskId}/messages`, body);
  }
  getMessages(taskId: string, since?: string) {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.request<any[]>("GET", `/api/tasks/${taskId}/messages${qs}`);
  }
}
