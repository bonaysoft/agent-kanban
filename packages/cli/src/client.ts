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

  // Boards
  createBoard(name: string) { return this.request("POST", "/api/boards", { name }); }
  listBoards() { return this.request("GET", "/api/boards"); }
  getBoard(id: string) { return this.request("GET", `/api/boards/${id}`); }

  // Tasks
  createTask(input: Record<string, unknown>) { return this.request("POST", "/api/tasks", input); }
  listTasks(params?: Record<string, string>) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return this.request("GET", `/api/tasks${qs}`);
  }
  getTask(id: string) { return this.request("GET", `/api/tasks/${id}`); }
  claimTask(id: string, agentName?: string) {
    return this.request("POST", `/api/tasks/${id}/claim`, agentName ? { agent_name: agentName } : {});
  }
  completeTask(id: string, body: Record<string, unknown>) {
    return this.request("POST", `/api/tasks/${id}/complete`, body);
  }
  releaseTask(id: string) {
    return this.request("POST", `/api/tasks/${id}/release`);
  }
  assignTask(id: string, agentId: string) {
    return this.request("POST", `/api/tasks/${id}/assign`, { agent_id: agentId });
  }
  addLog(taskId: string, detail: string, agentName?: string) {
    return this.request("POST", `/api/tasks/${taskId}/logs`, { detail, agent_name: agentName });
  }

  // Agents
  listAgents() { return this.request("GET", "/api/agents"); }

  // Projects
  createProject(input: { name: string; description?: string }) {
    return this.request("POST", "/api/projects", input);
  }
  listProjects() { return this.request<any[]>("GET", "/api/projects"); }
  getProjectByName(name: string) { return this.request("GET", `/api/projects?name=${encodeURIComponent(name)}`); }

  // Resources
  addResource(projectId: string, input: { type: string; name: string; uri: string; config?: string }) {
    return this.request("POST", `/api/projects/${projectId}/resources`, input);
  }
  listResources(projectId: string) { return this.request("GET", `/api/projects/${projectId}/resources`); }
}
