import { useState, useEffect, useRef, useCallback } from "react";

interface UseSSEOptions {
  taskId: string;
  enabled?: boolean;
}

export function useSSE({ taskId, enabled = true }: UseSSEOptions) {
  const [logs, setLogs] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const failCount = useRef(0);
  const lastEventId = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const token = localStorage.getItem("api-key");

  const connectSSE = useCallback(() => {
    if (!token || !enabled) return;

    const url = `/api/tasks/${taskId}/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.onopen = () => {
      setConnected(true);
      setReconnecting(false);
      failCount.current = 0;
    };

    es.onmessage = (e) => {
      const log = JSON.parse(e.data);
      lastEventId.current = e.lastEventId;
      setLogs((prev) => [...prev, log]);
    };

    es.onerror = () => {
      es.close();
      setConnected(false);
      failCount.current++;

      if (failCount.current >= 3) {
        // Fall back to polling
        setReconnecting(true);
        return;
      }

      // Reconnect after brief delay
      setReconnecting(true);
      setTimeout(connectSSE, 2000);
    };

    return es;
  }, [taskId, token, enabled]);

  // Polling fallback
  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const since = lastEventId.current
        ? undefined // Use log-based dedup
        : undefined;
      const res = await fetch(`/api/tasks/${taskId}/logs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const allLogs = await res.json();
        setLogs(allLogs);
      }
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
      poll(); // Immediate first poll
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  }, [reconnecting, poll]);

  return { logs, connected, reconnecting };
}
