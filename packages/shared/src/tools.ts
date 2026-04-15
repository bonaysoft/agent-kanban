import type {
  AskUserQuestionArgs,
  BashArgs,
  EditArgs,
  ExitPlanModeArgs,
  GlobArgs,
  GrepArgs,
  MultiEditArgs,
  NotebookEditArgs,
  ReadArgs,
  SlashCommandArgs,
  TaskArgs,
  TodoArgs,
  WebFetchArgs,
  WebSearchArgs,
  WriteArgs,
} from "./toolArgs.js";

/**
 * Canonical tool names used across all providers and the web UI.
 *
 * All providers (Claude, Codex, Copilot, …) map their native tool
 * identifiers onto one of these names.  The frontend registers tool UIs
 * against these names.  Using this const object (instead of raw strings)
 * means a typo becomes a compile error.
 */
export const ToolName = {
  Bash: "Bash",
  Read: "Read",
  Edit: "Edit",
  MultiEdit: "MultiEdit",
  Write: "Write",
  Grep: "Grep",
  Glob: "Glob",
  Agent: "Agent",
  TodoWrite: "TodoWrite",
  WebFetch: "WebFetch",
  WebSearch: "WebSearch",
  AskUserQuestion: "AskUserQuestion",
  ExitPlanMode: "ExitPlanMode",
  SlashCommand: "SlashCommand",
  NotebookEdit: "NotebookEdit",
} as const;

export type ToolName = (typeof ToolName)[keyof typeof ToolName];

/**
 * Maps every ToolName to its canonical input argument type.
 * Use this to get compile-time safety when constructing tool_use blocks.
 *
 * @example
 *   function makeToolUse<K extends ToolName>(name: K, input: ToolArgMap[K]) { ... }
 */
export type ToolArgMap = {
  [ToolName.Bash]: BashArgs;
  [ToolName.Read]: ReadArgs;
  [ToolName.Edit]: EditArgs;
  [ToolName.MultiEdit]: MultiEditArgs;
  [ToolName.Write]: WriteArgs;
  [ToolName.Grep]: GrepArgs;
  [ToolName.Glob]: GlobArgs;
  [ToolName.Agent]: TaskArgs;
  [ToolName.TodoWrite]: TodoArgs;
  [ToolName.WebFetch]: WebFetchArgs;
  [ToolName.WebSearch]: WebSearchArgs;
  [ToolName.AskUserQuestion]: AskUserQuestionArgs;
  [ToolName.ExitPlanMode]: ExitPlanModeArgs;
  [ToolName.SlashCommand]: SlashCommandArgs;
  [ToolName.NotebookEdit]: NotebookEditArgs;
};
