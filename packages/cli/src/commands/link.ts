import { execSync } from "child_process";
import { basename } from "path";
import type { Command } from "commander";
import { ApiClient } from "../client.js";
import { setLink } from "../links.js";

function getGitRepoRoot(): string {
  return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
}

function getGitRemoteUrl(): string | undefined {
  try {
    return execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

export function registerLinkCommand(program: Command) {
  program
    .command("link")
    .description("Link current repo to a project")
    .requiredOption("--project <name>", "Project name")
    .action(async (opts) => {
      let repoRoot: string;
      try {
        repoRoot = getGitRepoRoot();
      } catch {
        console.error("Not a git repository. Run this command from a git repo.");
        process.exit(1);
      }

      const client = new ApiClient();
      const projects = await client.listProjects() as any[];
      const project = projects.find((p: any) => p.name === opts.project);
      if (!project) {
        console.error(`Project not found: ${opts.project}`);
        process.exit(1);
      }

      setLink(repoRoot, project.id);
      console.log(`Linked ${repoRoot} → project "${project.name}" (${project.id})`);

      // Auto-add git_repo resource if remote exists
      const remoteUrl = getGitRemoteUrl();
      if (remoteUrl) {
        try {
          const resources = await client.listResources(project.id) as any[];
          const exists = resources.some((r: any) => r.type === "git_repo" && r.uri === remoteUrl);
          if (!exists) {
            await client.addResource(project.id, {
              type: "git_repo",
              name: basename(repoRoot),
              uri: remoteUrl,
            });
            console.log(`Added git_repo resource: ${remoteUrl}`);
          }
        } catch (err: any) {
          console.warn(`Warning: could not add git_repo resource: ${err.message}`);
        }
      }
    });
}
