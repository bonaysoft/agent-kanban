import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { authClient } from "../../lib/auth-client";
import { type User } from "./types";

interface Props {
  user: User;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteUserDialog({ user, open, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    const { error } = await (authClient.admin as any).removeUser({ userId: user.id });
    setLoading(false);
    if (!error) {
      onSuccess();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="sm:max-w-xs" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete User</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-content-secondary">
          Delete <span className="font-mono text-content-primary">{user.email}</span>?
        </p>
        <p className="text-xs text-content-tertiary">This action cannot be undone.</p>
        <DialogFooter showCloseButton>
          <Button size="sm" variant="destructive" disabled={loading} onClick={handleDelete}>
            {loading ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
