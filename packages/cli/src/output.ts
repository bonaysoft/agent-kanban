export function getFormat(explicit?: string): "json" | "text" {
  if (explicit === "json") return "json";
  return "text";
}

export function output(data: unknown, format: "json" | "text", textFormatter?: (data: any) => string): void {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
  } else if (textFormatter) {
    console.log(textFormatter(data));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

export function formatTaskList(tasks: any[]): string {
  if (tasks.length === 0) return "No tasks found.";

  const lines = tasks.map((t) => {
    const status = `[${t.status}]`.padEnd(14);
    const priority = t.priority ? `[${t.priority}]` : "";
    const blocked = t.blocked ? " BLOCKED" : "";
    const repo = t.repository_name ? `(${t.repository_name})` : "";
    const agent = t.assigned_to ? `→ ${t.assigned_to.slice(0, 8)}` : "";
    const pr = t.pr_url ? `PR: ${t.pr_url}` : "";
    return `  ${t.id}  ${status} ${priority.padEnd(8)} ${t.title} ${blocked} ${repo} ${agent} ${pr}`.trimEnd();
  });

  return lines.join("\n");
}

export function formatAgentList(agents: any[]): string {
  if (agents.length === 0) return "No agents found.";

  const lines = agents.map((a) => {
    const status = `[${a.status}]`.padEnd(10);
    const tasks = `${a.task_count} tasks`;
    const lastActive = a.last_active_at ? `last: ${a.last_active_at}` : "never active";
    return `  ${a.id}  ${status} ${a.name} — ${tasks}, ${lastActive}`;
  });

  return lines.join("\n");
}

export function formatBoardList(boards: any[]): string {
  if (boards.length === 0) return "No boards found.";

  const lines = boards.map((b) => {
    const desc = b.description ? ` — ${b.description}` : "";
    return `  ${b.id}  ${b.name}${desc}`;
  });

  return lines.join("\n");
}

export function formatRepository(repo: any): string {
  const lines: string[] = [];
  lines.push(`${repo.name}`);
  lines.push(`  ID:   ${repo.id}`);
  lines.push(`  URL:  ${repo.url}`);
  if (repo.created_at) lines.push(`  Created: ${repo.created_at}`);
  return lines.join("\n");
}

export function formatRepositoryList(repos: any[]): string {
  if (repos.length === 0) return "No repositories found.";

  const lines = repos.map((r) => {
    return `  ${r.id}  ${r.name}  ${r.url}`;
  });

  return lines.join("\n");
}

export function formatTask(task: any): string {
  const lines: string[] = [];
  lines.push(`${task.title}`);
  lines.push(`  ID:          ${task.id}`);
  lines.push(`  Status:      ${task.status}${task.blocked ? " (BLOCKED)" : ""}`);
  lines.push(`  Priority:    ${task.priority || "none"}`);
  if (task.labels?.length) lines.push(`  Labels:      ${task.labels.join(", ")}`);
  if (task.assigned_to) lines.push(`  Assigned to: ${task.assigned_to}`);
  if (task.repository_name) lines.push(`  Repository:  ${task.repository_name}`);
  if (task.depends_on?.length) lines.push(`  Depends on:  ${task.depends_on.join(", ")}`);
  if (task.pr_url) lines.push(`  PR:          ${task.pr_url}`);
  if (task.description) lines.push(`\n  ${task.description}`);
  if (task.input) lines.push(`\n  Input: ${JSON.stringify(task.input)}`);
  if (task.result) lines.push(`  Result: ${task.result}`);
  return lines.join("\n");
}

export function formatTaskNotes(notes: any[]): string {
  if (notes.length === 0) return "No notes.";
  return notes
    .map((l) => {
      const time = new Date(l.created_at).toLocaleString();
      const actor = l.actor_id ? ` [${l.actor_id}]` : "";
      return `  ${time}  ${l.action.padEnd(18)}${actor}  ${l.detail || ""}`;
    })
    .join("\n");
}

export function formatAgent(agent: any): string {
  const lines: string[] = [];
  lines.push(`${agent.name}`);
  lines.push(`  ID:       ${agent.id}`);
  lines.push(`  Status:   ${agent.status}`);
  if (agent.role) lines.push(`  Role:     ${agent.role}`);
  if (agent.bio) lines.push(`  Bio:      ${agent.bio}`);
  if (agent.runtime) lines.push(`  Runtime:  ${agent.runtime}`);
  if (agent.model) lines.push(`  Model:    ${agent.model}`);
  if (agent.skills?.length) lines.push(`  Skills:   ${agent.skills.join(", ")}`);
  if (agent.handoff_to?.length) lines.push(`  Handoff:  ${agent.handoff_to.join(", ")}`);
  if (agent.task_count != null) lines.push(`  Tasks:    ${agent.task_count}`);
  return lines.join("\n");
}

export function formatBoard(board: any): string {
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

  const lines: string[] = [`Board: ${board.name} (${tasks.length} tasks)`];
  for (const key of columnOrder) {
    const col = grouped[key];
    if (col.length === 0) continue;
    lines.push(`\n${columnLabels[key]} (${col.length}):`);
    for (const t of col) {
      const agent = t.assigned_to ? ` → ${t.assigned_to.slice(0, 8)}` : "";
      const blocked = t.blocked ? " BLOCKED" : "";
      const pr = t.pr_url ? ` PR: ${t.pr_url}` : "";
      lines.push(`  ${t.id}  ${t.title}${blocked}${agent}${pr}`);
    }
  }

  return lines.join("\n");
}
