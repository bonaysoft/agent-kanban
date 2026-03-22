import { execSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { basename } from "path";
import type { Command } from "commander";
import { MachineClient } from "../client.js";
import { setLink, removeLink, findPathForRepository } from "../links.js";
import { REPOS_DIR } from "../paths.js";

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

function extractFullName(url: string): string | null {
  // git@github.com:user/repo.git → user/repo
  const sshMatch = url.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  // https://github.com/user/repo.git → user/repo
  const httpsMatch = url.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  return httpsMatch ? httpsMatch[1] : null;
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

      const client = new MachineClient();
      const fullName = extractFullName(remoteUrl);
      const repos = await client.listRepositories();
      let repo = repos.find((r: any) => r.full_name === fullName);

      if (repo) {
        console.log(`Repository already registered: ${remoteUrl}`);
      } else {
        repo = await client.createRepository({
          name: basename(repoRoot),
          url: remoteUrl,
        });
        console.log(`Registered repository: ${remoteUrl}`);
      }

      const existingPath = findPathForRepository(repo.id);
      if (existingPath) {
        console.error(`Repository already linked to ${existingPath}. Run \`ak unlink\` first.`);
        process.exit(1);
      }

      setLink(repo.id, repoRoot);
      console.log(`Linked repository ${repo.id} → ${repoRoot}`);
    });
}


export function registerUnlinkCommand(program: Command) {
  program
    .command("unlink")
    .description("Remove local directory link for current repo")
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

      const client = new MachineClient();
      const fullName = extractFullName(remoteUrl);
      const repos = await client.listRepositories();
      const repo = repos.find((r: any) => r.full_name === fullName);
      if (!repo) {
        console.error("Repository not registered.");
        process.exit(1);
      }

      const linkedPath = findPathForRepository(repo.id);
      if (!linkedPath) {
        console.error("Repository is not linked.");
        process.exit(1);
      }

      removeLink(repo.id);
      console.log(`Unlinked repository ${repo.id}`);

      // Clean up auto-cloned directory
      if (linkedPath.startsWith(REPOS_DIR) && existsSync(linkedPath)) {
        rmSync(linkedPath, { recursive: true });
        console.log(`Removed auto-cloned directory: ${linkedPath}`);
      }
    });
}
