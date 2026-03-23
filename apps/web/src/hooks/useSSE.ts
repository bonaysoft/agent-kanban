import { useState, useEffect, useRef, useCallback } from "react";
import { getAuthToken } from "../lib/auth-client";
import type { TaskLog, Message } from "@agent-kanban/shared";

const MAX_LOGS = 500;

interface UseSSEOptions {
  taskId: string;
  enabled?: boolean;
}

function appendCapped<T>(prev: T[], item: T): T[] {
  const next = [...prev, item];
  return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
}

export function useSSE({ taskId, enabled = true }: UseSSEOptions) {
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const failCount = useRef(0);
  const lastEventId = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const connectRef = useRef<(() => EventSource | undefined) | undefined>(undefined);

  const token = getAuthToken();

  const connectSSE = useCallback(() => {
    if (!token || !enabled) return;

    const url = `/api/tasks/${taskId}/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.onopen = () => {
      setConnected(true);
      setReconnecting(false);
      failCount.current = 0;
    };

    // Named event handlers for typed SSE events
    es.addEventListener("log", (e: MessageEvent) => {
      const log = JSON.parse(e.data);
      lastEventId.current = e.lastEventId;
      setLogs((prev) => appendCapped(prev, log));
    });

    es.addEventListener("message", (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      lastEventId.current = e.lastEventId;
      setMessages((prev) => appendCapped(prev, msg));
    });

    es.onerror = () => {
      es.close();
      setConnected(false);
      failCount.current++;

      if (failCount.current >= 3) {
        setReconnecting(true);
        return;
      }

      setReconnecting(true);
      setTimeout(() => connectRef.current?.(), 2000);
    };

    return es;
  }, [taskId, token, enabled]);

  // Keep ref in sync so setTimeout always calls the latest version
  connectRef.current = connectSSE;

  // Polling fallback
  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const [logsRes, msgsRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}/logs`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/tasks/${taskId}/messages`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (logsRes.ok) setLogs(await logsRes.json());
      if (msgsRes.ok) setMessages(await msgsRes.json());
    } catch (err) {
      console.error("[useSSE] polling failed:", err instanceof Error ? err.message : err);
    }
  }, [taskId, token]);

  useEffect(() => {
    if (!enabled) return;

    const es = connectSSE();

    return () => {
      es?.close();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [connectSSE, enabled]);

  // Start polling fallback after 3 SSE failures
  useEffect(() => {
    if (reconnecting && failCount.current >= 3) {
      intervalRef.current = setInterval(poll, 5000);
      poll();
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  }, [reconnecting, poll]);

  return { logs, messages, connected, reconnecting };
}
