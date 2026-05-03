// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateAgent = vi.fn();
const output = vi.fn();

vi.mock("../packages/cli/src/agent/leader.js", () => ({
  createClient: vi.fn(async () => ({
    updateAgent,
  })),
}));

vi.mock("../packages/cli/src/output.js", () => ({
  getOutputFormat: vi.fn((format?: string) => format ?? "text"),
  output,
}));

type CommandAction = (id: string, opts: Record<string, string | undefined>) => Promise<void>;

type CapturedCommand = {
  action?: CommandAction;
  options: string[];
};

function buildProgram(captureAgent: (command: CapturedCommand) => void): any {
  const makeCommand = (name?: string): any => {
    const captured: CapturedCommand = { options: [] };
    const command = {
      description: () => command,
      option: (flags: string) => {
        captured.options.push(flags);
        return command;
      },
      action: (action: CommandAction) => {
        captured.action = action;
        if (name === "agent <id>") captureAgent(captured);
        return command;
      },
      command: (childName: string) => makeCommand(childName),
    };
    return command;
  };

  return {
    command: () => makeCommand("update"),
  };
}

async function registerUpdateAgent(): Promise<CapturedCommand> {
  const { registerUpdateCommand } = await import("../packages/cli/src/commands/update.js");
  let agentCommand!: CapturedCommand;
  registerUpdateCommand(buildProgram((command) => (agentCommand = command)));
  return agentCommand;
}

async function runUpdateAgent(opts: Record<string, string | undefined>): Promise<void> {
  const command = await registerUpdateAgent();
  await command.action!("agent-1", opts);
}

describe("registerUpdateCommand agent", () => {
  beforeEach(() => {
    updateAgent.mockReset();
    output.mockReset();
  });

  it("does not expose a kind option", async () => {
    const command = await registerUpdateAgent();

    expect(command.options.some((option) => option.includes("--kind"))).toBe(false);
  });

  it("sends subagents as an array in the update payload", async () => {
    updateAgent.mockResolvedValue({ id: "agent-1", name: "Main Agent" });

    await runUpdateAgent({ subagents: "worker-1, worker-2", output: "json" });

    expect(updateAgent).toHaveBeenCalledWith("agent-1", {
      subagents: ["worker-1", "worker-2"],
    });
    expect(output).toHaveBeenCalledWith({ id: "agent-1", name: "Main Agent" }, "json", expect.any(Function));
  });

  it("keeps subagents alongside other agent update fields", async () => {
    updateAgent.mockResolvedValue({ id: "agent-1", name: "Renamed Agent" });

    await runUpdateAgent({
      name: "Renamed Agent",
      skills: "saltbo/agent-kanban@agent-kanban,trailofbits/skills@differential-review",
      subagents: "worker-1",
    });

    expect(updateAgent).toHaveBeenCalledWith("agent-1", {
      name: "Renamed Agent",
      skills: ["saltbo/agent-kanban@agent-kanban", "trailofbits/skills@differential-review"],
      subagents: ["worker-1"],
    });
  });
});
