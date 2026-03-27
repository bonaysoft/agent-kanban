import { useState } from "react";
import { useUpdateBoard } from "../hooks/useBoard";
import { Button } from "./ui/button";

const BASE_URL = "https://ak.tftt.cc";

interface BoardShareSettingsProps {
  board: { id: string; name: string; visibility: "private" | "public"; share_slug: string | null };
}

export function BoardShareSettings({ board }: BoardShareSettingsProps) {
  const updateBoard = useUpdateBoard();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedBadge, setCopiedBadge] = useState(false);

  const isPublic = board.visibility === "public";

  async function toggleVisibility() {
    await updateBoard.mutateAsync({
      id: board.id,
      visibility: isPublic ? "private" : "public",
    });
  }

  async function copyLink() {
    if (!board.share_slug) return;
    await navigator.clipboard.writeText(`${BASE_URL}/share/${board.share_slug}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  async function copyBadge() {
    if (!board.share_slug) return;
    const url = `${BASE_URL}/share/${board.share_slug}`;
    const badgeUrl = `${BASE_URL}/api/share/${board.share_slug}/badge.svg`;
    const markdown = `[![Agent Kanban](${badgeUrl})](${url})`;
    await navigator.clipboard.writeText(markdown);
    setCopiedBadge(true);
    setTimeout(() => setCopiedBadge(false), 2000);
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant={isPublic ? "secondary" : "outline"} size="xs" onClick={toggleVisibility} disabled={updateBoard.isPending} className="gap-1.5">
        {isPublic ? (
          <>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Public
          </>
        ) : (
          <>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Private
          </>
        )}
      </Button>

      {isPublic && board.share_slug && (
        <>
          <Button variant="outline" size="xs" onClick={copyLink} className="gap-1.5">
            {copiedLink ? (
              <>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Copy Link
              </>
            )}
          </Button>

          <Button variant="outline" size="xs" onClick={copyBadge} className="gap-1.5">
            {copiedBadge ? (
              <>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
                Copy Badge
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );
}
