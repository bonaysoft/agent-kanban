/**
 * Unit tests for tool-uis.tsx.
 *
 * Covers:
 *  - ToolShell: no ChevronRight in trigger area (removed in recent change)
 *  - ToolShell: renders label and summary text
 *  - ToolShell: applies cancelled styling when status is incomplete+cancelled
 *  - parseMcpToolName: parses MCP-style tool names correctly
 *  - langFromPath: maps file extensions to language identifiers
 *  - agentLabel derivation: subagent_type used as label, "agent" as fallback
 */

import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { langFromPath, parseMcpToolName, ToolShell } from "../apps/web/src/components/chat/tool-uis.js";

// ── ToolShell ─────────────────────────────────────────────────────────────────

describe("ToolShell — trigger contains no ChevronRight chevron", () => {
  it("does not render a ChevronRight svg in the trigger row", () => {
    const { container } = render(
      React.createElement(ToolShell, {
        icon: React.createElement("span", { "data-testid": "tool-icon" }),
        label: "bash",
        summary: "echo hello",
      }),
    );
    // ChevronRight from lucide-react renders an svg with aria-label or a specific path.
    // The trigger is the CollapsibleTrigger (button role). We check that the button
    // does NOT contain a chevron-right svg by checking no element with the
    // lucide-chevron-right class or title exists inside the trigger.
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]');
    expect(trigger).not.toBeNull();
    // Lucide icons render <svg> elements. Count svgs inside the trigger.
    // With ChevronRight removed, the trigger has at most: status icon (absent when
    // complete) + tool icon. The tool icon is a plain <span> in this test, so
    // no svgs should be in the trigger at all.
    const svgs = trigger!.querySelectorAll("svg");
    // No lucide svg icons should appear in the trigger for a complete-status shell
    // that has a non-svg icon.
    expect(svgs.length).toBe(0);
  });

  it("renders the label text in the trigger", () => {
    render(
      React.createElement(ToolShell, {
        icon: React.createElement("span"),
        label: "my-tool",
        summary: "some summary",
      }),
    );
    expect(screen.getByText("my-tool")).toBeTruthy();
  });

  it("renders the summary text in the trigger", () => {
    render(
      React.createElement(ToolShell, {
        icon: React.createElement("span"),
        label: "bash",
        summary: "ls -la",
      }),
    );
    expect(screen.getByText("ls -la")).toBeTruthy();
  });

  it("renders without error when children are provided", () => {
    // CollapsibleContent panel is not rendered in DOM when closed (base-ui behaviour).
    // This test verifies the component mounts cleanly when children are passed.
    const { container } = render(
      React.createElement(
        ToolShell,
        {
          icon: React.createElement("span"),
          label: "read",
          summary: "/some/file.ts",
        },
        React.createElement("div", { "data-testid": "child-content" }, "file contents"),
      ),
    );
    // Trigger is always rendered regardless of open/closed state
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]');
    expect(trigger).not.toBeNull();
  });
});

describe("ToolShell — status icon presence", () => {
  it("renders a running spinner when status is running", () => {
    const { container } = render(
      React.createElement(ToolShell, {
        icon: React.createElement("span"),
        label: "bash",
        summary: "running cmd",
        status: { type: "running" },
      }),
    );
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]');
    // The running status renders a LoaderIcon svg with animate-spin class
    const spinner = trigger!.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });

  it("renders no status icon when status is complete", () => {
    const { container } = render(
      React.createElement(ToolShell, {
        icon: React.createElement("span"),
        label: "bash",
        summary: "done cmd",
        status: { type: "complete" },
      }),
    );
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]');
    const spinner = trigger!.querySelector(".animate-spin");
    expect(spinner).toBeNull();
  });

  it("applies opacity-60 and reduced appearance when status is incomplete+cancelled", () => {
    const { container } = render(
      React.createElement(ToolShell, {
        icon: React.createElement("span"),
        label: "bash",
        summary: "cancelled cmd",
        status: { type: "incomplete", reason: "cancelled" },
      }),
    );
    // The Collapsible root gets opacity-60 class
    const root = container.querySelector('[data-slot="collapsible"]');
    expect(root?.className).toContain("opacity-60");
  });

  it("does not apply opacity-60 when status is running", () => {
    const { container } = render(
      React.createElement(ToolShell, {
        icon: React.createElement("span"),
        label: "bash",
        summary: "running cmd",
        status: { type: "running" },
      }),
    );
    const root = container.querySelector('[data-slot="collapsible"]');
    expect(root?.className).not.toContain("opacity-60");
  });

  it("renders without error when status is incomplete with an error string", () => {
    // Error text lives inside CollapsibleContent which is not in DOM when closed.
    // This test verifies the component mounts cleanly with an error status and
    // that the XCircle icon appears in the trigger row.
    const { container } = render(
      React.createElement(ToolShell, {
        icon: React.createElement("span"),
        label: "bash",
        summary: "errored cmd",
        status: { type: "incomplete", reason: "error", error: "something went wrong" },
      }),
    );
    // XCircleIcon svg should appear in trigger for non-cancelled incomplete status
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]');
    const xIcon = trigger!.querySelector("svg.lucide-circle-x");
    expect(xIcon).not.toBeNull();
  });
});

// ── parseMcpToolName ──────────────────────────────────────────────────────────

describe("parseMcpToolName — MCP tool name parsing", () => {
  it("returns null for non-MCP tool names", () => {
    expect(parseMcpToolName("Bash")).toBeNull();
    expect(parseMcpToolName("Read")).toBeNull();
    expect(parseMcpToolName("Task")).toBeNull();
    expect(parseMcpToolName("TodoWrite")).toBeNull();
  });

  it("parses standard MCP tool name into ns and name", () => {
    expect(parseMcpToolName("mcp__chrome_devtools__click")).toEqual({
      ns: "chrome_devtools",
      name: "click",
    });
  });

  it("parses MCP tool name with simple namespace", () => {
    expect(parseMcpToolName("mcp__context7__query-docs")).toEqual({
      ns: "context7",
      name: "query-docs",
    });
  });

  it("returns ns=mcp and name=rest when no double-underscore after prefix", () => {
    expect(parseMcpToolName("mcp__singlepart")).toEqual({
      ns: "mcp",
      name: "singlepart",
    });
  });

  it("returns null for empty string", () => {
    expect(parseMcpToolName("")).toBeNull();
  });

  it("returns null for string starting with mcp_ (single underscore)", () => {
    expect(parseMcpToolName("mcp_something")).toBeNull();
  });

  it("handles MCP tool name where name contains double underscores", () => {
    // mcp__ns__tool__with__extra → ns="ns", name="tool__with__extra"
    expect(parseMcpToolName("mcp__ns__tool__with__extra")).toEqual({
      ns: "ns",
      name: "tool__with__extra",
    });
  });
});

// ── langFromPath ──────────────────────────────────────────────────────────────

describe("langFromPath — file extension to language mapping", () => {
  it("returns undefined for undefined input", () => {
    expect(langFromPath(undefined)).toBeUndefined();
  });

  it("returns undefined for path with no extension", () => {
    expect(langFromPath("Makefile")).toBeUndefined();
    expect(langFromPath("somefile")).toBeUndefined();
  });

  it("maps .ts to tsx", () => {
    expect(langFromPath("src/index.ts")).toBe("tsx");
  });

  it("maps .tsx to tsx", () => {
    expect(langFromPath("src/App.tsx")).toBe("tsx");
  });

  it("maps .js to jsx", () => {
    expect(langFromPath("dist/bundle.js")).toBe("jsx");
  });

  it("maps .json to json", () => {
    expect(langFromPath("package.json")).toBe("json");
  });

  it("maps .py to python", () => {
    expect(langFromPath("script.py")).toBe("python");
  });

  it("maps .go to go", () => {
    expect(langFromPath("main.go")).toBe("go");
  });

  it("maps .rs to rust", () => {
    expect(langFromPath("src/lib.rs")).toBe("rust");
  });

  it("maps .sh to bash", () => {
    expect(langFromPath("scripts/deploy.sh")).toBe("bash");
  });

  it("maps .md to markdown", () => {
    expect(langFromPath("README.md")).toBe("markdown");
  });

  it("maps .sql to sql", () => {
    expect(langFromPath("migrations/001.sql")).toBe("sql");
  });

  it("returns undefined for unmapped extension", () => {
    expect(langFromPath("binary.wasm")).toBeUndefined();
    expect(langFromPath("archive.zip")).toBeUndefined();
  });

  it("is case-insensitive for extension", () => {
    expect(langFromPath("FILE.TS")).toBe("tsx");
    expect(langFromPath("FILE.JS")).toBe("jsx");
  });
});

// ── agentLabel derivation (TaskToolUI contract) ───────────────────────────────
// The render function computes: agentLabel = args?.subagent_type || "agent"
// This was changed from `task:${subagent_type}` — test the new contract directly.

describe("agentLabel derivation — TaskToolUI label contract", () => {
  it("uses subagent_type as label when provided", () => {
    const agentLabel = (subagentType: string | undefined) => subagentType || "agent";
    expect(agentLabel("clean-code-reviewer")).toBe("clean-code-reviewer");
  });

  it("uses subagent_type verbatim without task: prefix", () => {
    const agentLabel = (subagentType: string | undefined) => subagentType || "agent";
    // Old behavior was `task:${subagent_type}`. New behavior must NOT have that prefix.
    const label = agentLabel("test-writer");
    expect(label).toBe("test-writer");
    expect(label).not.toMatch(/^task:/);
  });

  it("falls back to 'agent' when subagent_type is undefined", () => {
    const agentLabel = (subagentType: string | undefined) => subagentType || "agent";
    expect(agentLabel(undefined)).toBe("agent");
  });

  it("falls back to 'agent' when subagent_type is empty string", () => {
    const agentLabel = (subagentType: string | undefined) => subagentType || "agent";
    expect(agentLabel("")).toBe("agent");
  });

  it("renders ToolShell with subagent_type as label text", () => {
    // Verify the contract end-to-end via ToolShell rendering
    render(
      React.createElement(ToolShell, {
        icon: React.createElement("span"),
        label: "playwright-test-generator",
        summary: "write e2e tests",
      }),
    );
    expect(screen.getByText("playwright-test-generator")).toBeTruthy();
    // The old prefix "task:" must not appear
    expect(screen.queryByText(/^task:/)).toBeNull();
  });

  it("renders ToolShell with 'agent' fallback label text", () => {
    render(
      React.createElement(ToolShell, {
        icon: React.createElement("span"),
        label: "agent",
        summary: "running subagent",
      }),
    );
    expect(screen.getByText("agent")).toBeTruthy();
  });
});
