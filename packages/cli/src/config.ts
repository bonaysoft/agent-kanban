import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { CONFIG_FILE, PID_FILE } from './paths.js';

interface Config {
  'api-url'?: string;
  'api-key'?: string;
  'machine-id'?: string;
}

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function writeConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

export function getConfigValue(key: string): string | undefined {
  return readConfig()[key as keyof Config];
}

export function setConfigValue(key: string, value: string): void {
  const config = readConfig();
  (config as Record<string, string>)[key] = value;
  writeConfig(config);
}

export function deleteConfigValue(key: string): void {
  const config = readConfig();
  delete (config as Record<string, string>)[key];
  writeConfig(config);
}

export { PID_FILE };
