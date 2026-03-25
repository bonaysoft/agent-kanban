import type { Command } from "commander";
import { normalizeResource } from "./resources.js";

export function registerCreateCommand(program: Command) {
  program
    .command("create <resource>")
    .description("Create a resource")
    .allowUnknownOption()
    .action(async (resource: string) => {
      const name = normalizeResource(resource);
      console.error(`ak create ${name} is not implemented yet. Use "ak ${name} create" instead.`);
      process.exit(1);
    });
}
