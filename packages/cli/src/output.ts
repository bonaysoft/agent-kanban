const isTTY = process.stdout.isTTY;

export function getFormat(explicit?: string): "json" | "text" {
  if (explicit === "json") return "json";
  if (explicit === "text") return "text";
  return isTTY ? "text" : "json";
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
    const priority = t.priority ? `[${t.priority}]` : "";
    const project = t.repository_name ? `(${t.repository_name})` : "";
    const agent = t.assigned_to ? `→ ${t.assigned_to}` : "";
    return `  ${t.id}  ${priority.padEnd(8)} ${t.title} ${project} ${agent}`;
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

export function formatProjectList(projects: any[]): string {
  if (projects.length === 0) return "No projects found.";

  const lines = projects.map((p) => {
    const desc = p.description ? ` — ${p.description}` : "";
    return `  ${p.id}  ${p.name}${desc}`;
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

export function formatBoard(board: any): string {
  const cols = board.columns || [];
  const maxWidth = 30;

  const header = cols.map((c: any) =>
    `│ ${(c.name + ` (${c.tasks.length})`).padEnd(maxWidth)} `
  ).join("") + "│";

  const sep = cols.map(() => "├" + "─".repeat(maxWidth + 2)).join("") + "┤";
  const topSep = cols.map(() => "┌" + "─".repeat(maxWidth + 2)).join("") + "┐";
  const botSep = cols.map(() => "└" + "─".repeat(maxWidth + 2)).join("") + "┘";

  const maxRows = Math.max(...cols.map((c: any) => c.tasks.length), 0);
  const rows: string[] = [];

  for (let i = 0; i < maxRows; i++) {
    const row = cols.map((c: any) => {
      const task = c.tasks[i];
      if (!task) return `│ ${"".padEnd(maxWidth)} `;
      const title = task.title.length > maxWidth - 2
        ? task.title.slice(0, maxWidth - 5) + "..."
        : task.title;
      return `│ ${title.padEnd(maxWidth)} `;
    }).join("") + "│";
    rows.push(row);
  }

  return [
    `Board: ${board.name}`,
    topSep,
    header,
    sep,
    ...rows,
    botSep,
  ].join("\n");
}
