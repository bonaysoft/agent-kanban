import { execSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MachineClient } from "./client.js";
import { createLogger } from "./logger.js";

const logger = createLogger("skills");

const SKILL_SOURCE = "saltbo/agent-kanban";
const SKILL_NAME = "agent-kanban";
const SKILL_GITIGNORE_ENTRIES = [".claude/skills/", ".agents/", "skills-lock.json"];

function installSkill(repoDir: string, source: string, skill: string): boolean {
  const skillFile = join(repoDir, `.claude/skills/${skill}/SKILL.md`);
  if (existsSync(skillFile)) return false;

  logger.info(`Installing skill "${skill}" from ${source} in ${repoDir}`);
  try {
    execSync(`npx skills add ${source} --skill ${skill} --agent claude-code --agent universal -y`, {
      cwd: repoDir,
      stdio: "pipe",
    });
  } catch (err: any) {
    const stderr = err.stderr?.toString() || err.message;
    logger.warn(`Failed to install skill "${skill}" from ${source}: ${stderr}`);
    return false;
  }
  return true;
}

export function ensureSkills(worktreeDir: string, agentSkills: string[]): boolean {
  try {
    let changed = installSkill(worktreeDir, SKILL_SOURCE, SKILL_NAME);

    for (const entry of agentSkills) {
      const atIdx = entry.indexOf("@");
      if (atIdx === -1) {
        logger.warn(`Skipping invalid skill entry (missing @): ${entry}`);
        continue;
      }
      const installed = installSkill(worktreeDir, entry.slice(0, atIdx), entry.slice(atIdx + 1));
      if (installed) changed = true;
    }

    if (!changed) {
      const result = execSync("npx skills update", { cwd: worktreeDir, stdio: "pipe" }).toString();
      if (!result.includes("up to date")) logger.info(`Skills updated in ${worktreeDir}`);
    }

    const gitignorePath = join(worktreeDir, ".gitignore");
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
    const missing = SKILL_GITIGNORE_ENTRIES.filter((e) => !existing.includes(e));
    if (missing.length > 0) {
      appendFileSync(gitignorePath, `\n# agent skills (managed by daemon)\n${missing.join("\n")}\n`);
    }

    return true;
  } catch (err: any) {
    logger.error(`Failed to ensure skills: ${err.message}`);
    return false;
  }
}

const LEFTHOOK_LABEL = "setup:lefthook";
const LEFTHOOK_CONFIG_FILES = [
  "lefthook.yml",
  "lefthook.yaml",
  "lefthook.json",
  "lefthook.toml",
  ".lefthook.yml",
  ".lefthook.yaml",
  ".lefthook.json",
  ".lefthook.toml",
];

/** Returns true if a lefthook setup task was created (caller should skip this poll cycle). */
export async function ensureLefthookTask(client: MachineClient, task: any, repoDir: string, allTasks: any[]): Promise<boolean> {
  if (LEFTHOOK_CONFIG_FILES.some((f) => existsSync(join(repoDir, f)))) return false;

  const existingLefthook = allTasks.find((t) => t.repository_id === task.repository_id && t.labels?.includes(LEFTHOOK_LABEL));
  if (existingLefthook) return !existingLefthook.blocked;

  logger.info(`No lefthook config in ${repoDir}, creating setup task`);

  const agents = (await client.listAgents()) as any[];
  const qualityAgent = agents.find((a: any) => a.builtin && a.role === "quality-goalkeeper");
  if (!qualityAgent) {
    logger.warn("No builtin quality-goalkeeper agent found, skipping lefthook setup");
    return false;
  }

  const setupTask = (await client.createTask({
    title: "Setup lefthook quality gates for this repository",
    description:
      "This repository has no lefthook configuration. Analyze the project's tech stack, set up appropriate quality checks, and enforce them via lefthook pre-commit hooks.",
    board_id: task.board_id,
    repository_id: task.repository_id,
    labels: [LEFTHOOK_LABEL],
    assigned_to: qualityAgent.id,
  })) as any;

  logger.info(`Created lefthook setup task ${setupTask.id}`);

  const repoTasks = allTasks.filter((t: any) => t.repository_id === task.repository_id);
  let blocked = 0;
  for (const t of repoTasks) {
    try {
      await client.updateTask(t.id, {
        depends_on: [...(t.depends_on || []), setupTask.id],
      });
      blocked++;
    } catch (err: any) {
      logger.warn(`Failed to add lefthook dependency on task ${t.id}: ${err.message}`);
    }
  }

  logger.info(`Blocked ${blocked}/${repoTasks.length} tasks on lefthook setup task ${setupTask.id}`);
  return true;
}
