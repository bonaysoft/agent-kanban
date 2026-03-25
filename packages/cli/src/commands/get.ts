import type { Command } from "commander";
import { createClient } from "../client.js";
import {
  formatAgent,
  formatAgentList,
  formatBoard,
  formatBoardList,
  formatRepositoryList,
  formatTask,
  formatTaskList,
  getFormat,
  output,
} from "../output.js";
import { normalizeResource } from "./resources.js";

export function registerGetCommand(program: Command) {
  program
    .command("get <resource> [id]")
    .description("Get a resource or list resources")
    .option("--format <format>", "Output format (json, text)")
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
            const tasks = await client.listTasks({});
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
            console.error("ak get repo <id> is not implemented yet.");
            process.exit(1);
          } else {
            const repos = await client.listRepositories();
            output(repos, fmt, formatRepositoryList);
          }
          break;
        case "note":
          console.error("ak get note is not implemented yet.");
          process.exit(1);
          break;
      }
    });
}
