import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";

const LAST_BOARD_KEY = "ak-last-board";

/** Remember last visited board for redirect from "/" */
export function getLastBoardId(): string | null {
  return localStorage.getItem(LAST_BOARD_KEY);
}

export function setLastBoardId(id: string) {
  localStorage.setItem(LAST_BOARD_KEY, id);
}

/** Fetch a single board by ID (from URL params) */
export function useBoard(boardId: string | undefined) {
  const [board, setBoard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const failCount = useRef(0);

  const fetchBoard = useCallback(async () => {
    if (!boardId) {
      setBoard(null);
      setLoading(false);
      return;
    }

    try {
      const full = await api.boards.get(boardId);
      setBoard(full);
      setLastBoardId(boardId);
      failCount.current = 0;
      setError(null);
    } catch (e: any) {
      failCount.current++;
      if (e.status === 401 || e.message === "NOT_AUTHENTICATED") {
        setError("NOT_AUTHENTICATED");
      } else if (failCount.current >= 3) {
        setError("Can't reach server");
      }
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    setLoading(true);
    fetchBoard();
    const interval = setInterval(fetchBoard, 30000);
    return () => clearInterval(interval);
  }, [fetchBoard]);

  return { board, loading, error, refresh: fetchBoard };
}

/** Fetch the list of all boards (for switcher, redirect) */
export function useBoards() {
  const [boards, setBoards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBoards = useCallback(async () => {
    try {
      const list = await api.boards.list();
      setBoards(list);
    } catch {
      // silent — boards list is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  return { boards, loading, refresh: fetchBoards };
}
