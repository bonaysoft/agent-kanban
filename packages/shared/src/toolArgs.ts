/**
 * Canonical tool argument shapes shared between the web frontend and CLI
 * provider normalizers (Copilot, Codex, etc.).
 *
 * These types represent the "Claude-canonical" field names that the frontend
 * expects. Providers that use different field conventions (e.g. Copilot CLI
 * uses `path`/`file_text`/`old_str`) must remap to these shapes before
 * emitting tool_use blocks.
 */

export type BashArgs = {
  command: string;
  description?: string;
  timeout?: number;
};

export type ReadArgs = {
  file_path: string;
  offset?: number;
  limit?: number;
};

export type EditArgs = {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
};

export type MultiEditArgs = {
  file_path: string;
  edits: { old_string: string; new_string: string; replace_all?: boolean }[];
};

export type WriteArgs = {
  file_path: string;
  content: string;
};

export type GrepArgs = {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: string;
};

export type GlobArgs = {
  pattern: string;
  path?: string;
};

export type TaskArgs = {
  description: string;
  prompt: string;
  subagent_type?: string;
};

export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

export type TodoArgs = {
  todos: TodoItem[];
};

export type WebFetchArgs = {
  url: string;
  prompt: string;
};

export type WebSearchArgs = {
  query: string;
};

export type WebSearchResultItem = {
  title?: string;
  url?: string;
  snippet?: string;
};

export type WebSearchResult = WebSearchResultItem[] | string;

export type AskUserQuestionOption = {
  label?: string;
  description?: string;
};

export type AskUserQuestion = {
  header?: string;
  question: string;
  multiSelect?: boolean;
  options?: AskUserQuestionOption[];
};

export type AskUserQuestionArgs = {
  questions: AskUserQuestion[];
};

export type ExitPlanModeArgs = {
  plan: string;
};

export type SlashCommandArgs = {
  command: string;
};

export type NotebookEditArgs = {
  notebook_path: string;
  cell_id?: string;
  cell_type?: "code" | "markdown";
  edit_mode?: "replace" | "insert" | "delete";
  new_source: string;
};
