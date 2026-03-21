#!/usr/bin/env node
import { Command } from "commander";
import { setConfigValue, getConfigValue } from "./config.js";
import { ApiClient } from "./client.js";
import { detectProjectId } from "./project.js";
import { getFormat, output, formatTaskList, formatBoard, formatAgentList, formatProjectList, formatResourceList } from "./output.js";
import { registerLinkCommand } from "./commands/link.js";
import { registerStartCommand } from "./commands/start.js";

const program = new Command();
program.name("agent-kanban").description("Agent-first cross-project kanban board").version("1.3.0");

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
    const projectId = await detectProjectId(client, opts.project);

    const body: Record<string, unknown> = { title: opts.title };
    if (opts.description) body.description = opts.description;
    if (projectId) body.project_id = projectId;
    if (opts.priority) body.priority = opts.priority;
    if (opts.labels) body.labels = opts.labels.split(",").map((l: string) => l.trim());
    if (opts.agentName) body.agent_id = opts.agentName;
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
    const projectId = await detectProjectId(client, opts.project);
    if (projectId) params.project_id = projectId;
    if (opts.status) params.status = opts.status;
    if (opts.label) params.label = opts.label;
    if (opts.parent) params.parent = opts.parent;

    const tasks = await client.listTasks(params);
    const fmt = getFormat(opts.format);
    output(tasks, fmt, formatTaskList);
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
  .command("cancel <id>")
  .description("Cancel a task")
  .option("--agent-name <name>", "Agent identity")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = new ApiClient();
    const body: Record<string, unknown> = {};
    if (opts.agentName) body.agent_name = opts.agentName;
    const task = await client.cancelTask(id, body);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Cancelled task ${t.id}: ${t.title}`);
  });

taskCmd
  .command("review <id>")
  .description("Move a task to In Review")
  .option("--agent-name <name>", "Agent identity")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = new ApiClient();
    const body: Record<string, unknown> = {};
    if (opts.agentName) body.agent_name = opts.agentName;
    const task = await client.reviewTask(id, body);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Moved task ${t.id} to review: ${t.title}`);
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
    if (opts.agentName) body.agent_id = opts.agentName;
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

// ─── Project ───

const projectCmd = program.command("project").description("Manage projects");

projectCmd
  .command("create")
  .description("Create a new project")
  .requiredOption("--name <name>", "Project name")
  .option("--description <desc>", "Project description")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new ApiClient();
    const project = await client.createProject({ name: opts.name, description: opts.description });
    const fmt = getFormat(opts.format);
    output(project, fmt, (p) => `Created project ${p.id}: ${p.name}`);
  });

projectCmd
  .command("list")
  .description("List all projects")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new ApiClient();
    const projects = await client.listProjects();
    const fmt = getFormat(opts.format);
    output(projects, fmt, formatProjectList);
  });

// ─── Resource ───

const resourceCmd = program.command("resource").description("Manage project resources");

resourceCmd
  .command("add")
  .description("Add a resource to a project")
  .requiredOption("--project <name-or-id>", "Project name or ID")
  .requiredOption("--type <type>", "Resource type (git_repo)")
  .requiredOption("--name <name>", "Resource name")
  .requiredOption("--uri <uri>", "Resource URI (e.g. clone URL)")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new ApiClient();
    const projectId = await resolveProjectId(client, opts.project);
    const resource = await client.addResource(projectId, { type: opts.type, name: opts.name, uri: opts.uri });
    const fmt = getFormat(opts.format);
    output(resource, fmt, (r) => `Added resource ${r.id}: ${r.name} (${r.type})`);
  });

resourceCmd
  .command("list")
  .description("List resources for a project")
  .requiredOption("--project <name-or-id>", "Project name or ID")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new ApiClient();
    const projectId = await resolveProjectId(client, opts.project);
    const resources = await client.listResources(projectId);
    const fmt = getFormat(opts.format);
    output(resources, fmt, formatResourceList);
  });

async function resolveProjectId(client: ApiClient, nameOrId: string): Promise<string> {
  const projects = await client.listProjects();
  const match = projects.find((p: any) => p.id === nameOrId || p.name === nameOrId);
  if (!match) {
    console.error(`Project not found: ${nameOrId}`);
    process.exit(1);
  }
  return match.id;
}

// ─── Link & Start ───

registerLinkCommand(program);
registerStartCommand(program);

program.parseAsync();
