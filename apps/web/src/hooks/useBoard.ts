import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";

const BOARD_KEY = "ak-active-board";

export function useBoard() {
  const [board, setBoard] = useState<any>(null);
  const [boards, setBoards] = useState<any[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(
    localStorage.getItem(BOARD_KEY),
  );
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

      const targetId = activeBoardId && allBoards.some((b: any) => b.id === activeBoardId)
        ? activeBoardId
        : allBoards[0].id;

      if (targetId !== activeBoardId) {
        setActiveBoardId(targetId);
        localStorage.setItem(BOARD_KEY, targetId);
      }

      const full = await api.boards.get(targetId);
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
  }, [activeBoardId]);

  useEffect(() => {
    fetchBoard();
    const interval = setInterval(fetchBoard, 30000);
    return () => clearInterval(interval);
  }, [fetchBoard]);

  function switchBoard(boardId: string) {
    setActiveBoardId(boardId);
    localStorage.setItem(BOARD_KEY, boardId);
  }

  return { board, boards, activeBoardId, loading, error, refresh: fetchBoard, switchBoard };
}
