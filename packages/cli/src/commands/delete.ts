import type { Command } from "commander";
import { createClient } from "../client.js";
import { getFormat, output } from "../output.js";

export function registerDeleteCommand(program: Command) {
  const deleteCmd = program.command("delete").description("Delete a resource (board, task, agent, repo)");

  deleteCmd
    .command("board <id>")
    .description("Delete a board")
    .option("--format <format>", "Output format (json, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      const board = await client.deleteBoard(id);
      output(board, fmt, () => `Deleted board ${id}`);
    });

  deleteCmd
    .command("task <id>")
    .description("Delete a task")
    .option("--format <format>", "Output format (json, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      const task = await client.deleteTask(id);
      output(task, fmt, () => `Deleted task ${id}`);
    });

  deleteCmd
    .command("agent <id>")
    .description("Delete an agent")
    .option("--format <format>", "Output format (json, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      const agent = await client.deleteAgent(id);
      output(agent, fmt, () => `Deleted agent ${id}`);
    });

  deleteCmd
    .command("repo <id>")
    .description("Delete a repository")
    .option("--format <format>", "Output format (json, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      const repo = await client.deleteRepository(id);
      output(repo, fmt, () => `Deleted repository ${id}`);
    });
}
