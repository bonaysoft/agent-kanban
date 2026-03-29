import type { Command } from "commander";
import { createClient } from "../client.js";
import {
  formatAgent,
  formatAgentList,
  formatBoard,
  formatBoardList,
  formatRepository,
  formatRepositoryList,
  formatTask,
  formatTaskList,
  formatTaskNotes,
  getFormat,
  output,
} from "../output.js";

export function registerGetCommand(program: Command) {
  const getCmd = program.command("get").description("Get a resource or list resources");

  getCmd
    .command("board [id]")
    .description("Get a board or list boards")
    .option("--format <format>", "Output format (json, text)")
    .action(async (id: string | undefined, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      if (id) {
        const board = await client.getBoard(id);
        output(board, fmt, formatBoard);
      } else {
        const boards = await client.listBoards();
        output(boards, fmt, formatBoardList);
      }
    });

  getCmd
    .command("task [id]")
    .description("Get a task or list tasks")
    .option("--format <format>", "Output format (json, text)")
    .option("--board <id>", "Filter by board ID")
    .option("--status <status>", "Filter by status")
    .option("--label <label>", "Filter by label")
    .option("--repo <id>", "Filter by repository ID")
    .action(async (id: string | undefined, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      if (id) {
        const task = await client.getTask(id);
        output(task, fmt, formatTask);
      } else {
        const params: Record<string, string> = {};
        if (opts.board) params.board_id = opts.board;
        if (opts.status) params.status = opts.status;
        if (opts.label) params.label = opts.label;
        if (opts.repo) params.repository_id = opts.repo;
        const tasks = await client.listTasks(params);
        output(tasks, fmt, formatTaskList);
      }
    });

  getCmd
    .command("agent [id]")
    .description("Get an agent or list agents")
    .option("--format <format>", "Output format (json, text)")
    .action(async (id: string | undefined, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      if (id) {
        const agent = await client.getAgent(id);
        output(agent, fmt, formatAgent);
      } else {
        const agents = await client.listAgents();
        output(agents, fmt, formatAgentList);
      }
    });

  getCmd
    .command("repo [id]")
    .description("Get a repository or list repositories")
    .option("--format <format>", "Output format (json, text)")
    .action(async (id: string | undefined, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      if (id) {
        const repo = await client.getRepository(id);
        output(repo, fmt, formatRepository);
      } else {
        const repos = await client.listRepositories();
        output(repos, fmt, formatRepositoryList);
      }
    });

  getCmd
    .command("note [task-id]")
    .description("Get notes for a task")
    .option("--format <format>", "Output format (json, text)")
    .option("--task <id>", "Task ID")
    .option("--since <timestamp>", "Only show notes after this timestamp")
    .action(async (taskId: string | undefined, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      const id = taskId ?? opts.task;
      if (!id) {
        console.error("Usage: ak get note <task-id>  or  ak get note --task <task-id>");
        process.exit(1);
      }
      const notes = await client.getTaskNotes(id, opts.since);
      output(notes, fmt, formatTaskNotes);
    });
}
