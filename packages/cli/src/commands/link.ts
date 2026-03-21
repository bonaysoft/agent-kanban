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

      // Auto-add repository if remote exists
      const remoteUrl = getGitRemoteUrl();
      if (remoteUrl) {
        try {
          const repositories = await client.listRepositories(project.id) as any[];
          const exists = repositories.some((r: any) => r.url === remoteUrl);
          if (!exists) {
            await client.addRepository(project.id, {
              name: basename(repoRoot),
              url: remoteUrl,
            });
            console.log(`Added repository: ${remoteUrl}`);
          }
        } catch (err: any) {
          console.warn(`Warning: could not add repository: ${err.message}`);
        }
      }
    });
}
