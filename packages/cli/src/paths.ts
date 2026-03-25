import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();

export const CONFIG_DIR = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "agent-kanban") : join(home, ".config", "agent-kanban");

export const DATA_DIR = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "agent-kanban") : join(home, ".local", "share", "agent-kanban");

export const STATE_DIR = process.env.XDG_STATE_HOME
  ? join(process.env.XDG_STATE_HOME, "agent-kanban")
  : join(home, ".local", "state", "agent-kanban");

export const LOGS_DIR = join(STATE_DIR, "logs");

export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const PID_FILE = join(STATE_DIR, "daemon.pid");
export const REPOS_DIR = join(DATA_DIR, "repos");
export const WORKTREES_DIR = join(DATA_DIR, "worktrees");
export const TRACKED_TASKS_FILE = join(DATA_DIR, "tracked-tasks.json");
export const SESSION_PIDS_FILE = join(DATA_DIR, "session-pids.json");
export const SAVED_SESSIONS_FILE = join(DATA_DIR, "saved-sessions.json");
