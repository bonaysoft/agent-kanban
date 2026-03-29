import type { Command } from "commander";
import { applyResource } from "../apply/kinds.js";
import { parseResourceDocs } from "../apply/parser.js";
import { createClient } from "../client.js";
import { getFormat } from "../output.js";

export function registerApplyCommand(program: Command) {
  program
    .command("apply")
    .description("Apply a YAML/JSON resource spec from file or stdin")
    .requiredOption("-f <file>", "File to apply (use - for stdin)")
    .option("--format <format>", "Output format (json, text)")
    .action(async (opts) => {
      const client = await createClient();
      const fmt = getFormat(opts.format);
      const docs = parseResourceDocs(opts.f);
      for (const doc of docs) {
        if (!doc.kind) {
          console.error("Missing 'kind' field in document");
          process.exit(1);
        }
        if (!doc.spec || typeof doc.spec !== "object") {
          console.error(`Missing or invalid 'spec' field in document (kind: ${doc.kind})`);
          process.exit(1);
        }
        await applyResource(client, doc.kind, doc.spec, fmt);
      }
    });
}
