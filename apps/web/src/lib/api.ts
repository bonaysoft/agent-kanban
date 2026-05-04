import type { AgentRuntime } from "@agent-kanban/shared";
import { getAuthToken, refreshAuthToken } from "./auth-client";

const API_BASE = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getAuthToken() ?? (await refreshAuthToken());
  if (!token) throw new Error("NOT_AUTHENTICATED");

  let res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    const freshToken = await refreshAuthToken();
    if (freshToken) {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${freshToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    }
  }

  const data = (await res.json()) as any;

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
      const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
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
    reject: (id: string) => request<any>("POST", `/tasks/${id}/reject`),
    assign: (id: string, agentId: string) => request<any>("POST", `/tasks/${id}/assign`, { agent_id: agentId }),
    addNote: (id: string, detail: string) => request<any>("POST", `/tasks/${id}/notes`, { detail }),
    getNotes: (id: string, since?: string) => {
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      return request<any[]>("GET", `/tasks/${id}/notes${qs}`);
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
  agents: {
    list: () => request<any[]>("GET", "/agents"),
    get: (id: string) => request<any>("GET", `/agents/${id}`),
    create: (input: {
      name?: string;
      username: string;
      bio?: string;
      soul?: string;
      role?: string;
      handoff_to?: string[];
      runtime: AgentRuntime;
      model?: string;
      skills?: string[];
    }) => request<any>("POST", "/agents", input),
    update: (id: string, body: Record<string, unknown>) => request<any>("PATCH", `/agents/${id}`, body),
    delete: (id: string) => request<void>("DELETE", `/agents/${id}`),
    sessions: (agentId: string) => request<any[]>("GET", `/agents/${agentId}/sessions`),
    inbox: (agentId: string) => request<{ emails: any[] }>("GET", `/agents/${agentId}/inbox`),
    inboxEmail: (agentId: string, emailId: string) => request<any>("GET", `/agents/${agentId}/inbox/${emailId}`),
  },
  machines: {
    list: () => request<any[]>("GET", "/machines"),
    get: (id: string) => request<any>("GET", `/machines/${id}`),
    delete: (id: string) => request<void>("DELETE", `/machines/${id}`),
  },
  boards: {
    list: () => request<any[]>("GET", "/boards"),
    get: (id: string) => request<any>("GET", `/boards/${id}`),
    create: (input: { name: string; type: "dev" | "ops"; description?: string }) => request<any>("POST", "/boards", input),
    update: (id: string, body: { name?: string; description?: string; visibility?: "private" | "public"; labels?: any[] }) =>
      request<any>("PATCH", `/boards/${id}`, body),
    createLabel: (id: string, body: { name: string; color: string; description?: string }) => request<any>("POST", `/boards/${id}/labels`, body),
    updateLabel: (id: string, name: string, body: { name?: string; color?: string; description?: string }) =>
      request<any>("PATCH", `/boards/${id}/labels/${encodeURIComponent(name)}`, body),
    deleteLabel: (id: string, name: string) => request<any>("DELETE", `/boards/${id}/labels/${encodeURIComponent(name)}`),
    delete: (id: string) => request<void>("DELETE", `/boards/${id}`),
  },
  share: {
    getBoard: (slug: string) =>
      fetch(`/api/share/${slug}`).then((r) => {
        if (!r.ok) throw new Error("Board not found");
        return r.json();
      }) as Promise<any>,
  },
  repositories: {
    list: () => request<any[]>("GET", "/repositories"),
    create: (input: { name: string; url: string }) => request<any>("POST", "/repositories", input),
    delete: (id: string) => request<void>("DELETE", `/repositories/${id}`),
  },
  admin: {
    getStats: () => request<any>("GET", "/admin/stats"),
    getMachines: () => request<any[]>("GET", "/admin/machines"),
  },
};
