import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { LINKS_FILE } from "./paths.js";

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
  mkdirSync(dirname(LINKS_FILE), { recursive: true });
  writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2) + "\n");
}

export function setLink(repositoryId: string, localPath: string): void {
  const links = readLinks();
  links[repositoryId] = localPath;
  writeLinks(links);
}

export function removeLink(repositoryId: string): void {
  const links = readLinks();
  delete links[repositoryId];
  writeLinks(links);
}

export function getLinks(): Links {
  return readLinks();
}

export function findPathForRepository(repositoryId: string): string | undefined {
  return readLinks()[repositoryId];
}

export function clearLinks(): void {
  writeLinks({});
}
