import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

export function useAgents() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await api.agents.list();
      setAgents(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load agents";
      setError(message);
      console.error("[useAgents] fetch failed:", message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { agents, loading, error, refresh: load };
}
