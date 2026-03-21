import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".agent-kanban");
const LINKS_FILE = join(CONFIG_DIR, "links.json");

interface Links {
  [repositoryId: string]: string; // repositoryId → localPath
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

export function setLink(repositoryId: string, localPath: string): void {
  const links = readLinks();
  links[repositoryId] = localPath;
  writeLinks(links);
}

export function getLinks(): Links {
  return readLinks();
}

export function findPathForRepository(repositoryId: string): string | undefined {
  return readLinks()[repositoryId];
}
