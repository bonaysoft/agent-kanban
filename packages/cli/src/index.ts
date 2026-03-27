import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createClient } from "./client.js";
import { registerCreateCommand } from "./commands/create.js";
import { registerDeleteCommand } from "./commands/delete.js";
import { registerGetCommand } from "./commands/get.js";
import { registerLogsCommand, registerStartCommand, registerStatusCommand, registerStopCommand } from "./commands/start.js";
import { registerUpdateCommand } from "./commands/update.js";
import { getCredentials, readConfig, saveCredentials } from "./config.js";
import { loadIdentity } from "./identity.js";
import { getFormat, output } from "./output.js";
import { detectRuntime } from "./runtime.js";
import { wrapRuntime } from "./runtimeWrapper.js";

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf-8"));

const program = new Command();
program.name("ak").description("Agent-first kanban board").version(pkg.version);

const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
const helpSections: [string, [string, string][]][] = [
  [
    "Resources",
    [
      ["get <resource> [id]", "Get a resource or list resources"],
      ["create <resource>", "Create a resource (board, task, agent, repo, note)"],
      ["update <resource> <id>", "Update a resource (board, task, agent)"],
      ["delete <resource> <id>", "Delete a resource (board, task, agent, repo)"],
    ],
  ],
  [
    "Task Lifecycle",
    [
      ["task claim <id>", "Claim an assigned task"],
      ["task review <id>", "Submit task for review"],
      ["task complete <id>", "Complete a task"],
      ["task reject <id>", "Reject a task back to in-progress"],
      ["task cancel <id>", "Cancel a task"],
      ["task release <id>", "Release a task back to todo"],
    ],
  ],
  [
    "Runtime Wrappers",
    [
      ["claude [args...]", "Launch Claude Code with leader identity"],
      ["codex [args...]", "Launch Codex CLI with leader identity"],
      ["gemini [args...]", "Launch Gemini CLI with leader identity"],
      ["whoami", "Show agent identity for current runtime"],
    ],
  ],
  [
    "Daemon",
    [
      ["start", "Start the Machine daemon"],
      ["stop", "Stop the Machine daemon"],
      ["status", "Show daemon status"],
      ["logs", "Show daemon logs"],
    ],
  ],
  [
    "Config",
    [
      ["config set <key> <value>", "Set a config value"],
      ["config get <key>", "Get a config value"],
    ],
  ],
];

program.helpInformation = () => {
  const lines = [`Usage: ak [command]\n`, `Agent-first kanban board (v${pkg.version})\n`];
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
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const task = await client.claimTask(id);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t: any) => `Claimed task ${t.id}: ${t.title} (now in progress)`);
  });

taskCmd
  .command("cancel <id>")
  .description("Cancel a task")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const task = await client.cancelTask(id);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Cancelled task ${t.id}: ${t.title}`);
  });

taskCmd
  .command("review <id>")
  .description("Move a task to In Review")
  .option("--pr-url <url>", "Pull request URL")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const body: Record<string, unknown> = {};
    if (opts.prUrl) body.pr_url = opts.prUrl;
    const task = await client.reviewTask(id, body);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Moved task ${t.id} to review: ${t.title}`);
  });

taskCmd
  .command("complete <id>")
  .description("Complete a task (ops fallback)")
  .option("--result <result>", "Completion result summary")
  .option("--pr-url <url>", "PR URL")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const body: Record<string, unknown> = {};
    if (opts.result) body.result = opts.result;
    if (opts.prUrl) body.pr_url = opts.prUrl;
    const task = await client.completeTask(id, body);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Completed task ${t.id}: ${t.title}`);
  });

taskCmd
  .command("reject <id>")
  .description("Reject a task from review back to in-progress")
  .option("--reason <reason>", "Reason for rejection (logged)")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const body: Record<string, unknown> = {};
    if (opts.reason) body.reason = opts.reason;
    const task = await client.rejectTask(id, body);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Rejected task ${t.id}: ${t.title} (back to in-progress)`);
  });

taskCmd
  .command("release <id>")
  .description("Release a task back to todo (ops fallback)")
  .option("--format <format>", "Output format (json, text)")
  .action(async (id, opts) => {
    const client = await createClient();
    const task = await client.releaseTask(id);
    const fmt = getFormat(opts.format);
    output(task, fmt, (t) => `Released task ${t.id}: ${t.title} (back to todo)`);
  });

// ─── Top-level CRUD ───

registerGetCommand(program);
registerCreateCommand(program);
registerUpdateCommand(program);
registerDeleteCommand(program);

// ─── Identity ───

program
  .command("whoami")
  .description("Show agent identity for the current runtime")
  .action(() => {
    const runtime = detectRuntime();
    const runtimeKey = runtime ?? "default";
    const identity = loadIdentity(runtimeKey);
    if (!identity) {
      console.error(
        runtime
          ? `No identity for ${runtimeKey}. Run: ak ${runtimeKey} to auto-create.`
          : "No runtime detected. Run ak claude, ak codex, or ak gemini to create an identity.",
      );
      process.exit(1);
    }
    console.log(`Runtime:     ${runtimeKey}`);
    console.log(`Agent ID:    ${identity.agent_id}`);
    console.log(`Name:        ${identity.name}`);
    console.log(`Fingerprint: ${identity.fingerprint}`);
  });

// ─── Runtime Wrappers ───

program
  .command("claude")
  .description("Launch Claude Code with leader agent identity")
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (_opts, cmd) => wrapRuntime("claude", "claude", cmd.args));

program
  .command("codex")
  .description("Launch Codex CLI with leader agent identity")
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (_opts, cmd) => wrapRuntime("codex", "codex", cmd.args));

program
  .command("gemini")
  .description("Launch Gemini CLI with leader agent identity")
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (_opts, cmd) => wrapRuntime("gemini", "gemini", cmd.args));

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
    const { startDaemon } = await import("./daemon.js");
    await startDaemon({
      maxConcurrent: parseInt(opts.maxConcurrent, 10),
      pollInterval: parseInt(opts.pollInterval, 10),
      taskTimeout: parseInt(opts.taskTimeout, 10),
    });
  });

program.parseAsync();
