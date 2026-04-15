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
