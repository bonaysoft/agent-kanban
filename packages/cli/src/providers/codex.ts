import type { AgentEvent, AgentProvider, SpawnOpts } from "./types.js";

/** Per 1M tokens, OpenAI pricing */
const CODEX_PRICING: Record<string, { input: number; cached_input: number; output: number }> = {
  o3: { input: 2.0, cached_input: 0.5, output: 8.0 },
  "o4-mini": { input: 1.1, cached_input: 0.275, output: 4.4 },
  "gpt-4.1": { input: 2.0, cached_input: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cached_input: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cached_input: 0.025, output: 0.4 },
  "codex-mini-latest": { input: 1.5, cached_input: 0.375, output: 6.0 },
};

let currentModel = "o3";

// "try again at Apr 1st, 2026 6:11 PM" → ISO string
const RESET_RE = /try again at (.+)/i;
function parseRateLimitReset(msg: string): string | null {
  const match = RESET_RE.exec(msg);
  if (!match) return null;
  // Strip ordinal suffixes (1st, 2nd, 3rd, 4th) so Date.parse works
  const cleaned = match[1].replace(/(\d+)(st|nd|rd|th)/g, "$1").replace(/\.$/, "");
  const ms = Date.parse(cleaned);
  return Number.isNaN(ms) ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : new Date(ms).toISOString();
}

function calcCost(inputTokens: number, cachedInputTokens: number, outputTokens: number): number {
  const price = CODEX_PRICING[currentModel] ?? CODEX_PRICING.o3;
  return (inputTokens * price.input + cachedInputTokens * price.cached_input + outputTokens * price.output) / 1_000_000;
}

export const codexProvider: AgentProvider = {
  name: "codex",
  label: "Codex CLI",
  command: "codex",

  buildArgs(opts: SpawnOpts): string[] {
    if (opts.model) currentModel = opts.model;
    const args = ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox"];
    if (opts.systemPromptFile) {
      args.push("-c", `model_instructions_file=${opts.systemPromptFile}`);
    }
    if (opts.model) {
      args.push("-m", opts.model);
    }
    args.push("-");
    return args;
  },

  buildResumeArgs(sessionId: string, model?: string): string[] {
    if (model) currentModel = model;
    const args = ["exec", "resume", sessionId, "--json", "--dangerously-bypass-approvals-and-sandbox"];
    if (model) {
      args.push("-m", model);
    }
    args.push("-");
    return args;
  },

  parseEvent(raw: string): AgentEvent | null {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return null;
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item?.text) {
      return { type: "message", text: event.item.text };
    }

    // turn.completed is the terminal event — exec mode always produces exactly one turn
    if (event.type === "turn.completed" && event.usage) {
      const { input_tokens, cached_input_tokens, output_tokens } = event.usage;
      const cost = calcCost(input_tokens ?? 0, cached_input_tokens ?? 0, output_tokens ?? 0);
      return {
        type: "result",
        cost,
        usage: {
          input_tokens: input_tokens ?? 0,
          output_tokens: output_tokens ?? 0,
          cache_read_input_tokens: cached_input_tokens ?? 0,
          cache_creation_input_tokens: 0,
        },
      };
    }

    // turn.failed — API error or rate limit
    if (event.type === "turn.failed") {
      const msg = String(event.error?.message || JSON.stringify(event));
      const resetAt = parseRateLimitReset(msg);
      if (resetAt) return { type: "rate_limit", resetAt };
      return { type: "error", detail: msg };
    }

    if (event.type === "error") {
      const detail = String(event.message || JSON.stringify(event));
      const resetAt = parseRateLimitReset(detail);
      if (resetAt) return { type: "rate_limit", resetAt };
      return { type: "error", detail };
    }

    return null;
  },

  buildInput(taskContext: string): string {
    return taskContext;
  },
};
