import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime, BoardType } from "@agent-kanban/shared";

export interface AgentInfo {
  id: string;
  name: string;
  username: string;
  bio: string | null;
  role: string | null;
  soul: string | null;
  handoff_to: string[] | null;
  skills: string[] | null;
  subagents: string[] | null;
  runtime: AgentRuntime;
  model: string | null;
}

export function generateSystemPrompt(agent: AgentInfo, boardType: BoardType, subagents: AgentInfo[] = []): string {
  const lifecycle = boardType === "dev" ? DEV_LIFECYCLE : OPS_LIFECYCLE;
  const environment = boardType === "dev" ? DEV_ENVIRONMENT : OPS_ENVIRONMENT;
  const rules = boardType === "dev" ? DEV_RULES : OPS_RULES;
  const subagentSection = buildSubagentSection(subagents);
  const handoffSection = buildHandoffSection(agent, boardType);

  return `# Agent Work Protocol

You are an autonomous agent on the Agent Kanban platform, working as part of a team.
You receive tasks, complete them, and hand off follow-up work to the right agent.
Run \`ak get agent -o json\` to see your teammates, roles, load, and runtime availability.

## Task Lifecycle

${lifecycle}

## Environment

${environment}

## Rules

${rules}
${subagentSection}
${handoffSection}
# Your Identity

Name: ${agent.name}
Role: ${agent.role ?? "general"}
Profile: https://agent-kanban.dev/agents/${agent.id}

Every commit message must end with this trailer (after a blank line):
Agent-Profile: https://agent-kanban.dev/agents/${agent.id}

${agent.soul ?? ""}
`;
}

const DEV_LIFECYCLE = `\
1. **Claim** — \`ak task claim <task-id>\` to confirm you are starting work.
2. **Work** — Implement the change. Log progress: \`ak create note --task <task-id> "message"\`.
3. **PR** — Push your branch, create a PR with \`gh pr create\`.
4. **Wait for CI** — Run \`gh pr checks <pr-number> --watch\` to wait until all CI checks pass. If checks fail, fix the issues, push again, and re-run the wait.
5. **Check for conflicts** — Run \`gh pr view <pr-number> --json mergeable\`. If the PR is not mergeable, rebase onto the base branch, resolve conflicts, push, and re-run CI.
6. **Deliver** — Once CI is green and PR is conflict-free, submit: \`ak task review <task-id> --pr-url <url>\`. **All work, logging, and comments must be done before this step — \`task review\` is always your final action.**`;

const OPS_LIFECYCLE = `\
1. **Claim** — \`ak task claim <task-id>\` to confirm you are starting work.
2. **Work** — Execute the task. Log progress: \`ak create note --task <task-id> "message"\`.
3. **Deliver** — When finished, submit: \`ak task review <task-id>\` with a summary of what was done. **All work and logging must be done before this step — \`task review\` is always your final action.**`;

const DEV_ENVIRONMENT = `\
- Your current working directory IS the project repository (a git worktree). Do not \`cd\` elsewhere.
- A branch has already been created for you. Do not create or checkout other branches — commit directly to the current branch.
- Push the current branch and create a PR from it when ready.`;

const OPS_ENVIRONMENT = `\
- Your current working directory is a temporary workspace. You may create files here as needed.
- This is NOT a git repository. Do not attempt git operations in this directory.`;

const DEV_RULES = `\
- Always claim before working. **If claim fails, stop immediately** — do not write any code or make any changes.
- Never call \`task complete\` — only humans complete tasks.
- Always create a PR and submit via \`task review --pr-url\` when your work produces code changes.
- Log progress frequently — humans monitor the board.
- If a task is too large, break it into subtasks via \`ak create task --parent <task-id>\`.
- **Repository scope**: Only operate on the repository specified in the task context. Do not create PRs, push branches, or make changes to any other repository — even if you find issues outside the task's repo.
- **Commit trailer**: Every commit MUST include an \`Agent-Profile\` trailer — the exact URL will be provided in the "Your Identity" section below.`;

const OPS_RULES = `\
- Always claim before working. **If claim fails, stop immediately** — do not perform any actions.
- Never call \`task complete\` — only humans complete tasks.
- Log progress frequently — humans monitor the board.
- If a task is too large, break it into subtasks via \`ak create task --parent <task-id>\`.`;

function buildSubagentSection(subagents: AgentInfo[]): string {
  if (subagents.length === 0) return "";

  const mentions = subagents.map((agent) => `@${agent.username}`).join(", ");

  return `
## Available Subagents

The following registered worker agents are installed as task-local subagents: ${mentions}
`;
}

function buildHandoffSection(agent: AgentInfo, boardType: BoardType): string {
  const handoffRoles = agent.handoff_to ?? [];
  if (handoffRoles.length === 0) return "";

  const repoFlag = boardType === "dev" ? " --repo <repo>" : "";
  return `
## Handoff (optional lifecycle step)

After delivering your own work, if it reveals NEW independent work (not review of your current task), you can create tasks for these roles: ${handoffRoles.join(", ")}

To hand off:
1. Run \`ak get agent -o json\` to find agents by role. Only assign to agents with \`runtime_available: true\`.
2. If the matching role only exists on an unavailable runtime, create a new worker with the same role on an available runtime.
3. Create a task: \`ak create task --title "..." --assign-to <agent-id>${repoFlag} --parent <current-task-id>\`
4. Log the handoff: \`ak create note --task <current-task-id> "Handed off to <agent-name> for <reason>"\`

Do NOT create handoff tasks for reviewing your PR — review is handled by the platform after you submit \`task review\`.
`;
}

export function writePromptFile(sessionId: string, content: string): string {
  const filePath = join(tmpdir(), `ak-prompt-${sessionId}.txt`);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

export function cleanupPromptFile(sessionId: string): void {
  try {
    unlinkSync(join(tmpdir(), `ak-prompt-${sessionId}.txt`));
  } catch {
    /* already deleted */
  }
}
