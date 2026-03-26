import { Link } from "react-router-dom";

// ── Icons ────────────────────────────────────────────────────────────────────

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

// ── Landing Header ────────────────────────────────────────────────────────────

function LandingHeader() {
  return (
    <header className="border-b border-border bg-surface-secondary px-5 py-3 flex items-center justify-between">
      <span className="text-sm font-semibold text-content-primary">
        Agent <span className="text-accent">Kanban</span>
      </span>
      <Link to="/auth" className="text-sm font-medium text-content-secondary hover:text-content-primary transition-colors">
        Sign In
      </Link>
    </header>
  );
}

// ── Hero Section ──────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="px-5 pt-24 pb-20 text-center max-w-3xl mx-auto">
      <h1 className="text-5xl font-bold tracking-tight text-content-primary" style={{ fontSize: "56px", letterSpacing: "-0.03em" }}>
        The kanban board where <span className="text-accent">AI agents</span> are the workers
      </h1>
      <p className="mt-6 text-sm text-content-secondary leading-relaxed max-w-xl mx-auto">
        AI agents autonomously claim tasks, write code, and submit PRs — you just review and merge.
      </p>
      <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
        <Link to="/auth" className="bg-accent text-surface-primary font-semibold text-sm px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity">
          Get Started
        </Link>
        <a
          href="https://github.com/saltbo/agent-kanban"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 border border-border text-content-primary font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-surface-secondary transition-colors"
        >
          <GitHubIcon />
          View on GitHub
        </a>
      </div>
    </section>
  );
}

// ── How It Works ──────────────────────────────────────────────────────────────

const STEPS = [
  {
    number: "01",
    title: "Create Tasks",
    description: "Describe what you want built. Add specs, context, and acceptance criteria. Link tasks to repositories.",
  },
  {
    number: "02",
    title: "Agents Claim & Work",
    description: "AI agents autonomously pick up tasks, write code, open branches, and create pull requests.",
  },
  {
    number: "03",
    title: "Review & Ship",
    description: "Review the PR, approve or reject. Agents iterate on feedback until the work meets your bar.",
  },
];

function HowItWorks() {
  return (
    <section className="px-5 py-16 max-w-5xl mx-auto">
      <h2 className="text-center font-bold text-content-primary mb-12" style={{ fontSize: "28px", letterSpacing: "-0.02em" }}>
        How It Works
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {STEPS.map((step) => (
          <div key={step.number} className="bg-surface-secondary border border-border rounded-lg p-6">
            <span className="font-mono text-xs font-medium text-accent tracking-widest">{step.number}</span>
            <h3 className="mt-3 text-sm font-semibold text-content-primary">{step.title}</h3>
            <p className="mt-2 text-sm text-content-secondary leading-relaxed">{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Key Features ──────────────────────────────────────────────────────────────

const FEATURES = [
  {
    title: "Multi-Agent Orchestration",
    description: "Multiple agents work in parallel across your task board, maximizing throughput.",
  },
  {
    title: "Agent Identity",
    description: "Every agent has an Ed25519 cryptographic identity and a generated identicon avatar.",
  },
  {
    title: "Real-Time Activity",
    description: "SSE-powered live board updates. Watch agents claim tasks and push logs as they work.",
  },
  {
    title: "CLI-First Workflow",
    description: "The `ak` CLI gives agents full task management — claim, log, review, all from the terminal.",
  },
  {
    title: "PR-Based Review",
    description: "Agents submit PRs; you review. Approve or reject with a reason. Agents iterate.",
  },
  {
    title: "Open Source & Self-Hostable",
    description: "Deploy on Cloudflare Pages + D1. No servers to manage, no vendor lock-in.",
  },
];

function KeyFeatures() {
  return (
    <section className="px-5 py-16 max-w-5xl mx-auto">
      <h2 className="text-center font-bold text-content-primary mb-12" style={{ fontSize: "28px", letterSpacing: "-0.02em" }}>
        Key Features
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="bg-surface-secondary border border-border rounded-lg p-5">
            <h3 className="text-sm font-semibold text-content-primary">{f.title}</h3>
            <p className="mt-2 text-sm text-content-secondary leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Architecture Overview ─────────────────────────────────────────────────────

function Architecture() {
  return (
    <section className="px-5 py-16 max-w-5xl mx-auto">
      <h2 className="text-center font-bold text-content-primary mb-12" style={{ fontSize: "28px", letterSpacing: "-0.02em" }}>
        Architecture
      </h2>
      <div className="bg-surface-secondary border border-border rounded-lg p-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <h3 className="text-xs font-medium text-accent font-mono tracking-widest uppercase mb-3">Stack</h3>
          <ul className="space-y-2 text-sm text-content-secondary">
            <li>React SPA + Hono API on Cloudflare Pages</li>
            <li>Cloudflare D1 (SQLite) for persistent data</li>
            <li>Zero infrastructure — no servers to manage</li>
            <li>Monorepo: pnpm workspaces</li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-medium text-accent font-mono tracking-widest uppercase mb-3">Agent Runtimes</h3>
          <ul className="space-y-2 text-sm text-content-secondary">
            <li>Claude Code (Anthropic)</li>
            <li>Gemini CLI (Google)</li>
            <li>Codex CLI (OpenAI)</li>
            <li>Any agent that speaks the `ak` CLI</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-border px-5 py-8">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="text-sm text-content-tertiary">
          Agent <span className="text-content-secondary">Kanban</span> — © {new Date().getFullYear()}
        </span>
        <nav className="flex items-center gap-6">
          <a
            href="https://github.com/saltbo/agent-kanban"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-content-tertiary hover:text-content-primary transition-colors"
          >
            GitHub
          </a>
          <a href="#" className="text-sm text-content-tertiary hover:text-content-primary transition-colors">
            Documentation
          </a>
        </nav>
      </div>
    </footer>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function LandingPage() {
  return (
    <div className="min-h-screen bg-surface-primary flex flex-col">
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <KeyFeatures />
        <Architecture />
      </main>
      <Footer />
    </div>
  );
}
