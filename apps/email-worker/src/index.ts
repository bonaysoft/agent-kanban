// Cloudflare Email Worker — receives mail at *@mails.agent-kanban.dev
// Env is empty for now; D1 binding will be added when inbox storage is implemented.
type Env = Record<string, unknown>;

// GitHub email verification URL patterns
const GITHUB_CONFIRM_PATTERNS = [
  /https:\/\/github\.com\/settings\/emails\/confirm[^\s"'<>]*/g,
  /https:\/\/github\.com\/users\/[^/]+\/emails\/[^/]+\/confirm[^\s"'<>]*/g,
];

function extractGitHubConfirmUrl(body: string): string | null {
  for (const pattern of GITHUB_CONFIRM_PATTERNS) {
    const matches = body.match(pattern);
    if (matches && matches.length > 0) {
      return matches[0];
    }
  }
  return null;
}

export default {
  async email(message: ForwardableEmailMessage, _env: Env): Promise<void> {
    const to = message.to;
    const from = message.headers.get("from") ?? "";

    const rawEmail = await new Response(message.raw).text();

    if (from.includes("github.com")) {
      const confirmUrl = extractGitHubConfirmUrl(rawEmail);
      if (confirmUrl) {
        console.info(`[email-worker] Auto-confirming GitHub email for ${to}: ${confirmUrl}`);
        const resp = await fetch(confirmUrl, { redirect: "follow" });
        console.info(`[email-worker] Confirmation fetch status: ${resp.status}`);
        return;
      }
      console.info(`[email-worker] GitHub email from ${from} to ${to} — no confirmation URL found`);
      return;
    }

    // Non-GitHub email: log and drop (future: store in D1)
    console.info(`[email-worker] Received email from ${from} to ${to} — no action taken`);
  },
} satisfies ExportedHandler<Env>;
