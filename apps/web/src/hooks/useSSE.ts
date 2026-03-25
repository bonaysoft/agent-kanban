import { useEffect, useRef, useState } from "react";
import { getAuthToken } from "../lib/auth-client";

interface UseSSEOptions {
  taskId: string;
  enabled?: boolean;
}

export function useSSE({ taskId, enabled = true }: UseSSEOptions) {
  const [logs, setLogs] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const failCount = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pollTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!enabled) return;

    const token = getAuthToken();
    if (!token) return;

    function connect() {
      // Close previous connection if any
      esRef.current?.close();

      const url = `/api/tasks/${taskId}/stream?token=${encodeURIComponent(token!)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setReconnecting(false);
        failCount.current = 0;
        // Stop polling if it was active
        if (pollTimer.current) {
          clearInterval(pollTimer.current);
          pollTimer.current = undefined;
        }
      };

      es.addEventListener("log", (e: MessageEvent) => {
        setLogs((prev) => [...prev, JSON.parse(e.data)]);
      });

      es.addEventListener("message", (e: MessageEvent) => {
        setMessages((prev) => [...prev, JSON.parse(e.data)]);
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setConnected(false);
        failCount.current++;

        if (failCount.current >= 3) {
          setReconnecting(true);
          startPolling(token!);
          return;
        }

        setReconnecting(true);
        reconnectTimer.current = setTimeout(connect, 2000);
      };
    }

    function startPolling(tk: string) {
      if (pollTimer.current) return;
      const poll = async () => {
        try {
          const headers = { Authorization: `Bearer ${tk}` };
          const [logsRes, msgsRes] = await Promise.all([
            fetch(`/api/tasks/${taskId}/logs`, { headers }),
            fetch(`/api/tasks/${taskId}/messages`, { headers }),
          ]);
          if (logsRes.ok) setLogs(await logsRes.json());
          if (msgsRes.ok) setMessages(await msgsRes.json());
        } catch {
          /* ignore polling errors */
        }
      };
      poll();
      pollTimer.current = setInterval(poll, 5000);
    }

    connect();

    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [taskId, enabled]);

  return { logs, messages, connected, reconnecting };
}
