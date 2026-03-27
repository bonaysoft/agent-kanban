import { useState } from "react";
import { useUpdateBoard } from "../hooks/useBoard";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu";

interface BoardShareSettingsProps {
  board: { id: string; name: string; visibility: "private" | "public"; share_slug: string | null };
}

export function BoardShareSettings({ board }: BoardShareSettingsProps) {
  const updateBoard = useUpdateBoard();
  const [copied, setCopied] = useState<"link" | "badge" | null>(null);

  const isPublic = board.visibility === "public";
  const origin = window.location.origin;
  const shareUrl = board.share_slug ? `${origin}/share/${board.share_slug}` : null;
  const badgeUrl = board.share_slug ? `${origin}/api/share/${board.share_slug}/badge.svg` : null;

  async function toggleVisibility() {
    await updateBoard.mutateAsync({ id: board.id, visibility: isPublic ? "private" : "public" });
  }

  async function copy(type: "link" | "badge") {
    if (!shareUrl || !badgeUrl) return;
    const text = type === "link" ? shareUrl : `[![Agent Kanban](${badgeUrl})](${shareUrl})`;
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            {isPublic && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent" />}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72 p-3 space-y-3">
        {/* Visibility toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-content-secondary">Visibility</span>
          <Button variant={isPublic ? "secondary" : "outline"} size="xs" onClick={toggleVisibility} disabled={updateBoard.isPending}>
            {isPublic ? "Public" : "Private"}
          </Button>
        </div>

        {/* Share links — only when public */}
        {isPublic && shareUrl && (
          <>
            <div className="space-y-1.5">
              <span className="text-xs text-content-tertiary">Share link</span>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 text-[11px] text-content-secondary bg-surface-primary px-2 py-1 rounded border border-border truncate">
                  {shareUrl}
                </code>
                <Button variant="outline" size="xs" onClick={() => copy("link")} className="shrink-0">
                  {copied === "link" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-content-tertiary">Badge for README</span>
              <Button variant="outline" size="xs" onClick={() => copy("badge")}>
                {copied === "badge" ? "Copied" : "Copy Badge"}
              </Button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
