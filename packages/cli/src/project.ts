import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { join, basename, dirname } from "path";

/**
 * Smart project detection.
 * Precedence: explicit flag > .agent-kanban.json > git repo basename > error
 */
export function detectProject(explicit?: string): string | undefined {
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
