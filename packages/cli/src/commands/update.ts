import type { Command } from "commander";
import { createClient } from "../agent/leader.js";
import type { ApiClient } from "../client/index.js";
import { getOutputFormat, output } from "../output.js";

async function resolveRepoId(client: ApiClient, repoRef: string): Promise<string> {
  if (!repoRef.includes("://") && !repoRef.startsWith("git@")) return repoRef;
  const repos = await client.listRepositories({ url: repoRef });
  if (repos.length === 0) {
    console.error(`Repository not found for URL: ${repoRef}`);
    process.exit(1);
  }
  return repos[0].id;
}

async function resolveBoardId(client: ApiClient, nameOrId: string): Promise<string> {
  try {
    const board = (await client.getBoard(nameOrId)) as any;
    if (board?.id) return board.id;
  } catch {
    /* not a valid ID, try name lookup */
  }
  const boards = await client.listBoards();
  const match = boards.find((b: any) => b.name === nameOrId);
  if (!match) {
    console.error(`Board not found: ${nameOrId}`);
    process.exit(1);
  }
  return match.id;
}

export function registerUpdateCommand(program: Command) {
  const updateCmd = program.command("update").description("Update a resource");

  updateCmd
    .command("board <id>")
    .description("Update a board")
    .option("--name <name>", "New name")
    .option("--description <desc>", "New description")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const boardId = await resolveBoardId(client, id);
      const body: Record<string, unknown> = {};
      if (opts.name) body.name = opts.name;
      if (opts.description) body.description = opts.description;
      if (Object.keys(body).length === 0) {
        console.error("Nothing to update. Provide --name or --description.");
        process.exit(1);
      }
      const board = await client.updateBoard(boardId, body);
      const fmt = getOutputFormat(opts.output);
      output(board, fmt, (b) => `Updated board ${b.id}: ${b.name}`);
    });

  updateCmd
    .command("task <id>")
    .description("Update a task")
    .option("--title <title>", "New title")
    .option("--description <desc>", "New description")
    .option("--labels <labels>", "Comma-separated labels")
    .option("--input <json>", "JSON input payload")
    .option("--depends-on <ids>", "Comma-separated task IDs")
    .option("--repo <repo>", "Repository ID or URL")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const body: Record<string, unknown> = {};
      if (opts.title) body.title = opts.title;
      if (opts.description) body.description = opts.description;
      if (opts.labels) body.labels = opts.labels.split(",").map((l: string) => l.trim());
      if (opts.dependsOn) body.depends_on = opts.dependsOn.split(",").map((d: string) => d.trim());
      if (opts.repo) body.repository_id = await resolveRepoId(client, opts.repo);
      if (opts.input) {
        try {
          body.input = JSON.parse(opts.input);
        } catch {
          console.error("Invalid JSON for --input");
          process.exit(1);
        }
      }
      if (Object.keys(body).length === 0) {
        console.error("Nothing to update. Provide at least one option.");
        process.exit(1);
      }
      const task = await client.updateTask(id, body);
      const fmt = getOutputFormat(opts.output);
      output(task, fmt, (t) => `Updated task ${t.id}: ${t.title}`);
    });

  updateCmd
    .command("label")
    .description("Update a board label")
    .option("--board <id>", "Board ID")
    .option("--name <name>", "Current label name")
    .option("--new-name <name>", "New label name")
    .option("--color <hex>", "New label color, e.g. #22D3EE")
    .option("--description <desc>", "New label description")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (opts) => {
      if (!opts.board || !opts.name) {
        console.error("Missing required options: --board and --name");
        process.exit(1);
      }
      const client = await createClient();
      const body: Record<string, unknown> = {};
      if (opts.newName) body.name = opts.newName;
      if (opts.color) body.color = opts.color;
      if (opts.description) body.description = opts.description;
      if (Object.keys(body).length === 0) {
        console.error("Nothing to update. Provide --new-name, --color, or --description.");
        process.exit(1);
      }
      const board = await client.updateBoardLabel(opts.board, opts.name, body);
      const fmt = getOutputFormat(opts.output);
      output(board, fmt, (b) => `Updated label ${opts.name} on board ${b.id}`);
    });

  updateCmd
    .command("agent <id>")
    .description("Update an agent")
    .option("--name <name>", "Agent display name")
    .option("--bio <bio>", "Agent bio")
    .option("--soul <soul>", "Agent soul — persistent behavior instructions")
    .option("--role <role>", "Agent role")
    .option("--runtime <runtime>", "Agent runtime")
    .option("--model <model>", "Agent model")
    .option("--handoff-to <roles>", "Comma-separated agent roles this agent may hand off to")
    .option("--skills <skills>", "Comma-separated installable skill refs (<source>@<skill>)")
    .option("--subagents <ids>", "Comma-separated worker agent IDs to install as task-local subagents")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const body: Record<string, unknown> = {};
      if (opts.name) body.name = opts.name;
      if (opts.bio) body.bio = opts.bio;
      if (opts.soul) body.soul = opts.soul;
      if (opts.role) body.role = opts.role;
      if (opts.runtime) body.runtime = opts.runtime;
      if (opts.model) body.model = opts.model;
      if (opts.handoffTo) body.handoff_to = opts.handoffTo.split(",").map((s: string) => s.trim());
      if (opts.skills) body.skills = opts.skills.split(",").map((s: string) => s.trim());
      if (opts.subagents) body.subagents = opts.subagents.split(",").map((s: string) => s.trim());
      if (Object.keys(body).length === 0) {
        console.error(
          "Nothing to update. Provide at least one option (--name, --bio, --role, --runtime, --model, --handoff-to, --skills, --subagents).",
        );
        process.exit(1);
      }
      const agent = await client.updateAgent(id, body);
      const fmt = getOutputFormat(opts.output);
      output(agent, fmt, (a) => `Updated agent ${a.id}: ${a.name}`);
    });
}
