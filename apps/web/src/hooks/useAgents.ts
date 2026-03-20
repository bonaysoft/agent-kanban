import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

export function useAgents() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const result = await api.agents.list();
      setAgents(result);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { agents, loading, refresh: fetch };
}
