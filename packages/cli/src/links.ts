import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".agent-kanban");
const LINKS_FILE = join(CONFIG_DIR, "links.json");

interface Links {
  [repoPath: string]: string; // repoPath → projectId
}

function readLinks(): Links {
  try {
    return JSON.parse(readFileSync(LINKS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeLinks(links: Links): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2) + "\n");
}

export function setLink(repoPath: string, projectId: string): void {
  const links = readLinks();
  links[repoPath] = projectId;
  writeLinks(links);
}

export function getLinks(): Links {
  return readLinks();
}

export function findProjectIdForRepo(repoPath: string): string | undefined {
  return readLinks()[repoPath];
}

export function findRepoForProject(projectId: string): string | undefined {
  const links = readLinks();
  return Object.entries(links).find(([, pid]) => pid === projectId)?.[0];
}

export function getLinkedProjectIds(): string[] {
  return [...new Set(Object.values(readLinks()))];
}
