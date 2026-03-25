import type { Command } from "commander";
import { createClient } from "../client.js";
import { getFormat, output } from "../output.js";
import { normalizeResource } from "./resources.js";

export function registerDeleteCommand(program: Command) {
  program
    .command("delete <resource> <id>")
    .description("Delete a resource (board, task, agent, repo)")
    .option("--format <format>", "Output format (json, text)")
    .action(async (resource: string, id: string, opts) => {
      const name = normalizeResource(resource);
      const client = await createClient();
      const fmt = getFormat(opts.format);

      switch (name) {
        case "board": {
          const board = await client.deleteBoard(id);
          output(board, fmt, () => `Deleted board ${id}`);
          break;
        }
        case "task": {
          const task = await client.deleteTask(id);
          output(task, fmt, () => `Deleted task ${id}`);
          break;
        }
        case "agent": {
          const agent = await client.deleteAgent(id);
          output(agent, fmt, () => `Deleted agent ${id}`);
          break;
        }
        case "repo": {
          const repo = await client.deleteRepository(id);
          output(repo, fmt, () => `Deleted repository ${id}`);
          break;
        }
        default:
          console.error(`Delete is not supported for resource: ${name}`);
          process.exit(1);
      }
    });
}
