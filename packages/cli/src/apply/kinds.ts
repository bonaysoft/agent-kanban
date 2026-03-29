import type { ApiClient } from "../client.js";
import { type OutputFormat, output } from "../output.js";

function isUrl(value: string): boolean {
  return value.includes("://") || value.startsWith("git@");
}

async function resolveRepoField(client: ApiClient, spec: Record<string, unknown>): Promise<void> {
  const repo = spec.repo as string | undefined;
  if (!repo) return;
  delete spec.repo;
  if (isUrl(repo)) {
    const repos = await client.listRepositories({ url: repo });
    if (repos.length === 0) {
      console.error(`Repository not found for URL: ${repo}`);
      process.exit(1);
    }
    spec.repository_id = repos[0].id;
  } else {
    spec.repository_id = repo;
  }
}

export async function applyResource(client: ApiClient, kind: string, spec: Record<string, unknown>, fmt: OutputFormat): Promise<void> {
  const id = spec.id as string | undefined;

  switch (kind.toLowerCase()) {
    case "task": {
      await resolveRepoField(client, spec);
      if (id) {
        const { id: _, ...body } = spec;
        const task = (await client.updateTask(id, body)) as any;
        output(task, fmt, (t) => `Updated task ${t.id}: ${t.title}`, { kind: "task" });
      } else {
        const task = (await client.createTask(spec)) as any;
        output(task, fmt, (t) => `Created task ${t.id}: ${t.title}`, { kind: "task" });
      }
      break;
    }
    case "board": {
      if (id) {
        const { id: _, ...body } = spec;
        const board = (await client.updateBoard(id, body)) as any;
        output(board, fmt, (b) => `Updated board ${b.id}: ${b.name}`, { kind: "board" });
      } else {
        const board = (await client.createBoard(spec as any)) as any;
        output(board, fmt, (b) => `Created board ${b.id}: ${b.name}`, { kind: "board" });
      }
      break;
    }
    case "agent": {
      if (id) {
        const { id: _, ...body } = spec;
        const agent = (await client.updateAgent(id, body)) as any;
        output(agent, fmt, (a) => `Updated agent ${a.id}: ${a.name}`, { kind: "agent" });
      } else {
        const agent = (await client.createAgent(spec as any)) as any;
        output(agent, fmt, (a) => `Created agent ${a.id}: ${a.name} (${a.role || "no role"})`, { kind: "agent" });
      }
      break;
    }
    case "repo": {
      const repo = (await client.createRepository(spec as any)) as any;
      output(repo, fmt, (r) => `Added repository ${r.id}: ${r.name}`, { kind: "repo" });
      break;
    }
    default:
      console.error(`Unknown kind: ${kind}. Supported: Task, Board, Agent, Repo`);
      process.exit(1);
  }
}
