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
  WebSearchResult,
  WriteArgs,
} from "@agent-kanban/shared";
import { ToolName } from "@agent-kanban/shared";
import { makeAssistantToolUI, type ToolCallMessagePartStatus } from "@assistant-ui/react";
import {
  AlertCircleIcon,
  Brain,
  ChevronRight,
  ClipboardList,
  FileSearch,
  FileText,
  Globe,
  HelpCircle,
  LoaderIcon,
  Notebook,
  Pencil,
  Search,
  SlashSquare,
  Terminal,
  Wrench,
  XCircleIcon,
} from "lucide-react";
import { Highlight, themes as prismThemes } from "prism-react-renderer";
import { type FC, type ReactNode, useSyncExternalStore } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { SubtaskChild, TaskToolResult } from "../RelayRuntimeProvider";

// ─── Shared shell ───────────────────────────────────────────────────────────
// Compact collapsible row: [status icon] [tool-icon] LABEL summary…
// Built directly on Collapsible primitive so the trigger row is fully custom.

interface ToolShellProps {
  icon: ReactNode;
  label: string;
  summary: ReactNode;
  status?: ToolCallMessagePartStatus;
  children?: ReactNode;
}

const StatusIcon: FC<{ status?: ToolCallMessagePartStatus }> = ({ status }) => {
  if (!status || status.type === "complete") return null;
  if (status.type === "running") return <LoaderIcon className="size-3 shrink-0 animate-spin text-content-tertiary" />;
  if (status.type === "requires-action") return <AlertCircleIcon className="size-3 shrink-0 text-accent" />;
  if (status.type === "incomplete")
    return <XCircleIcon className={cn("size-3 shrink-0", status.reason === "cancelled" ? "text-content-tertiary" : "text-destructive")} />;
  return null;
};

const ToolShell: FC<ToolShellProps> = ({ icon, label, summary, status, children }) => {
  const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";
  const errorText =
    status?.type === "incomplete" && status.error ? (typeof status.error === "string" ? status.error : JSON.stringify(status.error)) : null;
  return (
    <Collapsible className={cn("group/tool w-full", isCancelled && "opacity-60")}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/40">
        <StatusIcon status={status} />
        <span className="shrink-0 text-content-tertiary">{icon}</span>
        <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide text-content-secondary">{label}</span>
        <span className={cn("min-w-0 flex-1 font-mono text-content-primary break-words", isCancelled && "line-through")}>{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="pl-6 pr-1.5 pt-2 pb-2 overflow-x-hidden">
          {errorText && (
            <div className="mb-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">{errorText}</div>
          )}
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

// ─── Theme detection ────────────────────────────────────────────────────────
// Subscribes to `.dark` class changes on <html> so diff viewer and syntax
// highlighter switch themes in sync with the rest of the app.

function subscribeDarkMode(cb: () => void): () => void {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
function getDarkModeSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}
function useIsDarkMode(): boolean {
  return useSyncExternalStore(
    subscribeDarkMode,
    getDarkModeSnapshot,
    () => false, // SSR fallback — light by default
  );
}

// ─── CodeBlock ───────────────────────────────────────────────────────────────
// Syntax-highlighted, via prism-react-renderer. Falls back to plain pre if
// lang is omitted. `plain` skips tokenization entirely (for raw shell output
// where pretending to highlight adds nothing).

const EXT_TO_LANG: Record<string, string> = {
  ts: "tsx",
  tsx: "tsx",
  js: "jsx",
  jsx: "jsx",
  mjs: "jsx",
  cjs: "jsx",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  sql: "sql",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  css: "css",
  scss: "scss",
};

export function langFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const m = path.match(/\.([a-z0-9]+)$/i);
  return m ? EXT_TO_LANG[m[1].toLowerCase()] : undefined;
}

interface CodeBlockProps {
  children: string;
  lang?: string;
  className?: string;
  /** Skip tokenization — use for raw terminal output. */
  plain?: boolean;
}

const CodeBlock: FC<CodeBlockProps> = ({ children, lang, className, plain }) => {
  const isDark = useIsDarkMode();
  const baseCls =
    "max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap break-all";

  if (plain || !lang) {
    return <pre className={cn(baseCls, "text-content-primary", className)}>{children}</pre>;
  }

  const theme = isDark ? prismThemes.vsDark : prismThemes.vsLight;
  return (
    <Highlight theme={theme} code={children} language={lang}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className={cn(baseCls, "!bg-muted/30", className)}>
          {tokens.map((line, i) => {
            const { key: _lineKey, ...lineProps } = getLineProps({ line });
            return (
              <div key={i} {...lineProps}>
                {line.map((token, j) => {
                  const { key: _tokenKey, ...tokenProps } = getTokenProps({ token });
                  return <span key={j} {...tokenProps} />;
                })}
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
};

// Kept as an alias so other tools (Mono-style plain output) still read well.
const Mono: FC<{ children: ReactNode; className?: string }> = ({ children, className }) => (
  <CodeBlock plain className={className}>
    {typeof children === "string" ? children : String(children)}
  </CodeBlock>
);

// Coerce a tool result (which may be string / object / { error }) into plain
// text. Keeps the per-tool UIs free of this plumbing.
function resultText(result: unknown): string | null {
  if (result == null) return null;
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.error === "string") return r.error;
    if (typeof r.output === "string") return r.output;
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}

// ─── Bash ────────────────────────────────────────────────────────────────────

export const BashToolUI = makeAssistantToolUI<BashArgs, string>({
  toolName: ToolName.Bash,
  render: ({ args, result, status }) => {
    const cmd = args?.command ?? "";
    const out = resultText(result);
    return (
      <ToolShell icon={<Terminal className="size-3.5" />} label="bash" status={status} summary={<span className="text-accent">$ {cmd}</span>}>
        {args?.description && <div className="mb-1 text-[11px] text-content-tertiary italic">{args.description}</div>}
        <CodeBlock lang="bash">{`$ ${cmd}${out ? `\n${out}` : ""}`}</CodeBlock>
      </ToolShell>
    );
  },
});

// ─── Read ────────────────────────────────────────────────────────────────────

export const ReadToolUI = makeAssistantToolUI<ReadArgs, string>({
  toolName: ToolName.Read,
  render: ({ args, result, status }) => {
    const range = args?.offset ? `:${args.offset}${args.limit ? `-${args.offset + args.limit}` : ""}` : "";
    const out = resultText(result);
    return (
      <ToolShell
        icon={<FileText className="size-3.5" />}
        label="read"
        status={status}
        summary={
          <>
            {args?.filePath}
            <span className="text-content-tertiary">{range}</span>
          </>
        }
      >
        {out && <CodeBlock lang={langFromPath(args?.filePath)}>{out}</CodeBlock>}
      </ToolShell>
    );
  },
});

// ─── Edit ────────────────────────────────────────────────────────────────────

// Palettes for the diff viewer. Keyed on dark-mode flag. Intentionally
// ignores the rdv built-in themes because they use flat reds/greens that
// blow out contrast against the chat surface.
const DIFF_PALETTE = {
  dark: {
    diffViewerBackground: "transparent",
    diffViewerColor: "#FAFAFA",
    addedBackground: "rgba(34, 197, 94, 0.14)",
    addedColor: "#86efac",
    removedBackground: "rgba(239, 68, 68, 0.14)",
    removedColor: "#fca5a5",
    wordAddedBackground: "rgba(34, 197, 94, 0.35)",
    wordRemovedBackground: "rgba(239, 68, 68, 0.35)",
    addedGutterBackground: "rgba(34, 197, 94, 0.20)",
    removedGutterBackground: "rgba(239, 68, 68, 0.20)",
    gutterBackground: "transparent",
    gutterBackgroundDark: "transparent",
    highlightBackground: "rgba(255, 255, 255, 0.04)",
    highlightGutterBackground: "rgba(255, 255, 255, 0.06)",
    codeFoldGutterBackground: "transparent",
    codeFoldBackground: "transparent",
    emptyLineBackground: "transparent",
    gutterColor: "rgba(255, 255, 255, 0.35)",
    addedGutterColor: "rgba(134, 239, 172, 0.85)",
    removedGutterColor: "rgba(252, 165, 165, 0.85)",
    codeFoldContentColor: "rgba(255, 255, 255, 0.5)",
    diffViewerTitleBackground: "transparent",
    diffViewerTitleColor: "rgba(255, 255, 255, 0.6)",
    diffViewerTitleBorderColor: "rgba(255, 255, 255, 0.1)",
  },
  light: {
    diffViewerBackground: "transparent",
    diffViewerColor: "#09090B",
    addedBackground: "rgba(34, 197, 94, 0.12)",
    addedColor: "#166534",
    removedBackground: "rgba(239, 68, 68, 0.12)",
    removedColor: "#991b1b",
    wordAddedBackground: "rgba(34, 197, 94, 0.32)",
    wordRemovedBackground: "rgba(239, 68, 68, 0.32)",
    addedGutterBackground: "rgba(34, 197, 94, 0.18)",
    removedGutterBackground: "rgba(239, 68, 68, 0.18)",
    gutterBackground: "transparent",
    gutterBackgroundDark: "transparent",
    highlightBackground: "rgba(0, 0, 0, 0.04)",
    highlightGutterBackground: "rgba(0, 0, 0, 0.06)",
    codeFoldGutterBackground: "transparent",
    codeFoldBackground: "transparent",
    emptyLineBackground: "transparent",
    gutterColor: "rgba(9, 9, 11, 0.45)",
    addedGutterColor: "rgba(22, 101, 52, 0.85)",
    removedGutterColor: "rgba(153, 27, 27, 0.85)",
    codeFoldContentColor: "rgba(9, 9, 11, 0.55)",
    diffViewerTitleBackground: "transparent",
    diffViewerTitleColor: "rgba(9, 9, 11, 0.6)",
    diffViewerTitleBorderColor: "rgba(9, 9, 11, 0.1)",
  },
};

/**
 * Reusable single-hunk unified diff backed by react-diff-viewer-continued.
 * Provides: line numbers, word-level highlight, split/unified toggle, and
 * automatic light/dark theming.
 */
const FileDiff: FC<{ oldStr: string; newStr: string }> = ({ oldStr, newStr }) => {
  const isDark = useIsDarkMode();
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-background/60 text-[11px] [&_pre]:!font-mono [&_pre]:!text-[11px] [&_pre]:!leading-[1.55]">
      <ReactDiffViewer
        oldValue={oldStr}
        newValue={newStr}
        splitView={false}
        hideLineNumbers={false}
        compareMethod={DiffMethod.WORDS}
        useDarkTheme={isDark}
        styles={{
          variables: {
            dark: DIFF_PALETTE.dark,
            light: DIFF_PALETTE.light,
          },
          contentText: { fontFamily: "inherit" },
          gutter: { minWidth: "2.5em", padding: "0 0.5em" },
        }}
      />
    </div>
  );
};

export const EditToolUI = makeAssistantToolUI<EditArgs, string>({
  toolName: ToolName.Edit,
  render: ({ args, result, status }) => {
    const oldCount = (args?.oldString ?? "").split("\n").length;
    const newCount = (args?.newString ?? "").split("\n").length;
    const out = resultText(result);
    return (
      <ToolShell
        icon={<Pencil className="size-3.5" />}
        label="edit"
        status={status}
        summary={
          <>
            {args?.filePath}{" "}
            <span className="text-content-tertiary">
              −{oldCount} +{newCount}
            </span>
          </>
        }
      >
        <FileDiff oldStr={args?.oldString ?? ""} newStr={args?.newString ?? ""} />
        {out && <div className="mt-1 text-[11px] text-content-tertiary">{out}</div>}
      </ToolShell>
    );
  },
});

// ─── MultiEdit ───────────────────────────────────────────────────────────────

export const MultiEditToolUI = makeAssistantToolUI<MultiEditArgs, string>({
  toolName: ToolName.MultiEdit,
  render: ({ args, result, status }) => {
    const edits = args?.edits ?? [];
    const out = resultText(result);
    return (
      <ToolShell
        icon={<Pencil className="size-3.5" />}
        label="multi-edit"
        status={status}
        summary={
          <>
            {args?.filePath} <span className="text-content-tertiary">{edits.length} edits</span>
          </>
        }
      >
        <div className="space-y-2">
          {edits.map((e, i) => (
            <div key={i}>
              <div className="mb-1 text-[10px] font-mono uppercase tracking-wide text-content-tertiary">edit {i + 1}</div>
              <FileDiff oldStr={e.oldString} newStr={e.newString} />
            </div>
          ))}
        </div>
        {out && <div className="mt-1 text-[11px] text-content-tertiary">{out}</div>}
      </ToolShell>
    );
  },
});

// ─── Write ───────────────────────────────────────────────────────────────────

export const WriteToolUI = makeAssistantToolUI<WriteArgs, string>({
  toolName: ToolName.Write,
  render: ({ args, status }) => {
    const content = args?.content ?? "";
    const lineCount = content.split("\n").length;
    return (
      <ToolShell
        icon={<Pencil className="size-3.5" />}
        label="write"
        status={status}
        summary={
          <>
            {args?.filePath} <span className="text-content-tertiary">+{lineCount}</span>
          </>
        }
      >
        <CodeBlock lang={langFromPath(args?.filePath)}>{content}</CodeBlock>
      </ToolShell>
    );
  },
});

// ─── Grep ────────────────────────────────────────────────────────────────────

export const GrepToolUI = makeAssistantToolUI<GrepArgs, string>({
  toolName: ToolName.Grep,
  render: ({ args, result, status }) => {
    const out = resultText(result);
    return (
      <ToolShell
        icon={<Search className="size-3.5" />}
        label="grep"
        status={status}
        summary={
          <>
            <span className="text-accent">/{args?.pattern}/</span>
            {args?.path && <span className="text-content-tertiary"> in {args.path}</span>}
            {args?.glob && <span className="text-content-tertiary"> ({args.glob})</span>}
          </>
        }
      >
        {out && <Mono>{out}</Mono>}
      </ToolShell>
    );
  },
});

// ─── Glob ────────────────────────────────────────────────────────────────────

export const GlobToolUI = makeAssistantToolUI<GlobArgs, string>({
  toolName: ToolName.Glob,
  render: ({ args, result, status }) => {
    const out = resultText(result);
    return (
      <ToolShell
        icon={<FileSearch className="size-3.5" />}
        label="glob"
        status={status}
        summary={
          <>
            {args?.pattern}
            {args?.path && <span className="text-content-tertiary"> in {args.path}</span>}
          </>
        }
      >
        {out && <Mono>{out}</Mono>}
      </ToolShell>
    );
  },
});

// ─── Task (sub-agent) ────────────────────────────────────────────────────────

type TaskToolResultShape = Partial<TaskToolResult>;

// Normalize result: may be legacy string or rich TaskToolResult.
function coerceTaskResult(result: unknown): TaskToolResultShape {
  if (result == null) return {};
  if (typeof result === "string") return { text: result };
  if (typeof result === "object") return result as TaskToolResultShape;
  return {};
}

const SubtaskChildren: FC<{ items: SubtaskChild[] }> = ({ items: children }) => {
  if (!children.length) return null;
  return (
    <Collapsible className="group/subchildren mt-2">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[11px] text-content-tertiary transition-colors hover:text-content-secondary">
        <ChevronRight className="size-3 transition-transform group-data-[state=open]/subchildren:rotate-90" />
        <span>subagent steps ({children.length})</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="mt-1 flex flex-col gap-1 border-l border-border/60 pl-2">
          {children.map((c, i) => {
            if (c.kind === "text") return <Markdown key={i} text={c.text} />;
            if (c.kind === "thinking")
              return (
                <div key={i} className="italic text-content-tertiary text-[11px]">
                  {c.text}
                </div>
              );
            if (c.kind === "tool_use") {
              const inputPreview = c.input ? JSON.stringify(c.input).slice(0, 120) : "";
              return (
                <div key={i} className="flex items-baseline gap-1.5 text-[11px]">
                  <Wrench className="size-3 shrink-0 text-content-tertiary" />
                  <span className="font-mono text-content-secondary">{c.name}</span>
                  {inputPreview && <span className="min-w-0 truncate font-mono text-content-tertiary">{inputPreview}</span>}
                </div>
              );
            }
            // tool_result
            if (c.output) {
              return (
                <div key={i} className={cn("text-[11px]", c.error && "text-destructive")}>
                  <Mono>{c.output.slice(0, 400)}</Mono>
                </div>
              );
            }
            return null;
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export const TaskToolUI = makeAssistantToolUI<TaskArgs, TaskToolResultShape | string>({
  toolName: ToolName.Agent,
  render: ({ args, result, status }) => {
    const r = coerceTaskResult(result);
    const metaParts: string[] = [];
    if (r.meta?.tokens != null) metaParts.push(`${r.meta.tokens} tok`);
    if (r.meta?.duration_ms != null) metaParts.push(`${Math.round(r.meta.duration_ms / 1000)}s`);
    if (r.meta?.last_tool) metaParts.push(r.meta.last_tool);
    const agentLabel = args?.subagentType || "agent";
    return (
      <ToolShell icon={<Brain className="size-3.5" />} label={agentLabel} status={status} summary={args?.description}>
        <div className="mb-1 text-[11px] text-content-tertiary">prompt:</div>
        <Mono>{args?.prompt}</Mono>
        {r.children && r.children.length > 0 && <SubtaskChildren items={r.children} />}
        {r.text && (
          <>
            <div className="mt-2 mb-1 text-[11px] text-content-tertiary">report:</div>
            <Markdown text={r.text} />
          </>
        )}
        {metaParts.length > 0 && <div className="mt-2 text-[10px] font-mono text-content-tertiary">{metaParts.join(" · ")}</div>}
      </ToolShell>
    );
  },
});

// ─── TodoWrite ───────────────────────────────────────────────────────────────

export const TodoWriteToolUI = makeAssistantToolUI<TodoArgs, string>({
  toolName: ToolName.TodoWrite,
  render: ({ args, status }) => {
    const todos = args?.todos ?? [];
    const done = todos.filter((t) => t.status === "completed").length;
    return (
      <ToolShell
        icon={<Wrench className="size-3.5" />}
        label="todos"
        status={status}
        summary={
          <span className="text-content-tertiary">
            {done}/{todos.length} done
          </span>
        }
      >
        <ul className="space-y-0.5 text-[11px]">
          {todos.map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 font-mono",
                  t.status === "completed" && "text-emerald-600",
                  t.status === "in_progress" && "text-accent",
                  t.status === "pending" && "text-content-tertiary",
                )}
              >
                {t.status === "completed" ? "✓" : t.status === "in_progress" ? "→" : "○"}
              </span>
              <span className={cn(t.status === "completed" && "text-content-tertiary line-through")}>{t.content}</span>
            </li>
          ))}
        </ul>
      </ToolShell>
    );
  },
});

// ─── WebFetch ────────────────────────────────────────────────────────────────

export const WebFetchToolUI = makeAssistantToolUI<WebFetchArgs, string>({
  toolName: ToolName.WebFetch,
  render: ({ args, result, status }) => {
    const out = resultText(result);
    let host = "";
    try {
      host = new URL(args?.url ?? "").host;
    } catch {
      host = args?.url ?? "";
    }
    return (
      <ToolShell icon={<Globe className="size-3.5" />} label="web-fetch" status={status} summary={<span className="text-accent">{host}</span>}>
        <div className="mb-1 break-all text-[11px] text-content-tertiary">{args?.url}</div>
        {args?.prompt && (
          <>
            <div className="mb-1 text-[10px] font-mono uppercase tracking-wide text-content-tertiary">prompt</div>
            <div className="mb-2 text-[11px] text-content-secondary italic">{args.prompt}</div>
          </>
        )}
        {out && (
          <>
            <div className="mb-1 text-[10px] font-mono uppercase tracking-wide text-content-tertiary">response</div>
            <Markdown text={out} />
          </>
        )}
      </ToolShell>
    );
  },
});

// ─── WebSearch ───────────────────────────────────────────────────────────────

export const WebSearchToolUI = makeAssistantToolUI<WebSearchArgs, WebSearchResult>({
  toolName: ToolName.WebSearch,
  render: ({ args, result, status }) => {
    const results = Array.isArray(result) ? result : null;
    return (
      <ToolShell
        icon={<Search className="size-3.5" />}
        label="web-search"
        status={status}
        summary={<span className="text-accent">{args?.query}</span>}
      >
        {results ? (
          <ul className="space-y-1.5 text-[11px]">
            {results.map((r, i) => (
              <li key={i} className="border-l-2 border-border/60 pl-2">
                {r.title && <div className="font-medium text-content-primary">{r.title}</div>}
                {r.url && <div className="break-all text-accent text-[10px]">{r.url}</div>}
                {r.snippet && <div className="text-content-secondary">{r.snippet}</div>}
              </li>
            ))}
          </ul>
        ) : (
          result != null && <Mono>{resultText(result)}</Mono>
        )}
      </ToolShell>
    );
  },
});

// ─── AskUserQuestion ─────────────────────────────────────────────────────────

export const AskUserQuestionToolUI = makeAssistantToolUI<AskUserQuestionArgs, string>({
  toolName: ToolName.AskUserQuestion,
  render: ({ args, status }) => {
    const questions = args?.questions ?? [];
    return (
      <ToolShell
        icon={<HelpCircle className="size-3.5" />}
        label="ask"
        status={status}
        summary={<span className="text-content-primary">{questions[0]?.question ?? (questions.length > 0 ? "question" : "")}</span>}
      >
        <div className="space-y-3">
          {questions.map((q, qi) => (
            <div key={qi} className="rounded border border-accent/30 bg-accent/5 p-2">
              {q.header && <div className="mb-1 text-[10px] font-mono uppercase tracking-wide text-content-tertiary">{q.header}</div>}
              <div className="mb-2 text-[12px] font-medium text-content-primary">{q.question}</div>
              {q.options && q.options.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {q.options.map((opt, oi) => (
                    <span
                      key={oi}
                      className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-content-secondary"
                      title={opt.description}
                    >
                      {opt.label ?? opt.description}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ToolShell>
    );
  },
});

// ─── ExitPlanMode ────────────────────────────────────────────────────────────

export const ExitPlanModeToolUI = makeAssistantToolUI<ExitPlanModeArgs, string>({
  toolName: ToolName.ExitPlanMode,
  render: ({ args, status }) => (
    <ToolShell
      icon={<ClipboardList className="size-3.5" />}
      label="plan"
      status={status}
      summary={<span className="text-content-tertiary">proposed plan</span>}
    >
      <Markdown text={args?.plan ?? ""} />
    </ToolShell>
  ),
});

// ─── SlashCommand ────────────────────────────────────────────────────────────

export const SlashCommandToolUI = makeAssistantToolUI<SlashCommandArgs, string>({
  toolName: ToolName.SlashCommand,
  render: ({ args, result, status }) => {
    const out = resultText(result);
    return (
      <ToolShell
        icon={<SlashSquare className="size-3.5" />}
        label="slash"
        status={status}
        summary={<span className="text-accent">/{args?.command?.replace(/^\//, "")}</span>}
      >
        {out && <Mono>{out}</Mono>}
      </ToolShell>
    );
  },
});

// ─── NotebookEdit ────────────────────────────────────────────────────────────

export const NotebookEditToolUI = makeAssistantToolUI<NotebookEditArgs, string>({
  toolName: ToolName.NotebookEdit,
  render: ({ args, status }) => {
    const mode = args?.editMode ?? "replace";
    return (
      <ToolShell
        icon={<Notebook className="size-3.5" />}
        label={`nb:${mode}`}
        status={status}
        summary={
          <>
            {args?.notebookPath}
            {args?.cellId && <span className="text-content-tertiary"> #{args.cellId}</span>}
          </>
        }
      >
        <CodeBlock lang={args?.cellType === "markdown" ? "markdown" : "python"}>{args?.newSource ?? ""}</CodeBlock>
      </ToolShell>
    );
  },
});

// ─── Markdown helper (local; keeps tool-uis self-contained) ──────────────────

const Markdown: FC<{ text: string }> = ({ text }) => (
  <div className="prose prose-sm max-w-none text-[12px] leading-relaxed [&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_pre]:my-1.5 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-border/60 [&_pre]:bg-muted/30 [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-[13px] [&_h2]:font-semibold">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
  </div>
);

// Re-export the ToolShell primitive + MCP-aware label parser for
// ChatToolFallback (so generic/MCP tools get the same compact header).
export { Mono, ToolShell };

/**
 * Split a Claude Code MCP tool name into namespace + tool parts.
 * `mcp__chrome_devtools__click` → { ns: "chrome_devtools", name: "click" }
 * Returns null for non-MCP names.
 */
export function parseMcpToolName(toolName: string): { ns: string; name: string } | null {
  if (!toolName.startsWith("mcp__")) return null;
  const rest = toolName.slice(5);
  const idx = rest.indexOf("__");
  if (idx === -1) return { ns: "mcp", name: rest };
  return { ns: rest.slice(0, idx), name: rest.slice(idx + 2) };
}

// ─── Mount ───────────────────────────────────────────────────────────────────
// Drop this inside an AssistantRuntimeProvider to register every per-tool UI.
// Any tool_call whose name matches routes to its renderer; unmatched calls
// fall through to ChatToolFallback.

export const ChatToolUIs: FC = () => (
  <>
    <BashToolUI />
    <ReadToolUI />
    <EditToolUI />
    <MultiEditToolUI />
    <WriteToolUI />
    <GrepToolUI />
    <GlobToolUI />
    <TaskToolUI />
    <TodoWriteToolUI />
    <WebFetchToolUI />
    <WebSearchToolUI />
    <AskUserQuestionToolUI />
    <ExitPlanModeToolUI />
    <SlashCommandToolUI />
    <NotebookEditToolUI />
  </>
);
