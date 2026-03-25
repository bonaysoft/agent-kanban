import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
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
  const {
    data: board = null,
    isLoading: loading,
    error: rawError,
    refetch,
  } = useQuery({
    queryKey: ["board", boardId],
    queryFn: () => api.boards.get(boardId!),
    enabled: !!boardId,
    refetchInterval: 30_000,
    retry: 2,
  });

  useEffect(() => {
    if (boardId && board) setLastBoardId(boardId);
  }, [boardId, board]);

  const error = rawError ? ((rawError as any).message === "NOT_AUTHENTICATED" ? "NOT_AUTHENTICATED" : "Can't reach server") : null;

  return { board, loading, error, refresh: refetch };
}

/** Fetch the list of all boards (for switcher, redirect) */
export function useBoards() {
  const {
    data: boards = [],
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: ["boards"],
    queryFn: () => api.boards.list(),
  });

  return { boards, loading, refresh: refetch };
}
