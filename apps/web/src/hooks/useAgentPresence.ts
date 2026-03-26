import type { BoardNote, Task, TaskAction } from "@agent-kanban/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { liftCard, resetCard, slideCard } from "../lib/cardEffects";
import { useBoardSSE } from "./useBoardSSE";

export type AvatarPhase = "spawning" | "flying" | "absorbing" | "emerging" | "dragging" | "working" | "returning" | "leaving";

export interface AgentAvatar {
  agentId: string;
  agentName: string | null;
  publicKey: string;
  taskId: string;
  phase: AvatarPhase;
}

// ─── Choreography definitions ───

const DRAG_TARGETS: Partial<Record<TaskAction, string>> = {
  claimed: "in_progress",
  review_requested: "in_review",
  completed: "done",
  rejected: "in_progress",
  cancelled: "cancelled",
};

interface ChoreographyStep {
  delay: number;
  phase?: AvatarPhase;
  remove?: boolean;
  cardEffect?: (taskId: string, target: string) => void;
  invalidate?: boolean;
}

// Agent spawns, flies, lifts card, slides to target, absorbs
const CLAIM_SEQUENCE: ChoreographyStep[] = [
  { delay: 0, phase: "spawning" },
  { delay: 500, phase: "flying" },
  { delay: 1100, cardEffect: (tid) => liftCard(tid) },
  { delay: 1300, phase: "dragging", cardEffect: (tid, t) => slideCard(tid, t) },
  { delay: 1900, phase: "absorbing", cardEffect: (tid) => resetCard(tid), invalidate: true },
  { delay: 2300, remove: true },
];

// Agent emerges, lifts card, slides to target, returns to header
const MOVE_SEQUENCE: ChoreographyStep[] = [
  { delay: 0, phase: "emerging" },
  { delay: 500, cardEffect: (tid) => liftCard(tid) },
  { delay: 700, phase: "dragging", cardEffect: (tid, t) => slideCard(tid, t) },
  { delay: 1300, phase: "returning", cardEffect: (tid) => resetCard(tid), invalidate: true },
  { delay: 1800, phase: "leaving" },
  { delay: 2100, remove: true },
];

function getSequence(action: TaskAction): ChoreographyStep[] | null {
  if (action === "claimed") return CLAIM_SEQUENCE;
  if (action === "review_requested" || action === "completed" || action === "rejected" || action === "cancelled") return MOVE_SEQUENCE;
  return null;
}

// ─── Hook ───

export function useAgentPresence(boardId: string | undefined, tasks: Task[]) {
  const { events } = useBoardSSE(boardId);
  const [avatars, setAvatars] = useState<Map<string, AgentAvatar>>(new Map());
  const processedRef = useRef(0);
  const queryClient = useQueryClient();
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
  const initializedRef = useRef(false);

  const cancelChoreography = useCallback((agentId: string) => {
    const existing = timersRef.current.get(agentId);
    if (existing) {
      existing.forEach(clearTimeout);
      timersRef.current.delete(agentId);
    }
  }, []);

  const runChoreography = useCallback(
    (event: BoardNote, sequence: ChoreographyStep[]) => {
      const agentId = event.agent_id!;
      const taskId = event.task_id;
      const target = DRAG_TARGETS[event.action] || "";

      cancelChoreography(agentId);
      const scheduled: ReturnType<typeof setTimeout>[] = [];

      for (const step of sequence) {
        const timer = setTimeout(() => {
          if (step.phase) {
            setAvatars((prev) => {
              const next = new Map(prev);
              if (step.phase === "spawning" || step.phase === "emerging") {
                next.set(agentId, {
                  agentId,
                  agentName: event.agent_name,
                  publicKey: event.agent_public_key!,
                  taskId,
                  phase: step.phase!,
                });
              } else {
                const a = next.get(agentId);
                if (a) next.set(agentId, { ...a, phase: step.phase! });
              }
              return next;
            });
          }
          if (step.cardEffect) step.cardEffect(taskId, target);
          if (step.remove) {
            setAvatars((prev) => {
              const next = new Map(prev);
              next.delete(agentId);
              return next;
            });
            timersRef.current.delete(agentId);
          }
          if (step.invalidate) {
            queryClient.invalidateQueries({ queryKey: ["board", boardId] });
          }
        }, step.delay);
        scheduled.push(timer);
      }

      timersRef.current.set(agentId, scheduled);
    },
    [boardId, cancelChoreography, queryClient],
  );

  // Derive initial presence from board tasks (once)
  useEffect(() => {
    if (initializedRef.current || tasks.length === 0) return;
    initializedRef.current = true;

    const initial = new Map<string, AgentAvatar>();
    for (const task of tasks) {
      if (task.assigned_to && (task as any).agent_public_key && task.status === "in_progress") {
        initial.set(task.assigned_to, {
          agentId: task.assigned_to,
          agentName: (task as any).agent_name || null,
          publicKey: (task as any).agent_public_key,
          taskId: task.id,
          phase: "working",
        });
      }
    }
    setAvatars(initial);
  }, [tasks]);

  // Process SSE events → choreographies
  useEffect(() => {
    const unprocessed = events.slice(processedRef.current);
    if (unprocessed.length === 0) return;
    processedRef.current = events.length;

    for (const event of unprocessed) {
      if (!event.agent_id || !event.agent_public_key) continue;
      const sequence = getSequence(event.action);
      if (sequence) runChoreography(event, sequence);
    }
  }, [events, runChoreography]);

  useEffect(() => {
    return () => {
      for (const t of timersRef.current.values()) t.forEach(clearTimeout);
    };
  }, []);

  return Array.from(avatars.values());
}
