// @vitest-environment node
/**
 * Tests for `get task` command handler in commands/get.ts.
 *
 * Covers the --board required validation added to list mode:
 *   - `ak get task` (no id, no --board) → error + process.exit(1)
 *   - `ak get task --board <id>` → calls client.listTasks with board_id param
 *   - `ak get task <id>` (no --board) → calls client.getTask, no error
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock createClient before importing the command ────────────────────────────

const mockGetTask = vi.fn();
const mockListTasks = vi.fn();
const mockClient = { getTask: mockGetTask, listTasks: mockListTasks };
const mockCreateClient = vi.fn(() => Promise.resolve(mockClient));

vi.mock("../src/agent/leader.js", () => ({
  createClient: mockCreateClient,
}));

// Silence output helpers — we don't test formatting
vi.mock("../src/output.js", () => ({
  getOutputFormat: vi.fn(() => "text"),
  output: vi.fn(),
  formatTask: vi.fn(),
  formatTaskList: vi.fn(),
  formatTaskListWide: vi.fn(),
  formatBoard: vi.fn(),
  formatBoardList: vi.fn(),
  formatAgent: vi.fn(),
  formatAgentList: vi.fn(),
  formatRepository: vi.fn(),
  formatRepositoryList: vi.fn(),
  formatTaskNotes: vi.fn(),
}));

const { registerGetCommand } = await import("../src/commands/get.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevents real process.exit inside commander's own validation
  registerGetCommand(program);
  return program;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

let exitSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockListTasks.mockResolvedValue([]);
  mockGetTask.mockResolvedValue({ id: "task-1", title: "Test task" });

  exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit called");
  }) as any);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  exitSpy.mockRestore();
  errorSpy.mockRestore();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("get task — list mode without --board", () => {
  it("prints an error message when --board is omitted", async () => {
    const program = makeProgram();
    await expect(program.parseAsync(["get", "task"], { from: "user" })).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith("Error: --board is required when listing tasks\nUsage: ak get task --board <id>");
  });

  it("exits with code 1 when --board is omitted", async () => {
    const program = makeProgram();
    await expect(program.parseAsync(["get", "task"], { from: "user" })).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does not call client.listTasks when --board is omitted", async () => {
    const program = makeProgram();
    await expect(program.parseAsync(["get", "task"], { from: "user" })).rejects.toThrow("process.exit called");
    expect(mockListTasks).not.toHaveBeenCalled();
  });
});

describe("get task — list mode with --board", () => {
  it("calls client.listTasks with board_id when --board is provided", async () => {
    const program = makeProgram();
    await program.parseAsync(["get", "task", "--board", "board-abc"], { from: "user" });
    expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ board_id: "board-abc" }));
  });

  it("does not call process.exit when --board is provided", async () => {
    const program = makeProgram();
    await program.parseAsync(["get", "task", "--board", "board-abc"], { from: "user" });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("passes --status filter to listTasks when provided", async () => {
    const program = makeProgram();
    await program.parseAsync(["get", "task", "--board", "board-abc", "--status", "in_progress"], { from: "user" });
    expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ board_id: "board-abc", status: "in_progress" }));
  });

  it("passes --label filter to listTasks when provided", async () => {
    const program = makeProgram();
    await program.parseAsync(["get", "task", "--board", "board-abc", "--label", "bug"], { from: "user" });
    expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ board_id: "board-abc", label: "bug" }));
  });

  it("passes --repo filter as repository_id to listTasks when provided", async () => {
    const program = makeProgram();
    await program.parseAsync(["get", "task", "--board", "board-abc", "--repo", "repo-xyz"], { from: "user" });
    expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ board_id: "board-abc", repository_id: "repo-xyz" }));
  });
});

describe("get task — single-task fetch by ID", () => {
  it("calls client.getTask with the provided id", async () => {
    const program = makeProgram();
    await program.parseAsync(["get", "task", "task-42"], { from: "user" });
    expect(mockGetTask).toHaveBeenCalledWith("task-42");
  });

  it("does not call process.exit when an id is provided without --board", async () => {
    const program = makeProgram();
    await program.parseAsync(["get", "task", "task-42"], { from: "user" });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does not call client.listTasks when an id is provided", async () => {
    const program = makeProgram();
    await program.parseAsync(["get", "task", "task-42"], { from: "user" });
    expect(mockListTasks).not.toHaveBeenCalled();
  });
});
