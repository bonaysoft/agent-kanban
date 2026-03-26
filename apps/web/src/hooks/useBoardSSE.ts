import type { BoardNote } from "@agent-kanban/shared";
import { useEffect, useRef, useState } from "react";
import { getAuthToken } from "../lib/auth-client";

const MAX_EVENTS = 50;

export function useBoardSSE(boardId: string | undefined) {
  const [events, setEvents] = useState<BoardNote[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!boardId) return;

    function connect() {
      esRef.current?.close();

      // Read token on every reconnect so refreshed tokens are picked up
      const token = getAuthToken();
      if (!token) return;

      const url = `/api/boards/${boardId}/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
      };

      es.addEventListener("board_note", (e: MessageEvent) => {
        const note: BoardNote = JSON.parse(e.data);
        setEvents((prev) => {
          if (prev.some((existing) => existing.id === note.id)) return prev;
          const next = [...prev, note];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setConnected(false);
        reconnectTimer.current = setTimeout(connect, 2000);
      };
    }

    connect();

    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [boardId]);

  return { events, connected };
}
