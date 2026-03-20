import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

export function useAgents() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const result = await api.agents.list();
      setAgents(result);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { agents, loading, refresh: load };
}
