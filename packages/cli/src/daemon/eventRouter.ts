/**
 * Event dispatch — routes AgentEvents to the right handler.
 *
 * Each event type has a dedicated handler. Archive calls are fire-and-forget
 * (non-critical). Rate limit events update the agent's flags and notify the
 * RateLimiter. Turn-end triggers usage reporting and task status fetch.
 */

import type { AgentClient, ApiClient } from "../client/index.js";
import { createLogger } from "../logger.js";
import type { AgentEvent } from "../providers/types.js";
import { apiCallOptional, apiFireAndForget } from "./boundaries.js";

const logger = createLogger("event-router");

export interface AgentFlags {
  taskId: string;
  sessionId: string;
  providerName: string;
  rateLimited: boolean;
  resultReceived: boolean;
  taskInReview: boolean;
  handle: { abort(): Promise<void> };
}

export interface RateLimitSink {
  onRateLimited: (runtime: string, resetAt: string) => void;
  onRateLimitResumed: (runtime: string) => void;
}

export interface TunnelSink {
  sendEvent(sessionId: string, event: AgentEvent): void;
}

export async function routeEvent(
  agent: AgentFlags,
  event: AgentEvent,
  agentClient: AgentClient,
  rateLimitSink: RateLimitSink,
  tunnel: TunnelSink | null,
): Promise<void> {
  tunnel?.sendEvent(agent.sessionId, event);

  switch (event.type) {
    case "turn.rate_limit":
      routeRateLimit(agent, event, rateLimitSink);
      return;
    case "turn.error":
      logger.warn(`Agent error on task ${agent.taskId} (${agent.providerName}): ${event.detail}`);
      return;
    case "message":
      archiveMessage(agentClient, agent.taskId, event);
      return;
    case "block.done":
      archiveBlock(agentClient, agent.taskId, event);
      return;
    case "turn.end":
      await routeTurnEnd(agent, event, agentClient);
      return;
    default:
      return;
  }
}

function routeRateLimit(agent: AgentFlags, event: Extract<AgentEvent, { type: "turn.rate_limit" }>, sink: RateLimitSink): void {
  const runtime = agent.providerName;
  if (event.status === "rejected") {
    const mainReset = event.resetAt;
    const overageReset = event.overage?.status === "rejected" ? event.overage.resetAt : undefined;
    const candidates = [mainReset, overageReset].filter((x): x is string => !!x);
    const pauseUntil =
      candidates.length > 0
        ? candidates.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b))
        : new Date(Date.now() + 60 * 60 * 1000).toISOString();
    logger.warn(
      `Rate limited on task ${agent.taskId} (${runtime}), pausing until ${pauseUntil}${event.isUsingOverage ? " — agent continues via overage" : ""}`,
    );
    agent.rateLimited = true;
    sink.onRateLimited(runtime, pauseUntil);
    return;
  }
  if (event.isUsingOverage) {
    logger.info(`Task ${agent.taskId} (${runtime}) now running on overage, scheduler stays paused`);
    return;
  }
  logger.info(`Rate limit cleared for ${runtime}`);
  agent.rateLimited = false;
  sink.onRateLimitResumed(runtime);
}

async function routeTurnEnd(agent: AgentFlags, event: Extract<AgentEvent, { type: "turn.end" }>, agentClient: AgentClient): Promise<void> {
  const cost = event.cost || 0;
  const usage = event.usage || {};
  logger.info(`Agent result for task ${agent.taskId} (${agent.providerName}): cost=$${cost.toFixed(4)}`);

  apiFireAndForget(
    "updateSessionUsage",
    () =>
      agentClient.updateSessionUsage(agentClient.getAgentId(), agentClient.getSessionId(), {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cost_micro_usd: Math.round(cost * 1_000_000),
      }),
    (msg) => logger.error(`Failed to report usage for task ${agent.taskId}: ${msg}`),
  );

  agent.resultReceived = true;

  const task = (await apiCallOptional("getTask", () => agentClient.getTask(agent.taskId))) as { status?: string } | null;
  agent.taskInReview = task?.status === "in_review";
  if (agent.taskInReview) {
    logger.info(`Task ${agent.taskId} will preserve worktree for review`);
  }

  apiFireAndForget(
    "abort-after-result",
    () => agent.handle.abort(),
    (msg) => logger.warn(`Abort after result failed: ${msg}`),
  );
}

function archiveMessage(agentClient: AgentClient, taskId: string, event: Extract<AgentEvent, { type: "message" }>): void {
  const texts = event.blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
  if (texts.length === 0) return;
  apiFireAndForget(
    "sendMessage",
    () => agentClient.sendMessage(taskId, { sender_type: "agent", sender_id: agentClient.getAgentId(), content: texts.join("\n") }),
    (msg) => logger.error(`Failed to send message for task ${taskId}: ${msg}`),
  );
}

function archiveBlock(agentClient: AgentClient, taskId: string, event: Extract<AgentEvent, { type: "block.done" }>): void {
  const block = event.block;
  if (block.type !== "text" || !block.text) return;
  const text = block.text;
  apiFireAndForget(
    "sendMessage",
    () => agentClient.sendMessage(taskId, { sender_type: "agent", sender_id: agentClient.getAgentId(), content: text }),
    (msg) => logger.error(`Failed to send message for task ${taskId}: ${msg}`),
  );
}
