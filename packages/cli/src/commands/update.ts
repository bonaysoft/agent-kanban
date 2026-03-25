import type { Command } from "commander";
import { type ApiClient, createClient } from "../client.js";
import { getFormat, output } from "../output.js";
import { normalizeResource } from "./resources.js";

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
  program
    .command("update <resource> <id>")
    .description("Update a resource (board, task, agent)")
    .option("--format <format>", "Output format (json, text)")
    // Board options
    .option("--name <name>", "New name")
    .option("--description <desc>", "New description")
    // Task options
    .option("--title <title>", "New title (task)")
    .option("--priority <priority>", "New priority (task: low, medium, high, urgent)")
    .option("--labels <labels>", "Comma-separated labels (task)")
    .option("--input <json>", "JSON input payload (task)")
    .option("--depends-on <ids>", "Comma-separated task IDs (task)")
    .option("--repo <repo>", "Repository ID or URL (task)")
    // Agent options
    .option("--bio <bio>", "Agent bio")
    .option("--role <role>", "Agent role")
    .option("--runtime <runtime>", "Agent runtime")
    .option("--model <model>", "Agent model")
    .action(async (resource: string, id: string, opts) => {
      const name = normalizeResource(resource);
      const client = await createClient();
      const fmt = getFormat(opts.format);

      switch (name) {
        case "board": {
          const boardId = await resolveBoardId(client, id);
          const body: Record<string, unknown> = {};
          if (opts.name) body.name = opts.name;
          if (opts.description) body.description = opts.description;
          if (Object.keys(body).length === 0) {
            console.error("Nothing to update. Provide --name or --description.");
            process.exit(1);
          }
          const board = await client.updateBoard(boardId, body);
          output(board, fmt, (b) => `Updated board ${b.id}: ${b.name}`);
          break;
        }
        case "task": {
          const body: Record<string, unknown> = {};
          if (opts.title) body.title = opts.title;
          if (opts.description) body.description = opts.description;
          if (opts.priority) body.priority = opts.priority;
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
          output(task, fmt, (t) => `Updated task ${t.id}: ${t.title}`);
          break;
        }
        case "agent": {
          const body: Record<string, unknown> = {};
          if (opts.name) body.name = opts.name;
          if (opts.bio) body.bio = opts.bio;
          if (opts.role) body.role = opts.role;
          if (opts.runtime) body.runtime = opts.runtime;
          if (opts.model) body.model = opts.model;
          if (Object.keys(body).length === 0) {
            console.error("Nothing to update. Provide at least one option (--name, --bio, --role, --runtime, --model).");
            process.exit(1);
          }
          const agent = await client.updateAgent(id, body);
          output(agent, fmt, (a) => `Updated agent ${a.id}: ${a.name}`);
          break;
        }
        default:
          console.error(`Update is not supported for resource: ${name}`);
          process.exit(1);
      }
    });
}
