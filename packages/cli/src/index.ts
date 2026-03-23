#!/usr/bin/env node
import { readFileSync } from "fs";
import { join } from "path";
import { Command } from "commander";
import { setConfigValue, getConfigValue } from "./config.js";
import { type ApiClient, MachineClient, createClient } from "./client.js";
import { getFormat, output, formatTaskList, formatBoard, formatAgentList, formatBoardList, formatRepositoryList } from "./output.js";
import { registerLinkCommand, registerUnlinkCommand } from "./commands/link.js";
import { registerStartCommand } from "./commands/start.js";
import { fetchTemplate } from "./templates.js";

function isUrl(value: string): boolean {
  return value.includes("://") || value.startsWith("git@");
}

async function resolveRepoId(client: ApiClient, repoRef: string): Promise<string> {
  if (!isUrl(repoRef)) return repoRef;
  const repos = await client.listRepositories({ url: repoRef });
  if (repos.length === 0) {
    console.error(`Repository not found for URL: ${repoRef}`);
    process.exit(1);
  }
  return repos[0].id;
}

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf-8"));

const program = new Command();
program.name("agent-kanban").description("Agent-first kanban board").version(pkg.version);

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
  .option("--repo <repo>", "Repository ID or URL")
  .option("--priority <priority>", "Priority (low, medium, high, urgent)")
  .option("--labels <labels>", "Comma-separated labels")
  .option("--input <json>", "JSON input payload")
  .option("--assign-to <id>", "Agent ID to assign the task to")
  .option("--parent <id>", "Parent task ID (creates subtask)")
  .option("--depends-on <ids>", "Comma-separated task IDs this depends on")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = await createClient();

    const body: Record<string, unknown> = { title: opts.title };
    if (opts.description) body.description = opts.description;
    if (opts.repo) {
      body.repository_id = await resolveRepoId(client, opts.repo);
    }
    if (opts.priority) body.priority = opts.priority;
    if (opts.labels) body.labels = opts.labels.split(",").map((l: string) => l.trim());
    if (opts.assignTo) body.assigned_to = opts.assignTo;
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
  .option("--repo <repo>", "Filter by repository ID")
  .option("--status <status>", "Filter by status (column name)")
  .option("--label <label>", "Filter by label")
  .option("--parent <id>", "Filter subtasks of a parent task")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = await createClient();
    const params: Record<string, string> = {};
    if (opts.repo) params.repository_id = opts.repo;
    if (opts.status) params.status = opts.status;
    if (opts.label) params.label = opts.label;
    if (opts.parent) params.parent = opts.parent;

    const tasks = await client.listTasks(params);
    const fmt = getFormat(opts.format);
    output(tasks, fmt, formatTaskList);
  });

taskCmd
  .command("claim <id>")
  .description("Claim an assigned task — start working on it")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const task = await client.claimTask(id);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t: any) => `Claimed task ${t.id}: ${t.title} (now in progress)`);
  });

taskCmd
  .command("log <id> <message>")
  .description("Add a log entry to a task")
  .action(async (id, message) => {
    const client = await createClient();
    await client.addLog(id, message);
    console.log("Log entry added.");
  });

taskCmd
  .command("cancel <id>")
  .description("Cancel a task")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const task = await client.cancelTask(id);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Cancelled task ${t.id}: ${t.title}`);
  });

taskCmd
  .command("review <id>")
  .description("Move a task to In Review")
  .option("--pr-url <url>", "Pull request URL")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const body: Record<string, unknown> = {};
    if (opts.prUrl) body.pr_url = opts.prUrl;
    const task = await client.reviewTask(id, body);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Moved task ${t.id} to review: ${t.title}`);
  });

taskCmd
  .command("complete <id>")
  .description("Complete a task")
  .option("--result <result>", "Completion result summary")
  .option("--pr-url <url>", "PR URL")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const body: Record<string, unknown> = {};
    if (opts.result) body.result = opts.result;
    if (opts.prUrl) body.pr_url = opts.prUrl;
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
    const client = new MachineClient();
    const agents = await client.listAgents();
    const fmt = getFormat(opts.format);
    output(agents, fmt, formatAgentList);
  });

agentCmd
  .command("create")
  .description("Create a new agent (from template or manual)")
  .option("--template <slug>", "Agent template slug (e.g. fullstack-developer, feature-planner)")
  .option("--name <name>", "Agent name")
  .option("--bio <bio>", "Agent bio")
  .option("--role <role>", "Agent role")
  .option("--runtime <runtime>", "Agent runtime (e.g. claude-code)")
  .option("--model <model>", "Model to use")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new MachineClient();

    let body: Record<string, unknown>;

    if (opts.template) {
      const template = await fetchTemplate(opts.template);
      body = {
        name: opts.name || template.name,
        bio: template.bio,
        soul: template.soul,
        role: template.role,
        handoff_to: template.handoff_to,
        runtime: opts.runtime || template.runtime,
        model: opts.model || template.model,
        skills: template.skills,
      };
    } else {
      if (!opts.name) {
        console.error("Either --template or --name is required");
        process.exit(1);
      }
      body = { name: opts.name };
      if (opts.bio) body.bio = opts.bio;
      if (opts.role) body.role = opts.role;
      if (opts.runtime) body.runtime = opts.runtime;
      if (opts.model) body.model = opts.model;
    }

    const agent = await client.createAgent(body as any);
    const fmt = getFormat(opts.format);
    output(agent, fmt, (a) => `Created agent ${a.id}: ${a.name} (${a.role || "no role"})`);
  });

// ─── Board ───

const boardCmd = program.command("board").description("Manage boards");

boardCmd
  .command("create")
  .description("Create a new board")
  .requiredOption("--name <name>", "Board name")
  .option("--description <desc>", "Board description")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new MachineClient();
    const board = await client.createBoard({ name: opts.name, description: opts.description });
    const fmt = getFormat(opts.format);
    output(board, fmt, (b) => `Created board ${b.id}: ${b.name}`);
  });

boardCmd
  .command("list")
  .description("List all boards")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new MachineClient();
    const boards = await client.listBoards();
    const fmt = getFormat(opts.format);
    output(boards, fmt, formatBoardList);
  });

boardCmd
  .command("view")
  .description("View a kanban board")
  .option("--board <name-or-id>", "Board name or ID (uses first if omitted)")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new MachineClient();
    let boardId: string;

    if (opts.board) {
      boardId = await resolveBoardId(client, opts.board);
    } else {
      const boards = await client.listBoards();
      if (boards.length === 0) {
        console.error("No boards. Create one first: agent-kanban board create --name 'My Board'");
        process.exit(1);
      }
      boardId = boards[0].id;
    }

    const board = await client.getBoard(boardId);
    const fmt = getFormat(opts.format);
    output(board, fmt, formatBoard);
  });

async function resolveBoardId(client: ApiClient, nameOrId: string): Promise<string> {
  const boards = await client.listBoards();
  const match = boards.find((b: any) => b.id === nameOrId || b.name === nameOrId);
  if (!match) {
    console.error(`Board not found: ${nameOrId}`);
    process.exit(1);
  }
  return match.id;
}

// ─── Repo ───

const repoCmd = program.command("repo").description("Manage repositories");

repoCmd
  .command("add")
  .description("Add a repository")
  .requiredOption("--name <name>", "Repository name")
  .requiredOption("--url <url>", "Clone URL")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new MachineClient();
    const repo = await client.createRepository({ name: opts.name, url: opts.url });
    const fmt = getFormat(opts.format);
    output(repo, fmt, (r) => `Added repository ${r.id}: ${r.name}`);
  });

repoCmd
  .command("list")
  .description("List repositories")
  .option("--format <format>", "Output format (json, text)")
  .action(async (opts) => {
    const client = new MachineClient();
    const repos = await client.listRepositories();
    const fmt = getFormat(opts.format);
    output(repos, fmt, formatRepositoryList);
  });

// ─── Link & Start ───

registerLinkCommand(program);
registerUnlinkCommand(program);
registerStartCommand(program);

program.parseAsync();
