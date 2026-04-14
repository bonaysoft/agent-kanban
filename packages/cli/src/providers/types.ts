import type { AgentEvent, AgentRuntime, ContentBlock, UsageInfo, UsageWindow } from "@agent-kanban/shared";

export type { AgentEvent, AgentRuntime, ContentBlock, UsageInfo, UsageWindow };

/** Normalized history entry returned by provider history readers. */
export interface HistoryEvent {
  id: string;
  event: AgentEvent;
  timestamp: string;
}

export interface ExecuteOpts {
  sessionId: string;
  resumeToken?: string;
  cwd: string;
  env: Record<string, string>;
  taskContext: string;
  systemPromptFile?: string;
  model?: string;
  resume?: boolean;
}

/**
 * Uniform contract for every agent provider — SDK-based or process-based.
 *
 * Iterator termination semantics (both providers must conform):
 *   - Normal completion: iterator ends cleanly, no throw
 *   - Crash / internal failure: iterator throws (classified at boundary)
 *   - External abort(): iterator ends cleanly (abort is idempotent)
 *
 * Provider internals (process spawning, pipes, signals, zombie reaping,
 * abort idempotency) are fully encapsulated inside the provider. The daemon
 * layer never touches OS process concepts.
 */
export interface AgentHandle {
  events: AsyncIterable<AgentEvent>;
  abort(): Promise<void>;
  send(message: string): Promise<void>;
  getResumeToken?(): string | undefined;
}

export interface AgentProvider {
  readonly name: AgentRuntime;
  readonly label: string;
  execute(opts: ExecuteOpts): Promise<AgentHandle>;
  /**
   * Retrieve session history from this provider's local storage.
   * `sessionId` is the AK session ID; `resumeToken` is the provider-specific
   * identifier (e.g. Codex thread_id) stored in the session file.
   */
  getHistory?(sessionId: string, resumeToken?: string): Promise<HistoryEvent[]>;
  /**
   * Fetch current usage windows for this provider. Pure HTTP request — no
   * caching, no swallowing. Throws `UsageFetchError` on HTTP failure so the
   * caller (UsageCollector) can apply retry/backoff policy.
   *
   * Returns `null` only when the provider has no credentials configured —
   * that's a "not applicable" signal, not a failure.
   */
  fetchUsage?(): Promise<UsageInfo | null>;
}

/**
 * Raised by `AgentProvider.fetchUsage` when the upstream API is reachable
 * but returned a non-OK status, or when the request itself failed. Carries
 * the HTTP status (if any) and parsed `Retry-After` so the collector can
 * schedule the next attempt precisely.
 */
export class UsageFetchError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, opts: { status?: number; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "UsageFetchError";
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/**
 * Parse an HTTP `Retry-After` header value. Supports both delta-seconds
 * (e.g. `"120"`) and HTTP-date (e.g. `"Fri, 11 Apr 2026 14:30:00 GMT"`).
 * Returns milliseconds from now, or `undefined` if the header is missing
 * or malformed.
 */
export function parseRetryAfterMs(headerValue: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const ts = Date.parse(headerValue);
  if (!Number.isNaN(ts)) return Math.max(ts - now, 0);
  return undefined;
}
