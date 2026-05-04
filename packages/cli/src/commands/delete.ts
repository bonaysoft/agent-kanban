import type { Command } from "commander";
import { createClient } from "../agent/leader.js";
import { getOutputFormat, output } from "../output.js";

export function registerDeleteCommand(program: Command) {
  const deleteCmd = program.command("delete").description("Delete a resource (board, task, agent, repo)");

  deleteCmd
    .command("label")
    .description("Delete a board label")
    .option("--board <id>", "Board ID")
    .option("--name <name>", "Label name")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (opts) => {
      if (!opts.board || !opts.name) {
        console.error("Missing required options: --board and --name");
        process.exit(1);
      }
      const client = await createClient();
      const board = await client.deleteBoardLabel(opts.board, opts.name);
      const fmt = getOutputFormat(opts.output);
      output(board, fmt, (b) => `Deleted label ${opts.name} from board ${b.id}`);
    });

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
