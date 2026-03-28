import type { Env } from "../api/types";

interface Board {
  name: string;
  description: string | null;
}

interface TaskCounts {
  total: number;
  todo: number;
  in_progress: number;
  in_review: number;
  done: number;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildMetaTags(board: Board, counts: TaskCounts, slug: string): string {
  const title = `${board.name} — Agent Kanban`;
  const description =
    board.description ||
    `${counts.total} tasks: ${counts.done} done, ${counts.in_progress} active, ${counts.in_review} in review, ${counts.todo} todo`;
  const url = `https://agent-kanban.dev/share/${slug}`;

  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:site_name" content="Agent Kanban" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  ].join("\n    ");
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const slug = url.pathname.replace(/^\/share\/?/, "").replace(/\/$/, "");

  // Serve the SPA index.html
  const asset = await context.env.ASSETS.fetch(new URL("/", context.request.url));
  let html = await asset.text();

  if (!slug) {
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // Query board data for meta tag injection
  const board = await context.env.DB.prepare("SELECT name, description FROM boards WHERE share_slug = ? AND visibility = 'public'")
    .bind(slug)
    .first<Board>();

  if (board) {
    const countRow = await context.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) as todo,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) as in_review,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
      FROM tasks t
      JOIN boards b ON t.board_id = b.id
      WHERE b.share_slug = ?
    `)
      .bind(slug)
      .first<TaskCounts>();

    const counts: TaskCounts = countRow || { total: 0, todo: 0, in_progress: 0, in_review: 0, done: 0 };
    const metaTags = buildMetaTags(board, counts, slug);

    // Replace the default <title> with board-specific meta tags
    html = html.replace(/<title>.*?<\/title>/, metaTags);
  }

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
};
