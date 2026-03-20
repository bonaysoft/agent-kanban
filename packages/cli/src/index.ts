#!/usr/bin/env node
import { Command } from "commander";
import { setConfigValue, getConfigValue } from "./config";
import { ApiClient } from "./client";
import { detectProject } from "./project";
import { getFormat, output, formatTaskList, formatBoard, formatAgentList } from "./output";

const program = new Command();
program.name("agent-kanban").description("Agent-first cross-project kanban board").version("1.0.0");

// ─── Config ───

const configCmd = program.command("config").description("Manage CLI configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a config value (api-url, api-key)")
  .action((key, value) => {
    setConfigValue(key, value);
    console.log(`Set ${key}`);
  });

configCmd
  .command("get <key>")
  .description("Get a config value")
  .action((key) => {
    const value = getConfigValue(key);
    if (value) console.log(value);
    else {
      console.error(`Not set: ${key}`);
      process.exit(1);
    }
  });

// ─── Task ───

const taskCmd = program.command("task").description("Manage tasks");

taskCmd
  .command("create")
  .description("Create a new task")
  .requiredOption("--title <title>", "Task title")
  .option("--description <desc>", "Task description")
  .option("--project <project>", "Project name")
  .option("--priority <priority>", "Priority (low, medium, high, urgent)")
  .option("--labels <labels>", "Comma-separated labels")
  .option("--input <json>", "JSON input payload")
  .option("--agent-name <name>", "Agent identity")
  .option("--parent <id>", "Parent task ID (creates subtask)")
  .option("--depends-on <ids>", "Comma-separated task IDs this depends on")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new ApiClient();
    const project = detectProject(opts.project);

    const body: Record<string, unknown> = { title: opts.title };
    if (opts.description) body.description = opts.description;
    if (project) body.project = project;
    if (opts.priority) body.priority = opts.priority;
    if (opts.labels) body.labels = opts.labels.split(",").map((l: string) => l.trim());
    if (opts.agentName) body.agent_name = opts.agentName;
    if (opts.parent) body.created_from = opts.parent;
    if (opts.dependsOn) body.depends_on = opts.dependsOn.split(",").map((id: string) => id.trim());
    if (opts.input) {
      try { body.input = JSON.parse(opts.input); }
      catch { console.error("Invalid JSON for --input"); process.exit(1); }
    }

    const task = await client.createTask(body);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Created task ${t.id}: ${t.title}`);
  });

taskCmd
  .command("list")
  .description("List tasks")
  .option("--project <project>", "Filter by project")
  .option("--status <status>", "Filter by status (column name)")
  .option("--label <label>", "Filter by label")
  .option("--parent <id>", "Filter subtasks of a parent task")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new ApiClient();
    const params: Record<string, string> = {};
    const project = detectProject(opts.project);
    if (project) params.project = project;
    if (opts.status) params.status = opts.status;
    if (opts.label) params.label = opts.label;
    if (opts.parent) params.parent = opts.parent;

    const tasks = await client.listTasks(params);
    const fmt = getFormat(opts.format);
    output(tasks, fmt, formatTaskList);
  });

taskCmd
  .command("claim <id>")
  .description("Claim a task")
  .option("--agent-name <name>", "Agent identity")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = new ApiClient();
    const task = await client.claimTask(id, opts.agentName);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Claimed task ${t.id}: ${t.title}`);
  });

taskCmd
  .command("release <id>")
  .description("Release a claimed task back to Todo")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = new ApiClient();
    const task = await client.releaseTask(id);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Released task ${t.id}: ${t.title}`);
  });

taskCmd
  .command("assign <id>")
  .description("Assign a task to an agent")
  .requiredOption("--agent <agent-id>", "Agent ID to assign to")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = new ApiClient();
    const task = await client.assignTask(id, opts.agent);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Assigned task ${t.id}: ${t.title}`);
  });

taskCmd
  .command("log <id> <message>")
  .description("Add a log entry to a task")
  .option("--agent-name <name>", "Agent identity")
  .action(async (id, message, opts) => {
    const client = new ApiClient();
    await client.addLog(id, message, opts.agentName);
    console.log("Log entry added.");
  });

taskCmd
  .command("complete <id>")
  .description("Complete a task")
  .option("--result <result>", "Completion result summary")
  .option("--pr-url <url>", "PR URL")
  .option("--agent-name <name>", "Agent identity")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = new ApiClient();
    const body: Record<string, unknown> = {};
    if (opts.result) body.result = opts.result;
    if (opts.prUrl) body.pr_url = opts.prUrl;
    if (opts.agentName) body.agent_name = opts.agentName;
    const task = await client.completeTask(id, body);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Completed task ${t.id}: ${t.title}`);
  });

// ─── Agent ───

const agentCmd = program.command("agent").description("Manage agents");

agentCmd
  .command("list")
  .description("List all agents")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new ApiClient();
    const agents = await client.listAgents();
    const fmt = getFormat(opts.format);
    output(agents, fmt, formatAgentList);
  });

// ─── Board ───

const boardCmd = program.command("board").description("Manage boards");

boardCmd
  .command("view")
  .description("View the kanban board")
  .option("--board <id>", "Board ID (uses default if omitted)")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new ApiClient();
    let board: any;

    if (opts.board) {
      board = await client.getBoard(opts.board);
    } else {
      const boards = await client.listBoards() as any[];
      if (boards.length === 0) {
        console.error("No boards. Create one first: agent-kanban board create --name 'My Board'");
        process.exit(1);
      }
      if (boards.length > 1) {
        console.error("Multiple boards exist. Use --board <id> to specify.");
        process.exit(1);
      }
      board = await client.getBoard(boards[0].id);
    }

    const fmt = getFormat(opts.format);
    output(board, fmt, formatBoard);
  });

boardCmd
  .command("create")
  .description("Create a new board")
  .requiredOption("--name <name>", "Board name")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new ApiClient();
    const board = await client.createBoard(opts.name);
    const fmt = getFormat(opts.format);
    output(board, fmt, (b) => `Created board ${b.id}: ${b.name}`);
  });

program.parseAsync();
