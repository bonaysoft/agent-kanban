// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAgent = vi.fn();
const output = vi.fn();

vi.mock("../packages/cli/src/agent/leader.js", () => ({
  createClient: vi.fn(async () => ({
    createAgent,
  })),
}));

vi.mock("../packages/cli/src/output.js", () => ({
  getOutputFormat: vi.fn((format?: string) => format ?? "text"),
  output,
}));

type CommandAction = (opts: Record<string, string | undefined>) => Promise<void>;

type CapturedCommand = {
  action?: CommandAction;
  options: string[];
};

function buildProgram(captureAgent: (command: CapturedCommand) => void): any {
  const makeCommand = (name?: string): any => {
    const captured: CapturedCommand = { options: [] };
    const command = {
      description: () => command,
      requiredOption: (flags: string) => {
        captured.options.push(flags);
        return command;
      },
      option: (flags: string) => {
        captured.options.push(flags);
        return command;
      },
      action: (action: CommandAction) => {
        captured.action = action;
        if (name === "agent") captureAgent(captured);
        return command;
      },
      command: (childName: string) => makeCommand(childName),
    };
    return command;
  };

  return {
    command: () => makeCommand("create"),
  };
}

async function registerCreateAgent(): Promise<CapturedCommand> {
  const { registerCreateCommand } = await import("../packages/cli/src/commands/create.js");
  let agentCommand!: CapturedCommand;
  registerCreateCommand(buildProgram((command) => (agentCommand = command)));
  return agentCommand;
}

describe("registerCreateCommand agent", () => {
  beforeEach(() => {
    createAgent.mockReset();
    output.mockReset();
  });

  it("does not expose a template option", async () => {
    const command = await registerCreateAgent();

    expect(command.options.some((option) => option.includes("--template"))).toBe(false);
  });

  it("does not expose a kind option", async () => {
    const command = await registerCreateAgent();

    expect(command.options.some((option) => option.includes("--kind"))).toBe(false);
  });

  it("creates an agent from explicit flags", async () => {
    const command = await registerCreateAgent();
    createAgent.mockResolvedValue({ id: "agent-1", name: "Worker Agent", role: "build" });

    await command.action!({
      username: "worker-agent",
      name: "Worker Agent",
      bio: "Coordinates work",
      soul: "Keep work moving",
      role: "build",
      runtime: "codex",
      model: "gpt-5",
      handoffTo: "qa, devops",
      skills: "saltbo/agent-kanban@agent-kanban,trailofbits/skills@differential-review",
      subagents: "worker-1",
      output: "json",
    });

    expect(createAgent).toHaveBeenCalledWith({
      username: "worker-agent",
      name: "Worker Agent",
      bio: "Coordinates work",
      soul: "Keep work moving",
      role: "build",
      runtime: "codex",
      model: "gpt-5",
      kind: "worker",
      handoff_to: ["qa", "devops"],
      skills: ["saltbo/agent-kanban@agent-kanban", "trailofbits/skills@differential-review"],
      subagents: ["worker-1"],
    });
    expect(output).toHaveBeenCalledWith({ id: "agent-1", name: "Worker Agent", role: "build" }, "json", expect.any(Function));
  });
});
