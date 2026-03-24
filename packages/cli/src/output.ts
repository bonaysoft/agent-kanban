const isTTY = process.stdout.isTTY;

export function getFormat(explicit?: string): "json" | "text" {
  if (explicit === "json") return "json";
  if (explicit === "text") return "text";
  return isTTY ? "text" : "json";
}

export function output(
  data: unknown,
  format: "json" | "text",
  textFormatter?: (data: any) => string,
): void {
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
    const priority = t.priority ? `[${t.priority}]` : "";
    const repo = t.repository_name ? `(${t.repository_name})` : "";
    const agent = t.assigned_to ? `→ ${t.assigned_to}` : "";
    return `  ${t.id}  ${priority.padEnd(8)} ${t.title} ${repo} ${agent}`;
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

export function formatTaskLogs(logs: any[]): string {
  if (logs.length === 0) return "No logs.";
  return logs
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
  const cols = board.columns || [];
  const maxWidth = 30;

  const header = `${cols.map((c: any) => `│ ${(`${c.name} (${c.tasks.length})`).padEnd(maxWidth)} `).join("")}│`;

  const sep = `${cols.map(() => `├${"─".repeat(maxWidth + 2)}`).join("")}┤`;
  const topSep = `${cols.map(() => `┌${"─".repeat(maxWidth + 2)}`).join("")}┐`;
  const botSep = `${cols.map(() => `└${"─".repeat(maxWidth + 2)}`).join("")}┘`;

  const maxRows = Math.max(...cols.map((c: any) => c.tasks.length), 0);
  const rows: string[] = [];

  for (let i = 0; i < maxRows; i++) {
    const row = `${cols
      .map((c: any) => {
        const task = c.tasks[i];
        if (!task) return `│ ${"".padEnd(maxWidth)} `;
        const title =
          task.title.length > maxWidth - 2 ? `${task.title.slice(0, maxWidth - 5)}...` : task.title;
        return `│ ${title.padEnd(maxWidth)} `;
      })
      .join("")}│`;
    rows.push(row);
  }

  return [`Board: ${board.name}`, topSep, header, sep, ...rows, botSep].join("\n");
}
