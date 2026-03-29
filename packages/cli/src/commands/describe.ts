import type { Command } from "commander";
import { createClient } from "../client.js";
import { getFormat, output } from "../output.js";

function pad(label: string): string {
  return `${label}:`.padEnd(14);
}

function formatDescribeTask(task: any, notes: any[], messages: any[]): string {
  const lines: string[] = [];

  lines.push(`${pad("Name")} ${task.title}`);
  lines.push(`${pad("ID")} ${task.id}`);
  lines.push(`${pad("Status")} ${task.status}`);
  lines.push(`${pad("Priority")} ${task.priority || "none"}`);
  if (task.board_id) lines.push(`${pad("Board")} ${task.board_id}`);
  if (task.repository_name) lines.push(`${pad("Repo")} ${task.repository_name}`);
  if (task.assigned_to) lines.push(`${pad("Agent")} ${task.assigned_to}`);
  if (task.labels?.length) lines.push(`${pad("Labels")} ${task.labels.join(", ")}`);
  if (task.created_at) lines.push(`${pad("Created")} ${task.created_at}`);
  if (task.depends_on?.length) {
    lines.push(`${pad("Dependencies")} ${task.depends_on.join(", ")}`);
  }
  lines.push(`${pad("Blocked")} ${task.blocked ? "true" : "false"}`);
  if (task.pr_url) lines.push(`${pad("PR")} ${task.pr_url}`);
  if (task.description) {
    lines.push("");
    lines.push("Description:");
    lines.push(`  ${task.description}`);
  }

  if (notes.length > 0) {
    lines.push("");
    lines.push("Logs:");
    for (const n of notes) {
      const time = n.created_at;
      const detail = n.detail || n.action || "";
      lines.push(`  ${time}  ${detail}`);
    }
  }

  if (messages.length > 0) {
    lines.push("");
    lines.push("Messages:");
    for (const m of messages) {
      const time = m.created_at;
      const sender = m.sender_type === "agent" ? `[agent:${m.sender_id?.slice(0, 8)}]` : "[human]";
      lines.push(`  ${time}  ${sender}  ${m.content}`);
    }
  }

  return lines.join("\n");
}

function formatDescribeAgent(agent: any, sessions: any[]): string {
  const lines: string[] = [];

  lines.push(`${pad("Name")} ${agent.name}`);
  lines.push(`${pad("ID")} ${agent.id}`);
  lines.push(`${pad("Status")} ${agent.status}`);
  if (agent.role) lines.push(`${pad("Role")} ${agent.role}`);
  if (agent.bio) lines.push(`${pad("Bio")} ${agent.bio}`);
  lines.push(`${pad("Runtime")} ${agent.runtime}`);
  if (agent.model) lines.push(`${pad("Model")} ${agent.model}`);
  if (agent.fingerprint) lines.push(`${pad("Fingerprint")} ${agent.fingerprint}`);
  if (agent.skills?.length) lines.push(`${pad("Skills")} ${agent.skills.join(", ")}`);
  if (agent.handoff_to?.length) lines.push(`${pad("Handoff")} ${agent.handoff_to.join(", ")}`);
  if (agent.task_count != null) lines.push(`${pad("Task count")} ${agent.task_count}`);
  if (agent.last_active_at) lines.push(`${pad("Last active")} ${agent.last_active_at}`);

  if (sessions.length > 0) {
    lines.push("");
    lines.push("Sessions:");
    for (const s of sessions) {
      const status = s.closed_at ? "closed" : "open";
      lines.push(`  ${s.id}  [${status}]  started: ${s.started_at}`);
    }
  }

  return lines.join("\n");
}

function formatDescribeBoard(board: any): string {
  const columnOrder = ["todo", "in_progress", "in_review", "done", "cancelled"];
  const columnLabels: Record<string, string> = {
    todo: "Todo",
    in_progress: "In Progress",
    in_review: "In Review",
    done: "Done",
    cancelled: "Cancelled",
  };

  const tasks: any[] = board.tasks || [];
  const grouped: Record<string, any[]> = {};
  for (const col of columnOrder) grouped[col] = [];
  for (const t of tasks) {
    if (grouped[t.status]) grouped[t.status].push(t);
  }

  const counts = columnOrder.map((k) => `${columnLabels[k]}: ${grouped[k].length}`).join("  ");
  const lines: string[] = [];

  lines.push(`${pad("Name")} ${board.name}`);
  lines.push(`${pad("ID")} ${board.id}`);
  if (board.type) lines.push(`${pad("Type")} ${board.type}`);
  if (board.description) lines.push(`${pad("Description")} ${board.description}`);
  lines.push(`${pad("Tasks")} ${tasks.length} total  (${counts})`);

  for (const key of columnOrder) {
    const col = grouped[key];
    if (col.length === 0) continue;
    lines.push("");
    lines.push(`${columnLabels[key]} (${col.length}):`);
    for (const t of col) {
      const agent = t.assigned_to ? ` → ${t.assigned_to.slice(0, 8)}` : "";
      const blocked = t.blocked ? " BLOCKED" : "";
      const pr = t.pr_url ? ` PR: ${t.pr_url}` : "";
      const priority = t.priority ? ` [${t.priority}]` : "";
      lines.push(`  ${t.id}  ${t.title}${priority}${blocked}${agent}${pr}`);
    }
  }

  return lines.join("\n");
}

export function registerDescribeCommand(program: Command) {
  const describeCmd = program.command("describe").description("Show detailed view of a resource");

  describeCmd
    .command("task <id>")
    .description("Show full detail for a task: logs, messages")
    .option("--format <format>", "Output format (json, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      const [task, notes, messages] = await Promise.all([client.getTask(id), client.getTaskNotes(id), client.getMessages(id)]);
      if (fmt === "json") {
        output({ task, notes, messages }, fmt);
      } else {
        console.log(formatDescribeTask(task, notes as any[], messages as any[]));
      }
    });

  describeCmd
    .command("agent <id>")
    .description("Show full detail for an agent: sessions, task history")
    .option("--format <format>", "Output format (json, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      const [agent, sessions] = await Promise.all([client.getAgent(id), client.listSessions(id)]);
      if (fmt === "json") {
        output({ agent, sessions }, fmt);
      } else {
        console.log(formatDescribeAgent(agent, sessions));
      }
    });

  describeCmd
    .command("board <id>")
    .description("Show full detail for a board: all tasks with status counts")
    .option("--format <format>", "Output format (json, text)")
    .action(async (id: string, opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      const board = await client.getBoard(id);
      if (fmt === "json") {
        output(board, fmt);
      } else {
        console.log(formatDescribeBoard(board));
      }
    });
}
