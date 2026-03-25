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
  formatTaskLogs,
  getFormat,
  output,
} from "../output.js";
import { normalizeResource } from "./resources.js";

export function registerGetCommand(program: Command) {
  program
    .command("get <resource> [id]")
    .description("Get a resource or list resources")
    .option("--format <format>", "Output format (json, text)")
    .option("--board <id>", "Filter tasks by board ID")
    .option("--status <status>", "Filter tasks by status")
    .option("--label <label>", "Filter tasks by label")
    .option("--repo <id>", "Filter tasks by repository ID")
    .option("--task <id>", "Task ID (required for notes)")
    .option("--since <timestamp>", "Only show notes after this timestamp")
    .action(async (resource: string, id: string | undefined, opts) => {
      const name = normalizeResource(resource);
      const client = await createClient();
      const fmt = getFormat(opts.format);

      switch (name) {
        case "board":
          if (id) {
            const board = await client.getBoard(id);
            output(board, fmt, formatBoard);
          } else {
            const boards = await client.listBoards();
            output(boards, fmt, formatBoardList);
          }
          break;
        case "task":
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
          break;
        case "agent":
          if (id) {
            const agent = await client.getAgent(id);
            output(agent, fmt, formatAgent);
          } else {
            const agents = await client.listAgents();
            output(agents, fmt, formatAgentList);
          }
          break;
        case "repo":
          if (id) {
            const repo = await client.getRepository(id);
            output(repo, fmt, formatRepository);
          } else {
            const repos = await client.listRepositories();
            output(repos, fmt, formatRepositoryList);
          }
          break;
        case "note": {
          const taskId = id ? undefined : opts.task;
          const noteTaskId = id ?? opts.task;
          if (!noteTaskId) {
            console.error("Usage: ak get note --task <task-id> or ak get note <task-id>");
            process.exit(1);
          }
          const logs = await client.getTaskLogs(noteTaskId, opts.since);
          output(logs, fmt, formatTaskLogs);
          break;
        }
      }
    });
}
