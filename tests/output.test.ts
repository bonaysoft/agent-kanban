// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  formatAgent,
  formatAgentList,
  formatBoard,
  formatBoardList,
  formatRepositoryList,
  formatTask,
  formatTaskList,
  formatTaskLogs,
  getFormat,
  output,
} from "../packages/cli/src/output";

describe("formatTask", () => {
  it("includes task title on the first line", () => {
    const task = { id: "t1", title: "My Task", status: "todo", priority: null };
    const result = formatTask(task);
    expect(result.split("\n")[0]).toBe("My Task");
  });

  it("includes task ID", () => {
    const task = { id: "abc123", title: "T", status: "todo", priority: null };
    const result = formatTask(task);
    expect(result).toContain("abc123");
  });

  it("includes status", () => {
    const task = { id: "t1", title: "T", status: "in_progress", priority: null };
    const result = formatTask(task);
    expect(result).toContain("in_progress");
  });

  it("appends BLOCKED to status when task is blocked", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, blocked: true };
    const result = formatTask(task);
    expect(result).toContain("BLOCKED");
  });

  it("does not show BLOCKED when blocked is false", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, blocked: false };
    const result = formatTask(task);
    expect(result).not.toContain("BLOCKED");
  });

  it("shows priority when present", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: "high" };
    const result = formatTask(task);
    expect(result).toContain("high");
  });

  it("shows 'none' for missing priority", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null };
    const result = formatTask(task);
    expect(result).toContain("none");
  });

  it("includes labels when present", () => {
    const task = {
      id: "t1",
      title: "T",
      status: "todo",
      priority: null,
      labels: ["bug", "urgent"],
    };
    const result = formatTask(task);
    expect(result).toContain("bug");
    expect(result).toContain("urgent");
  });

  it("does not include Labels line when labels are absent", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, labels: null };
    const result = formatTask(task);
    expect(result).not.toContain("Labels:");
  });

  it("includes assigned_to when present", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, assigned_to: "agent-7" };
    const result = formatTask(task);
    expect(result).toContain("agent-7");
  });

  it("omits Assigned line when assigned_to is absent", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, assigned_to: null };
    const result = formatTask(task);
    expect(result).not.toContain("Assigned to:");
  });

  it("includes repository_name when present", () => {
    const task = {
      id: "t1",
      title: "T",
      status: "todo",
      priority: null,
      repository_name: "my-repo",
    };
    const result = formatTask(task);
    expect(result).toContain("my-repo");
  });

  it("omits Repository line when repository_name is absent", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, repository_name: null };
    const result = formatTask(task);
    expect(result).not.toContain("Repository:");
  });

  it("includes depends_on IDs when present", () => {
    const task = {
      id: "t1",
      title: "T",
      status: "todo",
      priority: null,
      depends_on: ["dep1", "dep2"],
    };
    const result = formatTask(task);
    expect(result).toContain("dep1");
    expect(result).toContain("dep2");
  });

  it("omits Depends on line when depends_on is empty", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, depends_on: [] };
    const result = formatTask(task);
    expect(result).not.toContain("Depends on:");
  });

  it("includes pr_url when present", () => {
    const task = {
      id: "t1",
      title: "T",
      status: "todo",
      priority: null,
      pr_url: "https://github.com/org/repo/pull/42",
    };
    const result = formatTask(task);
    expect(result).toContain("https://github.com/org/repo/pull/42");
  });

  it("omits PR line when pr_url is absent", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, pr_url: null };
    const result = formatTask(task);
    expect(result).not.toContain("PR:");
  });

  it("includes description when present", () => {
    const task = {
      id: "t1",
      title: "T",
      status: "todo",
      priority: null,
      description: "A task description",
    };
    const result = formatTask(task);
    expect(result).toContain("A task description");
  });

  it("omits description section when absent", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, description: null };
    const result = formatTask(task);
    expect(result.split("\n").length).toBeLessThan(10);
  });

  it("includes input as JSON when present", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, input: { key: "value" } };
    const result = formatTask(task);
    expect(result).toContain('"key"');
    expect(result).toContain('"value"');
  });

  it("omits Input section when absent", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, input: null };
    const result = formatTask(task);
    expect(result).not.toContain("Input:");
  });

  it("includes result when present", () => {
    const task = {
      id: "t1",
      title: "T",
      status: "done",
      priority: null,
      result: "Completed successfully",
    };
    const result = formatTask(task);
    expect(result).toContain("Completed successfully");
  });

  it("omits Result line when result is absent", () => {
    const task = { id: "t1", title: "T", status: "todo", priority: null, result: null };
    const result = formatTask(task);
    expect(result).not.toContain("Result:");
  });
});

describe("formatTaskLogs", () => {
  it("returns 'No logs.' for empty array", () => {
    expect(formatTaskLogs([])).toBe("No logs.");
  });

  it("includes the action for each log entry", () => {
    const logs = [
      {
        id: "l1",
        task_id: "t1",
        actor_id: null,
        action: "created",
        detail: null,
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ];
    const result = formatTaskLogs(logs);
    expect(result).toContain("created");
  });

  it("includes the detail text when present", () => {
    const logs = [
      {
        id: "l1",
        task_id: "t1",
        actor_id: null,
        action: "commented",
        detail: "This is the detail",
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ];
    const result = formatTaskLogs(logs);
    expect(result).toContain("This is the detail");
  });

  it("includes actor_id when present", () => {
    const logs = [
      {
        id: "l1",
        task_id: "t1",
        actor_id: "agent-5",
        action: "claimed",
        detail: null,
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ];
    const result = formatTaskLogs(logs);
    expect(result).toContain("agent-5");
  });

  it("omits actor bracket when actor_id is absent", () => {
    const logs = [
      {
        id: "l1",
        task_id: "t1",
        actor_id: null,
        action: "created",
        detail: null,
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ];
    const result = formatTaskLogs(logs);
    expect(result).not.toContain("[null]");
    expect(result).not.toContain("[undefined]");
  });

  it("formats multiple log entries each on its own line", () => {
    const logs = [
      {
        id: "l1",
        task_id: "t1",
        actor_id: null,
        action: "created",
        detail: null,
        created_at: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "l2",
        task_id: "t1",
        actor_id: "ag1",
        action: "claimed",
        detail: null,
        created_at: "2024-01-02T00:00:00.000Z",
      },
    ];
    const result = formatTaskLogs(logs);
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
  });

  it("formats the created_at timestamp", () => {
    const logs = [
      {
        id: "l1",
        task_id: "t1",
        actor_id: null,
        action: "created",
        detail: null,
        created_at: "2024-06-15T10:30:00.000Z",
      },
    ];
    const result = formatTaskLogs(logs);
    // The timestamp should be a recognisable date string (locale-formatted)
    expect(result.trim().length).toBeGreaterThan(0);
  });
});

describe("formatAgent", () => {
  it("includes agent name on the first line", () => {
    const agent = { id: "a1", name: "Claude", status: "idle" };
    const result = formatAgent(agent);
    expect(result.split("\n")[0]).toBe("Claude");
  });

  it("includes agent ID", () => {
    const agent = { id: "agent-42", name: "Claude", status: "idle" };
    const result = formatAgent(agent);
    expect(result).toContain("agent-42");
  });

  it("includes status", () => {
    const agent = { id: "a1", name: "Claude", status: "working" };
    const result = formatAgent(agent);
    expect(result).toContain("working");
  });

  it("includes role when present", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", role: "developer" };
    const result = formatAgent(agent);
    expect(result).toContain("developer");
  });

  it("omits Role line when role is absent", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", role: null };
    const result = formatAgent(agent);
    expect(result).not.toContain("Role:");
  });

  it("includes bio when present", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", bio: "An AI assistant" };
    const result = formatAgent(agent);
    expect(result).toContain("An AI assistant");
  });

  it("omits Bio line when bio is absent", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", bio: null };
    const result = formatAgent(agent);
    expect(result).not.toContain("Bio:");
  });

  it("includes runtime when present", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", runtime: "Claude Code" };
    const result = formatAgent(agent);
    expect(result).toContain("Claude Code");
  });

  it("omits Runtime line when runtime is absent", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", runtime: null };
    const result = formatAgent(agent);
    expect(result).not.toContain("Runtime:");
  });

  it("includes model when present", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", model: "claude-opus-4" };
    const result = formatAgent(agent);
    expect(result).toContain("claude-opus-4");
  });

  it("omits Model line when model is absent", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", model: null };
    const result = formatAgent(agent);
    expect(result).not.toContain("Model:");
  });

  it("includes skills when present", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", skills: ["agent-kanban", "git"] };
    const result = formatAgent(agent);
    expect(result).toContain("agent-kanban");
    expect(result).toContain("git");
  });

  it("omits Skills line when skills array is empty", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", skills: [] };
    const result = formatAgent(agent);
    expect(result).not.toContain("Skills:");
  });

  it("includes handoff_to when present", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", handoff_to: ["reviewer-agent"] };
    const result = formatAgent(agent);
    expect(result).toContain("reviewer-agent");
  });

  it("omits Handoff line when handoff_to array is empty", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", handoff_to: [] };
    const result = formatAgent(agent);
    expect(result).not.toContain("Handoff:");
  });

  it("includes task_count when present", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", task_count: 3 };
    const result = formatAgent(agent);
    expect(result).toContain("3");
  });

  it("includes task_count when zero", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", task_count: 0 };
    const result = formatAgent(agent);
    expect(result).toContain("Tasks:");
  });

  it("omits Tasks line when task_count is null", () => {
    const agent = { id: "a1", name: "Claude", status: "idle", task_count: null };
    const result = formatAgent(agent);
    expect(result).not.toContain("Tasks:");
  });
});

describe("formatTaskList", () => {
  it("returns 'No tasks found.' for empty array", () => {
    expect(formatTaskList([])).toBe("No tasks found.");
  });

  it("includes task ID and title", () => {
    const tasks = [{ id: "t1", title: "Do something", status: "todo", priority: null }];
    const result = formatTaskList(tasks);
    expect(result).toContain("t1");
    expect(result).toContain("Do something");
  });

  it("includes priority bracket when present", () => {
    const tasks = [{ id: "t1", title: "T", status: "todo", priority: "high" }];
    const result = formatTaskList(tasks);
    expect(result).toContain("[high]");
  });

  it("includes repository name when present", () => {
    const tasks = [
      { id: "t1", title: "T", status: "todo", priority: null, repository_name: "my-repo" },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain("my-repo");
  });

  it("includes assigned_to agent when present", () => {
    const tasks = [
      { id: "t1", title: "T", status: "todo", priority: null, assigned_to: "agent-9" },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain("agent-9");
  });

  it("returns one line per task", () => {
    const tasks = [
      { id: "t1", title: "First", status: "todo", priority: null },
      { id: "t2", title: "Second", status: "todo", priority: null },
    ];
    const lines = formatTaskList(tasks).split("\n");
    expect(lines.length).toBe(2);
  });
});

describe("formatAgentList", () => {
  it("returns 'No agents found.' for empty array", () => {
    expect(formatAgentList([])).toBe("No agents found.");
  });

  it("includes agent ID and name", () => {
    const agents = [
      { id: "a1", name: "Claude", status: "idle", task_count: 0, last_active_at: null },
    ];
    const result = formatAgentList(agents);
    expect(result).toContain("a1");
    expect(result).toContain("Claude");
  });

  it("includes status", () => {
    const agents = [
      { id: "a1", name: "Claude", status: "working", task_count: 2, last_active_at: null },
    ];
    const result = formatAgentList(agents);
    expect(result).toContain("[working]");
  });

  it("shows 'never active' when last_active_at is null", () => {
    const agents = [
      { id: "a1", name: "Claude", status: "idle", task_count: 0, last_active_at: null },
    ];
    const result = formatAgentList(agents);
    expect(result).toContain("never active");
  });

  it("includes last_active_at when present", () => {
    const agents = [
      {
        id: "a1",
        name: "Claude",
        status: "idle",
        task_count: 0,
        last_active_at: "2024-01-01T00:00:00Z",
      },
    ];
    const result = formatAgentList(agents);
    expect(result).toContain("2024-01-01T00:00:00Z");
  });
});

describe("formatBoardList", () => {
  it("returns 'No boards found.' for empty array", () => {
    expect(formatBoardList([])).toBe("No boards found.");
  });

  it("includes board ID and name", () => {
    const boards = [{ id: "b1", name: "My Board", description: null }];
    const result = formatBoardList(boards);
    expect(result).toContain("b1");
    expect(result).toContain("My Board");
  });

  it("includes description when present", () => {
    const boards = [{ id: "b1", name: "My Board", description: "Work stuff" }];
    const result = formatBoardList(boards);
    expect(result).toContain("Work stuff");
  });

  it("omits description dash when description is absent", () => {
    const boards = [{ id: "b1", name: "My Board", description: null }];
    const result = formatBoardList(boards);
    expect(result).not.toContain(" — ");
  });
});

describe("formatRepositoryList", () => {
  it("returns 'No repositories found.' for empty array", () => {
    expect(formatRepositoryList([])).toBe("No repositories found.");
  });

  it("includes repo ID, name, and URL", () => {
    const repos = [{ id: "r1", name: "my-repo", url: "https://github.com/org/my-repo" }];
    const result = formatRepositoryList(repos);
    expect(result).toContain("r1");
    expect(result).toContain("my-repo");
    expect(result).toContain("https://github.com/org/my-repo");
  });
});

describe("formatBoard", () => {
  it("includes board name in header line", () => {
    const board = { name: "Sprint 1", columns: [] };
    const result = formatBoard(board);
    expect(result).toContain("Sprint 1");
  });

  it("renders column names in header row", () => {
    const board = {
      name: "My Board",
      columns: [
        { name: "Todo", tasks: [] },
        { name: "Done", tasks: [] },
      ],
    };
    const result = formatBoard(board);
    expect(result).toContain("Todo");
    expect(result).toContain("Done");
  });

  it("renders task titles inside column cells", () => {
    const board = {
      name: "My Board",
      columns: [{ name: "Todo", tasks: [{ title: "Build feature" }] }],
    };
    const result = formatBoard(board);
    expect(result).toContain("Build feature");
  });

  it("truncates long task titles with ellipsis", () => {
    const longTitle = "A".repeat(40);
    const board = {
      name: "My Board",
      columns: [{ name: "Todo", tasks: [{ title: longTitle }] }],
    };
    const result = formatBoard(board);
    expect(result).toContain("...");
  });

  it("renders empty cell placeholder when column has fewer tasks than max rows", () => {
    const board = {
      name: "My Board",
      columns: [
        { name: "Todo", tasks: [{ title: "Task A" }, { title: "Task B" }] },
        { name: "Done", tasks: [{ title: "Task C" }] },
      ],
    };
    const result = formatBoard(board);
    expect(result).toContain("Task A");
    expect(result).toContain("Task B");
    expect(result).toContain("Task C");
  });

  it("renders board structure with separator lines", () => {
    const board = {
      name: "My Board",
      columns: [{ name: "Todo", tasks: [] }],
    };
    const result = formatBoard(board);
    expect(result).toContain("┌");
    expect(result).toContain("┘");
    expect(result).toContain("├");
  });

  it("handles board with no columns gracefully", () => {
    const board = { name: "Empty Board", columns: [] };
    const result = formatBoard(board);
    expect(result).toContain("Empty Board");
  });
});

describe("getFormat", () => {
  it("returns 'json' when explicit is 'json'", () => {
    expect(getFormat("json")).toBe("json");
  });

  it("returns 'text' when explicit is 'text'", () => {
    expect(getFormat("text")).toBe("text");
  });

  it("returns a valid format string when no explicit value given", () => {
    const result = getFormat();
    expect(["json", "text"]).toContain(result);
  });
});

describe("output", () => {
  it("calls textFormatter in text mode when provided", () => {
    let called = false;
    const formatter = (_data: any) => {
      called = true;
      return "formatted";
    };
    // Redirect console.log to avoid test noise
    const original = console.log;
    console.log = () => {};
    output({ foo: "bar" }, "text", formatter);
    console.log = original;
    expect(called).toBe(true);
  });

  it("falls back to JSON.stringify in text mode when no formatter provided", () => {
    let logged = "";
    const original = console.log;
    console.log = (v: string) => {
      logged = v;
    };
    output({ foo: "bar" }, "text");
    console.log = original;
    expect(logged).toContain('"foo"');
  });

  it("outputs pretty-printed JSON in json mode", () => {
    let logged = "";
    const original = console.log;
    console.log = (v: string) => {
      logged = v;
    };
    output({ foo: "bar" }, "json");
    console.log = original;
    expect(JSON.parse(logged)).toEqual({ foo: "bar" });
  });
});
