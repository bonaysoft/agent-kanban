import { fetchTemplate, isBoardType, parseScheduledAt } from "@agent-kanban/shared";
import type { Command } from "commander";
import { createClient } from "../agent/leader.js";
import type { ApiClient } from "../client/index.js";
import { getOutputFormat, output } from "../output.js";
import { getAvailableProviders } from "../providers/registry.js";

function detectRuntime(): string {
  const available = getAvailableProviders();
  if (available.length === 0) {
    console.error("No supported agent runtime found. Install a supported agent runtime, or pass --runtime explicitly.");
    process.exit(1);
  }
  return available[0].name;
}

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

export function registerCreateCommand(program: Command) {
  const createCmd = program.command("create").description("Create a resource");

  createCmd
    .command("board")
    .description("Create a board")
    .requiredOption("--name <name>", "Board name")
    .requiredOption("--type <type>", "Board type: dev, ops")
    .option("--description <desc>", "Board description")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (opts) => {
      if (!isBoardType(opts.type)) {
        console.error(`Unknown type "${opts.type}" — must be dev or ops`);
        process.exit(1);
      }
      const client = await createClient();
      const board = await client.createBoard({ name: opts.name, type: opts.type, description: opts.description });
      const fmt = getOutputFormat(opts.output);
      output(board, fmt, (b) => `Created board ${b.id}: ${b.name}`);
    });

  createCmd
    .command("task")
    .description("Create a task")
    .requiredOption("--board <id>", "Board ID")
    .requiredOption("--title <title>", "Task title")
    .option("--description <desc>", "Task description")
    .option("--repo <repo>", "Repository ID or URL")
    .option("--priority <priority>", "Priority: low, medium, high, urgent")
    .option("--labels <labels>", "Comma-separated labels")
    .option("--input <json>", "JSON input payload")
    .option("--assign-to <id>", "Agent ID to assign")
    .option("--parent <id>", "Parent task ID")
    .option("--depends-on <ids>", "Comma-separated dependency task IDs")
    .option("--scheduled-at <time>", "ISO 8601 time to schedule task")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (opts) => {
      const client = await createClient();
      const body: Record<string, unknown> = { title: opts.title, board_id: opts.board };
      if (opts.description) body.description = opts.description;
      if (opts.repo) body.repository_id = await resolveRepoId(client, opts.repo);
      if (opts.priority) body.priority = opts.priority;
      if (opts.labels) body.labels = opts.labels.split(",").map((l: string) => l.trim());
      if (opts.assignTo) body.assigned_to = opts.assignTo;
      if (opts.parent) body.created_from = opts.parent;
      if (opts.dependsOn) body.depends_on = opts.dependsOn.split(",").map((id: string) => id.trim());
      if (opts.scheduledAt) {
        const normalized = parseScheduledAt(opts.scheduledAt);
        if (!normalized) {
          console.error("--scheduled-at must be ISO 8601 with timezone (e.g. 2026-03-28T09:00:00Z)");
          process.exit(1);
        }
        body.scheduled_at = normalized;
      }
      if (opts.input) {
        try {
          body.input = JSON.parse(opts.input);
        } catch {
          console.error("Invalid JSON for --input");
          process.exit(1);
        }
      }
      const task = await client.createTask(body);
      const fmt = getOutputFormat(opts.output);
      output(task, fmt, (t) => `Created task ${t.id}: ${t.title}`);
    });

  createCmd
    .command("agent")
    .description("Create an agent")
    .option("--name <name>", "Agent display name")
    .option("--username <username>", "Agent username")
    .option("--template <slug>", "Agent template slug")
    .option("--bio <bio>", "Agent bio")
    .option("--soul <soul>", "Agent soul — persistent behavior instructions")
    .option("--role <role>", "Agent role")
    .option("--runtime <runtime>", "Agent runtime")
    .option("--model <model>", "Model to use")
    .option("--kind <kind>", "Agent kind: worker, leader")
    .option("--handoff-to <ids>", "Comma-separated agent IDs for handoff")
    .option("--skills <skills>", "Comma-separated skill slugs")
    .option("--subagents <ids>", "Comma-separated worker agent IDs to install as task-local subagents")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (opts) => {
      const client = await createClient();
      let body: Record<string, unknown>;

      if (opts.template) {
        const template = await fetchTemplate(opts.template);
        const runtime = opts.runtime || template.runtime;
        if (!runtime) {
          console.error("Template has no runtime. Pass --runtime explicitly.");
          process.exit(1);
        }
        const username = opts.username || template.username;
        if (!username) {
          console.error("--username is required (template has no default username)");
          process.exit(1);
        }
        body = {
          name: opts.name || template.name || username,
          username,
          bio: opts.bio || template.bio,
          soul: opts.soul || template.soul,
          role: opts.role || template.role,
          kind: opts.kind,
          handoff_to: opts.handoffTo ? opts.handoffTo.split(",").map((s: string) => s.trim()) : template.handoff_to,
          runtime,
          model: opts.model || template.model,
          skills: opts.skills ? opts.skills.split(",").map((s: string) => s.trim()) : template.skills,
          subagents: opts.subagents ? opts.subagents.split(",").map((s: string) => s.trim()) : undefined,
        };
      } else {
        if (!opts.username) {
          console.error("--username is required");
          process.exit(1);
        }
        const runtime = opts.runtime || detectRuntime();
        body = { name: opts.name || opts.username, username: opts.username, runtime };
        if (opts.bio) body.bio = opts.bio;
        if (opts.soul) body.soul = opts.soul;
        if (opts.role) body.role = opts.role;
        if (opts.kind) body.kind = opts.kind;
        if (opts.handoffTo) body.handoff_to = opts.handoffTo.split(",").map((s: string) => s.trim());
        if (opts.model) body.model = opts.model;
        if (opts.skills) body.skills = opts.skills.split(",").map((s: string) => s.trim());
        if (opts.subagents) body.subagents = opts.subagents.split(",").map((s: string) => s.trim());
      }

      const agent = await client.createAgent(body as any);
      const fmt = getOutputFormat(opts.output);
      output(agent, fmt, (a) => `Created agent ${a.id}: ${a.name} (${a.role || "no role"})`);
    });

  createCmd
    .command("repo")
    .description("Create a repository")
    .requiredOption("--name <name>", "Repository name")
    .requiredOption("--url <url>", "Clone URL")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (opts) => {
      const client = await createClient();
      const repo = await client.createRepository({ name: opts.name, url: opts.url });
      const fmt = getOutputFormat(opts.output);
      output(repo, fmt, (r) => `Added repository ${r.id}: ${r.name}`);
    });

  createCmd
    .command("note <message>")
    .description("Add a log note to a task")
    .requiredOption("--task <id>", "Task ID")
    .action(async (message, opts) => {
      const client = await createClient();
      await client.addNote(opts.task, message);
      console.log("Log entry added.");
    });
}
