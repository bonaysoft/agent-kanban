import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { authClient } from "../../lib/auth-client";
import { type User } from "./types";

interface Props {
  user: User;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const BAN_EXPIRY_OPTIONS = [
  { label: "1 hour", value: "3600" },
  { label: "24 hours", value: "86400" },
  { label: "7 days", value: "604800" },
  { label: "30 days", value: "2592000" },
  { label: "Permanent", value: "" },
];

export function BanUserDialog({ user, open, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    const params: Record<string, unknown> = { userId: user.id, banReason: reason || undefined };
    if (expiry) params.banExpiresIn = Number(expiry);
    const { error } = await (authClient.admin as any).banUser(params);
    setLoading(false);
    if (!error) {
      onSuccess();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Ban User</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-content-tertiary">
          User: <span className="font-mono text-content-primary">{user.email}</span>
        </p>
        <div className="space-y-3">
          <Textarea placeholder="Ban reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[72px]" />
          <Select value={expiry} onValueChange={(v) => setExpiry(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Duration" />
            </SelectTrigger>
            <SelectContent>
              {BAN_EXPIRY_OPTIONS.map((opt) => (
                <SelectItem key={opt.label} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter showCloseButton>
          <Button size="sm" variant="destructive" disabled={loading} onClick={handleSubmit}>
            {loading ? "Banning…" : "Ban User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
