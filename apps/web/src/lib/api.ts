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

  const data = await res.json();

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
    create: (taskId: string, body: { agent_id: string; role: string; content: string }) =>
      request<any>("POST", `/tasks/${taskId}/messages`, body),
  },
  agents: {
    list: () => request<any[]>("GET", "/agents"),
    get: (id: string) => request<any>("GET", `/agents/${id}`),
  },
  machines: {
    list: () => request<any[]>("GET", "/machines"),
    get: (id: string) => request<any>("GET", `/machines/${id}`),
    create: (name?: string) => request<any>("POST", "/machines", { name }),
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
