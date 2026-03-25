import { fetchTemplate } from "@agent-kanban/shared";
import type { Command } from "commander";
import { type ApiClient, createClient } from "../client.js";
import { getFormat, output } from "../output.js";
import { normalizeResource } from "./resources.js";

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

async function createBoard(opts: Record<string, string>) {
  if (!opts.name) {
    console.error("--name is required for board creation");
    process.exit(1);
  }
  const client = await createClient();
  const board = await client.createBoard({ name: opts.name, description: opts.description });
  const fmt = getFormat(opts.format);
  output(board, fmt, (b) => `Created board ${b.id}: ${b.name}`);
}

async function createTask(opts: Record<string, string>) {
  if (!opts.board) {
    console.error("--board is required for task creation");
    process.exit(1);
  }
  if (!opts.title) {
    console.error("--title is required for task creation");
    process.exit(1);
  }
  const client = await createClient();

  const body: Record<string, unknown> = { title: opts.title, board_id: opts.board };
  if (opts.description) body.description = opts.description;
  if (opts.repo) body.repository_id = await resolveRepoId(client, opts.repo);
  if (opts.priority) body.priority = opts.priority;
  if (opts.labels) body.labels = opts.labels.split(",").map((l: string) => l.trim());
  if (opts.assignTo) body.assigned_to = opts.assignTo;
  if (opts.parent) body.created_from = opts.parent;
  if (opts.dependsOn) body.depends_on = opts.dependsOn.split(",").map((id: string) => id.trim());
  if (opts.input) {
    try {
      body.input = JSON.parse(opts.input);
    } catch {
      console.error("Invalid JSON for --input");
      process.exit(1);
    }
  }

  const task = await client.createTask(body);
  const fmt = getFormat(opts.format);
  output(task, fmt, (t) => `Created task ${t.id}: ${t.title}`);
}

async function createAgent(opts: Record<string, string>) {
  const client = await createClient();

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
}

async function createRepo(opts: Record<string, string>) {
  if (!opts.name) {
    console.error("--name is required for repo creation");
    process.exit(1);
  }
  if (!opts.url) {
    console.error("--url is required for repo creation");
    process.exit(1);
  }
  const client = await createClient();
  const repo = await client.createRepository({ name: opts.name, url: opts.url });
  const fmt = getFormat(opts.format);
  output(repo, fmt, (r) => `Added repository ${r.id}: ${r.name}`);
}

async function createNote(taskId: string, message: string) {
  if (!taskId) {
    console.error("--task is required for note creation");
    process.exit(1);
  }
  if (!message) {
    console.error("<message> is required for note creation");
    process.exit(1);
  }
  const client = await createClient();
  await client.addNote(taskId, message);
  console.log("Log entry added.");
}

export function registerCreateCommand(program: Command) {
  program
    .command("create <resource> [message]")
    .description("Create a resource (board, task, agent, repo, note)")
    .option("--name <name>", "Resource name (board, agent, repo)")
    .option("--description <desc>", "Description (board, task)")
    .option("--format <format>", "Output format (json, text)")
    // task flags
    .option("--board <id>", "Board ID (task)")
    .option("--title <title>", "Task title")
    .option("--repo <repo>", "Repository ID or URL (task)")
    .option("--priority <priority>", "Priority: low, medium, high, urgent (task)")
    .option("--labels <labels>", "Comma-separated labels (task)")
    .option("--input <json>", "JSON input payload (task)")
    .option("--assign-to <id>", "Agent ID to assign (task)")
    .option("--parent <id>", "Parent task ID (task)")
    .option("--depends-on <ids>", "Comma-separated dependency task IDs (task)")
    // agent flags
    .option("--template <slug>", "Agent template slug (agent)")
    .option("--bio <bio>", "Agent bio (agent)")
    .option("--role <role>", "Agent role (agent)")
    .option("--runtime <runtime>", "Agent runtime (agent)")
    .option("--model <model>", "Model to use (agent)")
    // repo flags
    .option("--url <url>", "Clone URL (repo)")
    // note flags
    .option("--task <id>", "Task ID (note)")
    .action(async (resource: string, message: string | undefined, opts) => {
      const name = normalizeResource(resource);

      switch (name) {
        case "board":
          return createBoard(opts);
        case "task":
          return createTask(opts);
        case "agent":
          return createAgent(opts);
        case "repo":
          return createRepo(opts);
        case "note":
          return createNote(opts.task, message || "");
      }
    });
}
