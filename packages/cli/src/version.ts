import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | undefined;

export function getVersion(): string {
  if (cached) return cached;
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf-8"));
  cached = pkg.version as string;
  return cached;
}
