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

function buildProgram(captureAction: (action: CommandAction) => void): any {
  const makeCommand = (name?: string): any => {
    const command = {
      description: () => command,
      option: () => command,
      action: (action: CommandAction) => {
        if (name === "agent <id>") captureAction(action);
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

async function runUpdateAgent(opts: Record<string, string | undefined>): Promise<void> {
  const { registerUpdateCommand } = await import("../packages/cli/src/commands/update.js");
  let action!: CommandAction;
  registerUpdateCommand(buildProgram((registeredAction) => (action = registeredAction)));
  await action("agent-1", opts);
}

describe("registerUpdateCommand agent", () => {
  beforeEach(() => {
    updateAgent.mockReset();
    output.mockReset();
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
      skills: "agent-kanban,reviewer",
      subagents: "worker-1",
    });

    expect(updateAgent).toHaveBeenCalledWith("agent-1", {
      name: "Renamed Agent",
      skills: ["agent-kanban", "reviewer"],
      subagents: ["worker-1"],
    });
  });
});
