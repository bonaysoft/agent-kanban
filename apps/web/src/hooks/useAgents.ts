import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useAgents() {
  const {
    data: agents = [],
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents.list(),
    refetchInterval: 15_000,
  });

  return { agents, loading, refresh: refetch };
}

export function useAgent(id: string | undefined) {
  const {
    data: agent = null,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.agents.get(id!),
    enabled: !!id,
    refetchInterval: 15_000,
  });

  return { agent, loading, refresh: refetch };
}

export function useAgentSessions(agentId: string | undefined) {
  const { data: sessions = [] } = useQuery({
    queryKey: ["agent-sessions", agentId],
    queryFn: () => api.agents.sessions(agentId!),
    enabled: !!agentId,
    refetchInterval: 15_000,
  });

  return { sessions };
}

export function useAgentTasks(agentId: string | undefined) {
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", { assigned_to: agentId }],
    queryFn: () => api.tasks.list({ assigned_to: agentId! }),
    enabled: !!agentId,
    refetchInterval: 15_000,
  });

  return { tasks };
}

export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.agents.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
