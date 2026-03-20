import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { join, basename, dirname } from "path";
import type { ApiClient } from "./client.js";

/**
 * Detect project name from context.
 * Precedence: explicit flag > .agent-kanban.json > git repo basename > undefined
 */
export function detectProjectName(explicit?: string): string | undefined {
  if (explicit) return explicit;

  // Walk up from cwd looking for .agent-kanban.json
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    const configPath = join(dir, ".agent-kanban.json");
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        if (config.project) return config.project;
      } catch { /* ignore malformed */ }
    }
    dir = dirname(dir);
  }

  // Try git repo basename
  try {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
    return basename(root);
  } catch { /* not a git repo */ }

  return undefined;
}

/**
 * Resolve project name to project_id via API.
 * Returns id if found, undefined if no project name detected.
 */
export async function detectProjectId(client: ApiClient, explicit?: string): Promise<string | undefined> {
  const name = detectProjectName(explicit);
  if (!name) return undefined;

  const projects = await client.listProjects();
  const match = projects.find((p: any) => p.name === name);
  return match?.id;
}
