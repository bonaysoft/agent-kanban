import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".agent-kanban");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
  "api-url"?: string;
  "api-key"?: string;
  "machine-id"?: string;
}

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function writeConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function getConfigValue(key: string): string | undefined {
  return readConfig()[key as keyof Config];
}

export function setConfigValue(key: string, value: string): void {
  const config = readConfig();
  (config as Record<string, string>)[key] = value;
  writeConfig(config);
}
