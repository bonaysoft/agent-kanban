import { getAuthToken } from "./auth-client";

const API_BASE = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new Error("NOT_AUTHENTICATED");

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json() as any;

  if (!res.ok) {
    const err = new Error(data.error?.message || `HTTP ${res.status}`);
    (err as any).code = data.error?.code || "UNKNOWN";
    (err as any).status = res.status;
    throw err;
  }

  return data as T;
}

export const api = {
  tasks: {
    list: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<any[]>("GET", `/tasks${qs}`);
    },
    get: (id: string) => request<any>("GET", `/tasks/${id}`),
    create: (input: Record<string, unknown>) => request<any>("POST", "/tasks", input),
    update: (id: string, body: Record<string, unknown>) => request<any>("PATCH", `/tasks/${id}`, body),
    delete: (id: string) => request<void>("DELETE", `/tasks/${id}`),
    claim: (id: string) => request<any>("POST", `/tasks/${id}/claim`),
    complete: (id: string, body?: Record<string, unknown>) => request<any>("POST", `/tasks/${id}/complete`, body),
    release: (id: string) => request<any>("POST", `/tasks/${id}/release`),
    cancel: (id: string) => request<any>("POST", `/tasks/${id}/cancel`),
    review: (id: string) => request<any>("POST", `/tasks/${id}/review`),
    assign: (id: string, agentId: string) => request<any>("POST", `/tasks/${id}/assign`, { agent_id: agentId }),
    addLog: (id: string, detail: string) => request<any>("POST", `/tasks/${id}/logs`, { detail }),
    getLogs: (id: string, since?: string) => {
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      return request<any[]>("GET", `/tasks/${id}/logs${qs}`);
    },
  },
  messages: {
    list: (taskId: string, since?: string) => {
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      return request<any[]>("GET", `/tasks/${taskId}/messages${qs}`);
    },
    create: (taskId: string, body: { sender_type: string; sender_id: string; content: string }) =>
      request<any>("POST", `/tasks/${taskId}/messages`, body),
  },
  comments: {
    list: (taskId: string, since?: string) => {
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      return request<any[]>("GET", `/tasks/${taskId}/comments${qs}`);
    },
    create: (taskId: string, body: { content: string; author_type?: string; author_id?: string }) =>
      request<any>("POST", `/tasks/${taskId}/comments`, body),
  },
  checks: {
    list: (taskId: string) => request<any[]>("GET", `/tasks/${taskId}/checks`),
    create: (taskId: string, description: string) =>
      request<any>("POST", `/tasks/${taskId}/checks`, { description }),
    update: (taskId: string, checkId: string, body: { description?: string }) =>
      request<any>("PATCH", `/tasks/${taskId}/checks/${checkId}`, body),
    delete: (taskId: string, checkId: string) =>
      request<void>("DELETE", `/tasks/${taskId}/checks/${checkId}`),
    verify: (taskId: string, checkId: string, passed: boolean, agentId?: string) =>
      request<any>("POST", `/tasks/${taskId}/checks/${checkId}/verify`, { passed, agent_id: agentId }),
  },
  agents: {
    list: () => request<any[]>("GET", "/agents"),
    get: (id: string) => request<any>("GET", `/agents/${id}`),
    create: (input: { username: string; name: string; bio?: string; soul?: string; role?: string; handoff_to?: string[]; runtime?: string; model?: string; skills?: string[] }) =>
      request<any>("POST", "/agents", input),
    update: (id: string, body: Record<string, unknown>) => request<any>("PATCH", `/agents/${id}`, body),
    delete: (id: string) => request<void>("DELETE", `/agents/${id}`),
    sessions: (agentId: string) => request<any[]>("GET", `/agents/${agentId}/sessions`),
  },
  machines: {
    list: () => request<any[]>("GET", "/machines"),
    get: (id: string) => request<any>("GET", `/machines/${id}`),
    delete: (id: string) => request<void>("DELETE", `/machines/${id}`),
  },
  boards: {
    list: () => request<any[]>("GET", "/boards"),
    get: (id: string) => request<any>("GET", `/boards/${id}`),
    create: (input: { name: string; description?: string }) => request<any>("POST", "/boards", input),
    update: (id: string, body: { name?: string; description?: string }) => request<any>("PATCH", `/boards/${id}`, body),
    delete: (id: string) => request<void>("DELETE", `/boards/${id}`),
  },
  repositories: {
    list: () => request<any[]>("GET", "/repositories"),
    create: (input: { name: string; url: string }) => request<any>("POST", "/repositories", input),
    delete: (id: string) => request<void>("DELETE", `/repositories/${id}`),
  },
};
