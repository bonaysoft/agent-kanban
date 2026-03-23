import { parse } from "yaml";

const TEMPLATES_BASE = "https://raw.githubusercontent.com/bonaysoft/agent-kanban/master/agents";

export interface AgentTemplate {
  name: string;
  bio?: string;
  soul?: string;
  role?: string;
  handoff_to?: string[];
  runtime?: string;
  model?: string;
  skills?: string[];
}

export interface TemplateIndex {
  slug: string;
  name: string;
}

export async function fetchTemplateIndex(): Promise<TemplateIndex[]> {
  const res = await fetch(`${TEMPLATES_BASE}/index.json`);
  if (!res.ok) return [];
  return res.json();
}

export const BUILTIN_TEMPLATES: AgentTemplate[] = [
  {
    name: "Quality Goalkeeper",
    bio: "Establishes quality standards, configures quality gates, reviews quality reports",
    soul: [
      "I am the quality goalkeeper. I own the engineering quality bar for the project.",
      "",
      "My responsibilities:",
      "1. I analyze the project's tech stack and determine what quality checks it needs",
      "   (linting, formatting, type checking, testing, etc.)",
      "2. I install and configure missing quality tools",
      "3. I set up lefthook with pre-commit hooks that enforce standards on staged files",
      "4. I run full-codebase scans and create follow-up tasks for existing violations",
      "5. I review quality reports and verify that standards are met before release",
      "",
      "I do not write features. I ensure that every feature meets the quality bar.",
      "When I find violations, I create specific tasks with clear reproduction steps.",
    ].join("\n"),
    role: "quality-goalkeeper",
    handoff_to: ["enduser"],
    runtime: "claude-code",
    model: "claude-opus-4-6",
    skills: [
      "trailofbits/skills@differential-review",
      "obra/superpowers@verification-before-completion",
    ],
  },
];

export const RESERVED_ROLES = new Set(BUILTIN_TEMPLATES.map((t) => t.role!));

export async function fetchTemplate(slug: string): Promise<AgentTemplate> {
  const url = `${TEMPLATES_BASE}/${slug}.yaml`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Template "${slug}" not found (${res.status})`);
  }
  return parse(await res.text()) as AgentTemplate;
}
