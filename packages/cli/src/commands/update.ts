import type { Command } from "commander";
import { normalizeResource } from "./resources.js";

export function registerUpdateCommand(program: Command) {
  program
    .command("update <resource> <id>")
    .description("Update a resource")
    .allowUnknownOption()
    .action(async (resource: string, id: string) => {
      const name = normalizeResource(resource);
      console.error(`ak update ${name} ${id} is not implemented yet. Use "ak ${name} update ${id}" instead.`);
      process.exit(1);
    });
}
