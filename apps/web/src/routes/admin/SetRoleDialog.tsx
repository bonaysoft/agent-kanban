import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { authClient } from "../../lib/auth-client";
import { type User } from "./types";

interface Props {
  user: User;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function SetRoleDialog({ user, open, onClose, onSuccess }: Props) {
  const [role, setRole] = useState(user.role);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    const { error } = await (authClient.admin as any).setRole({ userId: user.id, role });
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
          <DialogTitle>Set Role</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-content-tertiary">
          User: <span className="font-mono text-content-primary">{user.email}</span>
        </p>
        <Select value={role} onValueChange={(v) => v && setRole(v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">user</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
          </SelectContent>
        </Select>
        <DialogFooter showCloseButton>
          <Button size="sm" disabled={loading || role === user.role} onClick={handleSubmit}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
