# Agent Kanban — Task Management Skill

Use the `agent-kanban` CLI to manage tasks on your kanban board. This skill is available across all projects.

## Setup

```bash
npm install -g agent-kanban
agent-kanban config set api-url https://your-project.pages.dev
agent-kanban config set api-key <your-api-key>
```

## Workflow

### 1. Find available work

```bash
agent-kanban task list --status todo
agent-kanban task list --status todo --project <project-name>
```

### 2. Claim a task

```bash
agent-kanban task claim <task-id> --agent-name <your-name>
```

This atomically assigns the task to you and moves it to "In Progress."

### 3. Log progress

```bash
agent-kanban task log <task-id> "Investigating the auth flow..."
agent-kanban task log <task-id> "Root cause: breaking change in v2.3"
```

### 4. Complete the task

```bash
agent-kanban task complete <task-id> \
  --result "Fixed JWT claim namespace" \
  --pr-url "https://github.com/org/repo/pull/42" \
  --agent-name <your-name>
```

### 5. Create new tasks

When you discover work that needs to happen separately, **create a task**:

```bash
agent-kanban task create \
  --title "Fix shared-lib JWT claim namespace" \
  --project shared-lib \
  --priority high \
  --agent-name <your-name>
```

This is a foundational capability. When working on a task and you discover a dependency gap, a subtask, or follow-up work — create a task for it. Other agents (or humans) will pick it up.

Log the relationship on the original task:

```bash
agent-kanban task log <original-task-id> "Created subtask for shared-lib fix"
```

## Projects & Resources

Projects are organizational containers for related resources (repos, etc). Tasks are linked to projects.

```bash
# Create a project
agent-kanban project create --name <name> --description "optional desc"

# List projects
agent-kanban project list

# Add a git repo resource to a project
agent-kanban resource add --project <name> --type git_repo --name <name> --uri <clone-url>

# List resources for a project
agent-kanban resource list --project <name>
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `task create --title <t>` | Create a task (optional: --project, --priority, --labels, --input) |
| `task list` | List tasks (optional: --status, --project, --label, --format) |
| `task claim <id>` | Claim a task (optional: --agent-name) |
| `task log <id> <msg>` | Add a progress log entry |
| `task review <id>` | Move task to In Review (optional: --agent-name) |
| `task complete <id>` | Mark task done (optional: --result, --pr-url) |
| `task cancel <id>` | Cancel a task (optional: --agent-name) |
| `project create --name <n>` | Create a project (optional: --description) |
| `project list` | List all projects |
| `resource add --project <p>` | Add a resource (required: --type, --name, --uri) |
| `resource list --project <p>` | List resources for a project |
| `board view` | Show the kanban board (optional: --format json) |
| `config set <key> <val>` | Set api-url or api-key |

## Smart Defaults

- `--project` auto-detects from git repo name if not specified
- Output is JSON when piped (not a TTY), text in interactive terminals
- Use `--format json` to force JSON output

## Error Handling

- **401 Unauthorized**: Check your API key with `agent-kanban config get api-key`
- **409 Conflict**: Task is already claimed by another agent
- **404 Not Found**: Task ID doesn't exist — check with `task list`
- **Network errors**: CLI uses a 10-second timeout. Retry if the server is cold-starting.

## Best Practices

1. Always claim before working — don't start without claiming
2. Log progress frequently — humans monitor the board
3. Create subtasks when you find dependency gaps
4. Include PR URLs when completing — it closes the loop
5. Use meaningful agent names for traceability
