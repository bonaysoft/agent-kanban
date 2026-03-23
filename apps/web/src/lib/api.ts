import { getAuthToken } from "./auth-client";
import type {
  Task,
  TaskWithLogs,
  TaskLog,
  Message,
  AgentWithActivity,
  AgentSession,
  MachineWithAgents,
  Board,
  BoardWithTasks,
  Repository,
  CreateTaskInput,
} from "@agent-kanban/shared";

const API_BASE = "/api";

interface ApiError extends Error {
  code: string;
  status: number;
}

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shape varies per endpoint
  const data: any = await res.json();

  if (!res.ok) {
    const err = new Error(data.error?.message || `HTTP ${res.status}`) as ApiError;
    err.code = data.error?.code || "UNKNOWN";
    err.status = res.status;
    throw err;
  }

  return data as T;
}

export const api = {
  tasks: {
    list: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<Task[]>("GET", `/tasks${qs}`);
    },
    get: (id: string) => request<TaskWithLogs>("GET", `/tasks/${id}`),
    create: (input: CreateTaskInput) => request<Task>("POST", "/tasks", input),
    update: (id: string, body: Record<string, unknown>) => request<Task>("PATCH", `/tasks/${id}`, body),
    delete: (id: string) => request<void>("DELETE", `/tasks/${id}`),
    claim: (id: string) => request<Task>("POST", `/tasks/${id}/claim`),
    complete: (id: string, body?: Record<string, unknown>) => request<Task>("POST", `/tasks/${id}/complete`, body),
    release: (id: string) => request<Task>("POST", `/tasks/${id}/release`),
    cancel: (id: string) => request<Task>("POST", `/tasks/${id}/cancel`),
    review: (id: string) => request<Task>("POST", `/tasks/${id}/review`),
    reject: (id: string) => request<Task>("POST", `/tasks/${id}/reject`),
    assign: (id: string, agentId: string) => request<Task>("POST", `/tasks/${id}/assign`, { agent_id: agentId }),
    addLog: (id: string, detail: string) => request<TaskLog>("POST", `/tasks/${id}/logs`, { detail }),
    getLogs: (id: string, since?: string) => {
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      return request<TaskLog[]>("GET", `/tasks/${id}/logs${qs}`);
    },
  },
  messages: {
    list: (taskId: string, since?: string) => {
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      return request<Message[]>("GET", `/tasks/${taskId}/messages${qs}`);
    },
    create: (taskId: string, body: { sender_type: string; sender_id: string; content: string }) =>
      request<Message>("POST", `/tasks/${taskId}/messages`, body),
  },
  agents: {
    list: () => request<AgentWithActivity[]>("GET", "/agents"),
    get: (id: string) => request<AgentWithActivity>("GET", `/agents/${id}`),
    create: (input: { name: string; bio?: string; soul?: string; role?: string; handoff_to?: string[]; runtime?: string; model?: string; skills?: string[] }) =>
      request<AgentWithActivity>("POST", "/agents", input),
    update: (id: string, body: Record<string, unknown>) => request<AgentWithActivity>("PATCH", `/agents/${id}`, body),
    delete: (id: string) => request<void>("DELETE", `/agents/${id}`),
    sessions: (agentId: string) => request<AgentSession[]>("GET", `/agents/${agentId}/sessions`),
  },
  machines: {
    list: () => request<MachineWithAgents[]>("GET", "/machines"),
    get: (id: string) => request<MachineWithAgents>("GET", `/machines/${id}`),
    delete: (id: string) => request<void>("DELETE", `/machines/${id}`),
  },
  boards: {
    list: () => request<Board[]>("GET", "/boards"),
    get: (id: string) => request<BoardWithTasks>("GET", `/boards/${id}`),
    create: (input: { name: string; description?: string }) => request<Board>("POST", "/boards", input),
    update: (id: string, body: { name?: string; description?: string }) => request<Board>("PATCH", `/boards/${id}`, body),
    delete: (id: string) => request<void>("DELETE", `/boards/${id}`),
  },
  repositories: {
    list: () => request<Repository[]>("GET", "/repositories"),
    create: (input: { name: string; url: string }) => request<Repository>("POST", "/repositories", input),
    delete: (id: string) => request<void>("DELETE", `/repositories/${id}`),
  },
};
