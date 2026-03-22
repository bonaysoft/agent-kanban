import { join } from "path";
import { homedir } from "os";

const home = homedir();

export const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, "agent-kanban")
  : join(home, ".config", "agent-kanban");

export const DATA_DIR = process.env.XDG_DATA_HOME
  ? join(process.env.XDG_DATA_HOME, "agent-kanban")
  : join(home, ".local", "share", "agent-kanban");

export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const PID_FILE = join(CONFIG_DIR, "daemon.pid");
export const LINKS_FILE = join(DATA_DIR, "links.json");
export const REPOS_DIR = join(DATA_DIR, "repos");
