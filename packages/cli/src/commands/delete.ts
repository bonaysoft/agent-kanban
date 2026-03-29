import type { Command } from "commander";
import { createClient } from "../client.js";
import { getOutputFormat, output } from "../output.js";

export function registerDeleteCommand(program: Command) {
  const deleteCmd = program.command("delete").description("Delete a resource (board, task, agent, repo)");

  deleteCmd
    .command("board <id>")
    .description("Delete a board")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getOutputFormat(opts.output);
      const board = await client.deleteBoard(id);
      output(board, fmt, () => `Deleted board ${id}`);
    });

  deleteCmd
    .command("task <id>")
    .description("Delete a task")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getOutputFormat(opts.output);
      const task = await client.deleteTask(id);
      output(task, fmt, () => `Deleted task ${id}`);
    });

  deleteCmd
    .command("agent <id>")
    .description("Delete an agent")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getOutputFormat(opts.output);
      const agent = await client.deleteAgent(id);
      output(agent, fmt, () => `Deleted agent ${id}`);
    });

  deleteCmd
    .command("repo <id>")
    .description("Delete a repository")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getOutputFormat(opts.output);
      const repo = await client.deleteRepository(id);
      output(repo, fmt, () => `Deleted repository ${id}`);
    });
}
