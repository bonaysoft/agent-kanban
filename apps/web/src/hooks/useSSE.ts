import { useState, useEffect, useRef, useCallback } from "react";
import { getAuthToken } from "../lib/auth-client";

interface UseSSEOptions {
  taskId: string;
  enabled?: boolean;
}

export function useSSE({ taskId, enabled = true }: UseSSEOptions) {
  const [logs, setLogs] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const failCount = useRef(0);
  const lastEventId = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

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
      setLogs((prev) => [...prev, log]);
    });

    es.addEventListener("message", (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      lastEventId.current = e.lastEventId;
      setMessages((prev) => [...prev, msg]);
    });

    es.addEventListener("comment", (e: MessageEvent) => {
      const comment = JSON.parse(e.data);
      lastEventId.current = e.lastEventId;
      setComments((prev) => [...prev, comment]);
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
      setTimeout(connectSSE, 2000);
    };

    return es;
  }, [taskId, token, enabled]);

  // Polling fallback
  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [logsRes, msgsRes, commentsRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}/logs`, { headers }),
        fetch(`/api/tasks/${taskId}/messages`, { headers }),
        fetch(`/api/tasks/${taskId}/comments`, { headers }),
      ]);
      if (logsRes.ok) setLogs(await logsRes.json());
      if (msgsRes.ok) setMessages(await msgsRes.json());
      if (commentsRes.ok) setComments(await commentsRes.json());
    } catch { /* ignore polling errors */ }
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

  return { logs, messages, comments, connected, reconnecting };
}
