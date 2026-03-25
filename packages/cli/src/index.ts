import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createClient } from "./client.js";
import { registerCreateCommand } from "./commands/create.js";
import { registerDeleteCommand } from "./commands/delete.js";
import { registerGetCommand } from "./commands/get.js";
import { registerLogsCommand, registerStartCommand, registerStatusCommand, registerStopCommand } from "./commands/start.js";
import { registerUpdateCommand } from "./commands/update.js";
import { getConfigValue, setConfigValue } from "./config.js";
import { loadIdentity } from "./identity.js";
import { getFormat, output } from "./output.js";
import { detectRuntime } from "./runtime.js";
import { wrapRuntime } from "./runtimeWrapper.js";

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf-8"));

const program = new Command();
program.name("agent-kanban").description("Agent-first kanban board").version(pkg.version);

// ─── Config ───

const configCmd = program.command("config").description("Manage CLI configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a config value (api-url, api-key)")
  .action((key, value) => {
    setConfigValue(key, value);
    console.log(`Set ${key}`);
  });

configCmd
  .command("get <key>")
  .description("Get a config value")
  .action((key) => {
    const value = getConfigValue(key);
    if (value) console.log(value);
    else {
      console.error(`Not set: ${key}`);
      process.exit(1);
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
  .option("--default-provider <name>", "", "claude")
  .option("--poll-interval <ms>", "", "10000")
  .option("--task-timeout <ms>", "", "7200000")
  .action(async (opts) => {
    const { startDaemon } = await import("./daemon.js");
    await startDaemon({
      maxConcurrent: parseInt(opts.maxConcurrent, 10),
      defaultProvider: opts.defaultProvider,
      pollInterval: parseInt(opts.pollInterval, 10),
      taskTimeout: parseInt(opts.taskTimeout, 10),
    });
  });

program.parseAsync();
