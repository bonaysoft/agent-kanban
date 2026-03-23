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
  return parseSimpleYaml(await res.text());
}

function parseSimpleYaml(text: string): AgentTemplate {
  const result: Record<string, unknown> = {};
  let currentKey = "";
  let multilineValue = "";
  let inMultiline = false;
  let multilineIndent = 0;
  let inList = false;
  let listKey = "";
  const listItems: string[] = [];

  for (const line of text.split("\n")) {
    if (inMultiline) {
      if (line.length === 0 || /^\s/.test(line)) {
        const stripped = line.slice(Math.min(multilineIndent, line.search(/\S|$/)));
        multilineValue += (multilineValue ? "\n" : "") + stripped;
        continue;
      }
      result[currentKey] = multilineValue.trimEnd();
      inMultiline = false;
    }

    if (inList) {
      const listMatch = line.match(/^\s+-\s+(.+)/);
      if (listMatch) {
        listItems.push(listMatch[1].trim());
        continue;
      }
      result[listKey] = [...listItems];
      listItems.length = 0;
      inList = false;
    }

    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)/);
    if (!kvMatch) continue;

    const [, key, rawValue] = kvMatch;
    const value = rawValue.trim();

    if (value === "|") {
      currentKey = key;
      multilineValue = "";
      inMultiline = true;
      multilineIndent = 2;
      continue;
    }

    if (value === "") {
      inList = true;
      listKey = key;
      continue;
    }

    result[key] = value;
  }

  if (inMultiline) result[currentKey] = multilineValue.trimEnd();
  if (inList) result[listKey] = [...listItems];

  return result as unknown as AgentTemplate;
}
