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
    .description("Register current repo and map local directory to it")
    .action(async () => {
      let repoRoot: string;
      try {
        repoRoot = getGitRepoRoot();
      } catch {
        console.error("Not a git repository. Run this command from a git repo.");
        process.exit(1);
      }

      const remoteUrl = getGitRemoteUrl();
      if (!remoteUrl) {
        console.error("No git remote found. Add an origin remote first.");
        process.exit(1);
      }

      const client = new ApiClient();
      let repo: any;
      try {
        repo = await client.createRepository({
          name: basename(repoRoot),
          url: remoteUrl,
        });
        console.log(`Registered repository: ${remoteUrl}`);
      } catch (err: any) {
        if (err.message?.includes("UNIQUE")) {
          // Already exists — find it
          const repos = await client.listRepositories();
          repo = repos.find((r: any) => r.url === remoteUrl);
          console.log(`Repository already registered: ${remoteUrl}`);
        } else {
          throw err;
        }
      }

      setLink(repo.id, repoRoot);
      console.log(`Linked repository ${repo.id} → ${repoRoot}`);
    });
}
