import { Command } from "commander";
import { loadIdentity } from "./agent/identity.js";
import { createClient } from "./agent/leader.js";
import { detectRuntime } from "./agent/runtime.js";
import { registerApplyCommand } from "./commands/apply.js";
import { registerCreateCommand } from "./commands/create.js";
import { registerDeleteCommand } from "./commands/delete.js";
import { registerDescribeCommand } from "./commands/describe.js";
import { registerGetCommand } from "./commands/get.js";
import { registerLogsCommand, registerStartCommand, registerStatusCommand, registerStopCommand } from "./commands/start.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerWaitCommand } from "./commands/wait.js";
import { getCredentials, readConfig, saveCredentials } from "./config.js";
import { getOutputFormat, output } from "./output.js";
import { getVersion } from "./version.js";

const program = new Command();
program.name("ak").description("Agent-first kanban board").version(getVersion());

const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
const helpSections: [string, [string, string][]][] = [
  [
    "Resources",
    [
      ["get <resource> [id]", "Get or list resources"],
      ["create <resource>", "Create a resource"],
      ["update <resource> <id>", "Update a resource"],
      ["delete <resource> <id>", "Delete a resource"],
      ["describe <resource> <id>", "Show detailed resource info"],
      ["apply -f <file>", "Apply a YAML/JSON resource spec"],
    ],
  ],
  [
    "Task Lifecycle",
    [
      ["task claim <id>", "Claim a task"],
      ["task review <id>", "Submit for review"],
      ["task complete <id>", "Complete a task"],
      ["task reject <id>", "Reject back to in-progress"],
      ["task cancel <id>", "Cancel a task"],
      ["task release <id>", "Release back to todo"],
    ],
  ],
  [
    "Wait (block until condition)",
    [
      ["wait task <ids...>", "Wait until tasks reach --until status (default done)"],
      ["wait board <id>", "Wait for task state changes on a board"],
      ["wait pr <num>", "Wait for a PR's CI checks to finish"],
    ],
  ],
  ["Output", [["-o json|yaml|wide", "Output format (default: text table)"]]],
];

program.helpInformation = () => {
  const lines = [`Usage: ak [command]\n`, `Agent-first kanban board (v${getVersion()})\n`];
  for (const [title, cmds] of helpSections) {
    lines.push(`  ${title}:`);
    for (const [cmd, desc] of cmds) lines.push(`    ${pad(cmd, 28)} ${desc}`);
    lines.push("");
  }
  return lines.join("\n");
};

// ─── Config ───

const configCmd = program.command("config").description("Manage CLI configuration");

configCmd
  .command("set")
  .description("Save credentials: ak config set --api-url <url> --api-key <key>")
  .requiredOption("--api-url <url>", "API server URL")
  .requiredOption("--api-key <key>", "Machine API key")
  .action((opts) => {
    saveCredentials(opts.apiUrl, opts.apiKey);
    const host = new URL(opts.apiUrl).host;
    console.log(`Saved credentials for ${host}`);
  });

configCmd
  .command("get")
  .description("Show current credentials")
  .action(() => {
    try {
      const { apiUrl, apiKey } = getCredentials();
      console.log(`api-url: ${apiUrl}`);
      console.log(`api-key: ${apiKey.slice(0, 8)}...`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });

configCmd
  .command("list")
  .description("List all saved environments")
  .action(() => {
    const config = readConfig();
    const hosts = Object.keys(config.credentials);
    if (hosts.length === 0) {
      console.log("No environments configured.");
      return;
    }
    for (const host of hosts) {
      const marker = host === config.current ? "* " : "  ";
      console.log(`${marker}${host}`);
    }
  });

// ─── Task ───

const taskCmd = program.command("task").description("Task lifecycle commands");

taskCmd
  .command("claim <id>")
  .description("Claim an assigned task — start working on it")
  .option("-o, --output <format>", "Output format (json, yaml, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const task = await client.claimTask(id);
    const fmt = getOutputFormat(opts.output);
    output(task, fmt, (t: any) => `Claimed task ${t.id}: ${t.title} (now in progress)`);
  });

taskCmd
  .command("cancel <id>")
  .description("Cancel a task")
  .option("-o, --output <format>", "Output format (json, yaml, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const task = await client.cancelTask(id);
    const fmt = getOutputFormat(opts.output);
    output(task, fmt, (t) => `Cancelled task ${t.id}: ${t.title}`);
  });

taskCmd
  .command("review <id>")
  .description("Move a task to In Review")
  .option("--pr-url <url>", "Pull request URL")
  .option("-o, --output <format>", "Output format (json, yaml, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const body: Record<string, unknown> = {};
    if (opts.prUrl) body.pr_url = opts.prUrl;
    const task = await client.reviewTask(id, body);
    const fmt = getOutputFormat(opts.output);
    output(task, fmt, (t) => `Moved task ${t.id} to review: ${t.title}`);
  });

taskCmd
  .command("complete <id>")
  .description("Complete a task (ops fallback)")
  .option("--result <result>", "Completion result summary")
  .option("--pr-url <url>", "PR URL")
  .option("-o, --output <format>", "Output format (json, yaml, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const body: Record<string, unknown> = {};
    if (opts.result) body.result = opts.result;
    if (opts.prUrl) body.pr_url = opts.prUrl;
    const task = await client.completeTask(id, body);
    const fmt = getOutputFormat(opts.output);
    output(task, fmt, (t) => `Completed task ${t.id}: ${t.title}`);
  });

taskCmd
  .command("reject <id>")
  .description("Reject a task from review back to in-progress")
  .option("--reason <reason>", "Reason for rejection (logged)")
  .option("-o, --output <format>", "Output format (json, yaml, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const body: Record<string, unknown> = {};
    if (opts.reason) body.reason = opts.reason;
    const task = await client.rejectTask(id, body);
    const fmt = getOutputFormat(opts.output);
    output(task, fmt, (t) => `Rejected task ${t.id}: ${t.title} (back to in-progress)`);
  });

taskCmd
  .command("release <id>")
  .description("Release a task back to todo (ops fallback)")
  .option("-o, --output <format>", "Output format (json, yaml, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const task = await client.releaseTask(id);
    const fmt = getOutputFormat(opts.output);
    output(task, fmt, (t) => `Released task ${t.id}: ${t.title} (back to todo)`);
  });

// ─── Top-level CRUD ───

registerGetCommand(program);
registerDescribeCommand(program);
registerCreateCommand(program);
registerUpdateCommand(program);
registerDeleteCommand(program);
registerApplyCommand(program);
registerWaitCommand(program);

// ─── Identity ───

program
  .command("whoami")
  .description("Show agent identity for the current runtime")
  .action(async () => {
    // Trigger auto-init so whoami works as first command
    await createClient();
    const runtime = detectRuntime();
    const runtimeKey = runtime ?? "default";
    const identity = loadIdentity(runtimeKey);
    if (!identity) {
      console.error("Failed to resolve identity.");
      process.exit(1);
    }
    console.log(`Runtime:     ${runtimeKey}`);
    console.log(`Agent ID:    ${identity.agent_id}`);
    console.log(`Name:        ${identity.name}`);
    console.log(`Fingerprint: ${identity.fingerprint}`);
  });

// ─── Daemon ───

registerStartCommand(program);
registerStopCommand(program);
registerStatusCommand(program);
registerLogsCommand(program);

program
  .command("__daemon", { hidden: true })
  .option("--max-concurrent <n>", "", "3")
  .option("--poll-interval <ms>", "", "10000")
  .option("--task-timeout <ms>", "", "7200000")
  .action(async (opts) => {
    const { startDaemon } = await import("./daemon/index.js");
    await startDaemon({
      maxConcurrent: parseInt(opts.maxConcurrent, 10),
      pollInterval: parseInt(opts.pollInterval, 10),
      taskTimeout: parseInt(opts.taskTimeout, 10),
    });
  });

program.parseAsync().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
