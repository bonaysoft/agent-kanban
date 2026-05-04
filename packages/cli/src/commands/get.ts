import type { Command } from "commander";
import { createClient } from "../agent/leader.js";
import {
  formatAgent,
  formatAgentList,
  formatBoard,
  formatBoardList,
  formatRepository,
  formatRepositoryList,
  formatTask,
  formatTaskList,
  formatTaskListWide,
  formatTaskNotes,
  getOutputFormat,
  output,
} from "../output.js";

type AgentRef = {
  id: string;
  username: string;
  version: string;
  name: string;
  created_at?: string;
};

function sortAgentVersions(agents: AgentRef[]): AgentRef[] {
  return [...agents].sort((a, b) => {
    if (a.version === "latest") return -1;
    if (b.version === "latest") return 1;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "") || a.version.localeCompare(b.version);
  });
}

function formatAgentVersions(data: { username: string; versions: AgentRef[] }): string {
  if (data.versions.length === 0) return `No versions found for ${data.username}.`;
  const lines = [`${data.username}`];
  for (const agent of sortAgentVersions(data.versions)) {
    const version = agent.version.padEnd(8);
    const created = agent.created_at ? new Date(agent.created_at).toISOString().slice(0, 10) : "";
    lines.push(`  ${version} ${agent.id}  ${created}  ${agent.name}`);
  }
  return lines.join("\n");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

async function getAgentOrVersions(client: any, id: string): Promise<{ value: any; formatter: (value: any) => string }> {
  try {
    return { value: await client.getAgent(id), formatter: formatAgent };
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  const agents = (await client.listAgents()) as AgentRef[];
  const versions = sortAgentVersions(agents.filter((agent) => agent.username === id));
  if (versions.length === 0) {
    console.error(`Agent not found: ${id}`);
    process.exit(1);
  }
  return { value: { username: id, versions }, formatter: formatAgentVersions };
}

export function registerGetCommand(program: Command) {
  const getCmd = program.command("get").description("Get a resource or list resources");

  getCmd
    .command("board [id]")
    .description("Get a board or list boards")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (id: string | undefined, opts) => {
      const client = await createClient();
      const fmt = getOutputFormat(opts.output);
      if (id) {
        const board = await client.getBoard(id);
        output(board, fmt, formatBoard, { kind: "board" });
      } else {
        const boards = await client.listBoards();
        output(boards, fmt, formatBoardList, { kind: "board" });
      }
    });

  getCmd
    .command("task [id]")
    .description("Get a task or list tasks")
    .option("-o, --output <format>", "Output format (json, yaml, wide, text)")
    .option("--board <id>", "Board ID (required when listing)")
    .option("--status <status>", "Filter by status")
    .option("--label <label>", "Filter by label")
    .option("--repo <id>", "Filter by repository ID")
    .action(async (id: string | undefined, opts) => {
      const client = await createClient();
      const fmt = getOutputFormat(opts.output);
      if (id) {
        const task = await client.getTask(id);
        output(task, fmt, formatTask, { kind: "task" });
      } else {
        if (!opts.board) {
          console.error("Error: --board is required when listing tasks\nUsage: ak get task --board <id>");
          process.exit(1);
        }
        const params: Record<string, string> = { board_id: opts.board };
        if (opts.status) params.status = opts.status;
        if (opts.label) params.label = opts.label;
        if (opts.repo) params.repository_id = opts.repo;
        const tasks = await client.listTasks(params);
        output(tasks, fmt, formatTaskList, { wideFormatter: formatTaskListWide, kind: "task" });
      }
    });

  getCmd
    .command("agent [id]")
    .description("Get an agent or list agents")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (id: string | undefined, opts) => {
      const client = await createClient();
      const fmt = getOutputFormat(opts.output);
      if (id) {
        const { value, formatter } = await getAgentOrVersions(client, id);
        output(value, fmt, formatter, { kind: "agent" });
      } else {
        const all = (await client.listAgents()) as any[];
        const agents = all.filter((a: any) => a.kind !== "leader");
        output(agents, fmt, formatAgentList, { kind: "agent" });
      }
    });

  getCmd
    .command("repo [id]")
    .description("Get a repository or list repositories")
    .option("-o, --output <format>", "Output format (json, yaml, text)")
    .action(async (id: string | undefined, opts) => {
      const client = await createClient();
      const fmt = getOutputFormat(opts.output);
      if (id) {
        const repo = await client.getRepository(id);
        output(repo, fmt, formatRepository, { kind: "repo" });
      } else {
        const repos = await client.listRepositories();
        output(repos, fmt, formatRepositoryList, { kind: "repo" });
      }
    });

  getCmd
    .command("note [task-id]")
    .description("Get notes for a task")
    .option("-o, --output <format>", "Output format (json, text)")
    .option("--task <id>", "Task ID")
    .option("--since <timestamp>", "Only show notes after this timestamp")
    .action(async (taskId: string | undefined, opts) => {
      const client = await createClient();
      const fmt = getOutputFormat(opts.output);
      const id = taskId ?? opts.task;
      if (!id) {
        console.error("Usage: ak get note <task-id>  or  ak get note --task <task-id>");
        process.exit(1);
      }
      const notes = await client.getTaskNotes(id, opts.since);
      output(notes, fmt, formatTaskNotes);
    });
}
