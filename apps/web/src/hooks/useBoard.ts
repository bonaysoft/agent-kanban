import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";

export function useBoard() {
  const [boards, setBoards] = useState<any[]>([]);
  const [board, setBoard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const failCount = useRef(0);

  const fetchBoard = useCallback(async () => {
    try {
      const allBoards = await api.boards.list();
      setBoards(allBoards);

      if (allBoards.length === 0) {
        setBoard(null);
        setLoading(false);
        return;
      }

      const full = await api.boards.get(allBoards[0].id);
      setBoard(full);
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
  }, []);

  useEffect(() => {
    fetchBoard();
    const interval = setInterval(fetchBoard, 30000);
    return () => clearInterval(interval);
  }, [fetchBoard]);

  return { boards, board, loading, error, refresh: fetchBoard };
}
