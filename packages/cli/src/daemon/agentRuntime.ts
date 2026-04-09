/**
 * Per-agent lifecycle management.
 *
 * consumeEvents: the for-await event loop over the agent handle's iterator.
 * finalize: classify how the iterator ended, apply state machine event,
 *   and react to the resulting state (cleanup / preserve / rate-limit).
 * finalizeCancelled: killTask path — drives straight to terminal.
 */

import { cleanupPromptFile } from "../agent/systemPrompt.js";
import type { AgentClient, ApiClient } from "../client/index.js";
import { createLogger } from "../logger.js";
import type { AgentEvent, AgentHandle } from "../providers/types.js";
import { getSessionManager } from "../session/manager.js";
import { classifyIteratorEnd, type SessionEvent } from "../session/stateMachine.js";
import { apiFireAndForget } from "./boundaries.js";
import { type AgentFlags, type RateLimitSink, routeEvent, type TunnelSink } from "./eventRouter.js";

const logger = createLogger("agent-runtime");

export interface AgentProcess {
  taskId: string;
  sessionId: string;
  handle: AgentHandle;
  providerName: string;
  agentClient: AgentClient;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  rateLimited: boolean;
  resultReceived: boolean;
  taskInReview: boolean;
  onCleanup?: () => void;
}

export interface RuntimeContext {
  client: ApiClient;
  rateLimitSink: RateLimitSink;
  tunnel: TunnelSink | null;
  isAlive: (taskId: string) => boolean;
}

export async function consumeEvents(agent: AgentProcess, ctx: RuntimeContext): Promise<{ crashed: boolean; error?: unknown }> {
  const flags: AgentFlags = {
    taskId: agent.taskId,
    sessionId: agent.sessionId,
    providerName: agent.providerName,
    rateLimited: agent.rateLimited,
    resultReceived: agent.resultReceived,
    taskInReview: agent.taskInReview,
    handle: agent.handle,
  };

  const crashed = false;
  let error: unknown;

  for await (const event of agent.handle.events) {
    if (!ctx.isAlive(agent.taskId)) return { crashed: false };
    await routeEvent(flags, event, agent.agentClient, ctx.rateLimitSink, ctx.tunnel);
  }

  // Sync mutable flags back to agent process
  agent.rateLimited = flags.rateLimited;
  agent.resultReceived = flags.resultReceived;
  agent.taskInReview = flags.taskInReview;

  return { crashed, error };
}

export async function finalize(agent: AgentProcess, opts: { crashed: boolean; error?: unknown }, ctx: RuntimeContext): Promise<void> {
  const { taskId, sessionId } = agent;
  const sessions = getSessionManager();

  clearTimer(agent);
  cleanupPromptFile(sessionId);

  apiFireAndForget(
    "closeSession",
    () => ctx.client.closeSession(agent.agentClient.getAgentId(), sessionId),
    (msg) => logger.warn(`Failed to close session ${sessionId}: ${msg}`),
  );

  if (opts.crashed) {
    const err = opts.error as { exitCode?: number; stderr?: string; message?: string } | undefined;
    logger.warn(`Agent crashed on task ${taskId} (${agent.providerName}, exit ${err?.exitCode ?? "?"}): ${err?.message ?? ""}`);
    if (err?.stderr) logger.warn(`stderr: ${err.stderr}`);
  } else {
    logger.info(`Agent finished task ${taskId}`);
  }

  const event: SessionEvent = classifyIteratorEnd({
    resultReceived: agent.resultReceived,
    rateLimited: agent.rateLimited,
    taskInReview: agent.taskInReview,
    crashed: opts.crashed,
  });

  const next = await sessions.applyEvent(sessionId, event).catch((e) => {
    logger.error(`State transition failed for ${sessionId}: ${errMessage(e)}`);
    return null;
  });

  const nextStatus = next?.status ?? "terminal";

  if (nextStatus === "completing") {
    if (opts.crashed) {
      apiFireAndForget(
        "releaseTask",
        () => ctx.client.releaseTask(taskId),
        (msg) => logger.warn(`Failed to release crashed task ${taskId}: ${msg}`),
      );
    }
    runCleanup(agent, ctx.tunnel);
    await sessions.applyEvent(sessionId, { type: "cleanup_done" }).catch((e) => {
      logger.warn(`Cleanup transition failed for ${sessionId}: ${errMessage(e)}`);
    });
  } else if (nextStatus === "in_review") {
    (ctx.tunnel as TunnelSink & { sendStatus?: (sid: string, s: string) => void })?.sendStatus?.(sessionId, "done");
    logger.info(`Task ${taskId} in review, preserving worktree`);
  } else if (nextStatus === "rate_limited") {
    logger.warn(`Agent for task ${taskId} (${agent.providerName}) exited while rate-limited, suspending`);
  }
}

export async function finalizeCancelled(agent: AgentProcess, ctx: RuntimeContext): Promise<void> {
  const sessions = getSessionManager();
  cleanupPromptFile(agent.sessionId);

  await sessions.applyEvent(agent.sessionId, { type: "task_cancelled" }).catch((e) => {
    logger.warn(`task_cancelled transition failed for ${agent.sessionId}: ${errMessage(e)}`);
  });
  runCleanup(agent, ctx.tunnel);
  await sessions.applyEvent(agent.sessionId, { type: "cleanup_done" }).catch((e) => {
    logger.warn(`cleanup_done transition failed for ${agent.sessionId}: ${errMessage(e)}`);
  });
  apiFireAndForget(
    "closeSession",
    () => ctx.client.closeSession(agent.agentClient.getAgentId(), agent.sessionId),
    (msg) => logger.warn(`Failed to close session ${agent.sessionId}: ${msg}`),
  );
}

function runCleanup(agent: AgentProcess, tunnel: TunnelSink | null): void {
  (tunnel as TunnelSink & { sendStatus?: (sid: string, s: string) => void })?.sendStatus?.(agent.sessionId, "done");
  agent.onCleanup?.();
}

function clearTimer(agent: AgentProcess): void {
  if (agent.timeoutTimer) {
    clearTimeout(agent.timeoutTimer);
    agent.timeoutTimer = undefined;
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
