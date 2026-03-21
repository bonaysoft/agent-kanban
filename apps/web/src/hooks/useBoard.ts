import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";

const PROJECT_KEY = "ak-active-project";

export function useBoard() {
  const [board, setBoard] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    localStorage.getItem(PROJECT_KEY),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const failCount = useRef(0);

  const fetchBoard = useCallback(async () => {
    try {
      const allProjects = await api.projects.list();
      setProjects(allProjects);

      if (allProjects.length === 0) {
        setBoard(null);
        setLoading(false);
        return;
      }

      const targetId = activeProjectId && allProjects.some((p: any) => p.id === activeProjectId)
        ? activeProjectId
        : allProjects[0].id;

      if (targetId !== activeProjectId) {
        setActiveProjectId(targetId);
        localStorage.setItem(PROJECT_KEY, targetId);
      }

      const full = await api.projects.board(targetId);
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
  }, [activeProjectId]);

  useEffect(() => {
    fetchBoard();
    const interval = setInterval(fetchBoard, 30000);
    return () => clearInterval(interval);
  }, [fetchBoard]);

  function switchProject(projectId: string) {
    setActiveProjectId(projectId);
    localStorage.setItem(PROJECT_KEY, projectId);
  }

  return { board, projects, activeProjectId, loading, error, refresh: fetchBoard, switchProject };
}
