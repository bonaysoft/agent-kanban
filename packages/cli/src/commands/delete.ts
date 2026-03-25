import type { Command } from "commander";
import { normalizeResource } from "./resources.js";

export function registerDeleteCommand(program: Command) {
  program
    .command("delete <resource> <id>")
    .description("Delete a resource")
    .action(async (resource: string, id: string) => {
      const name = normalizeResource(resource);
      console.error(`ak delete ${name} ${id} is not implemented yet. Use "ak ${name} delete ${id}" instead.`);
      process.exit(1);
    });
}
