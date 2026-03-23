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

export async function fetchTemplate(slug: string): Promise<AgentTemplate> {
  const url = `${TEMPLATES_BASE}/${slug}.yaml`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Template "${slug}" not found (${res.status}). Available: fullstack-developer, frontend-developer, backend-developer, feature-planner, designer, quality-goalkeeper, enduser`);
  }
  return parse(await res.text()) as AgentTemplate;
}
