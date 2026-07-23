"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errMsg } from "@/lib/api";
import { useChangePassword } from "@/lib/queries";

/** Matches the backend's `min_length=8` on ChangePasswordRequest. */
const MIN_LENGTH = 8;

/**
 * Self-service password change for the signed-in account.
 *
 * Not rendered for class-rep logins — those are one shared account per class,
 * so letting any student holding it rotate the password would lock out the
 * rest of the class. The backend refuses them too (403); this just keeps the
 * UI from offering it. See `routers/auth.py::change_password`.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  /**
   * Never leave a typed password sitting in state after the dialog closes.
   *
   * Done in the close path rather than an `open`-watching effect: clearing
   * state from an effect body triggers a second render pass for every close
   * (react-hooks/set-state-in-effect), and closing is already an event we
   * control.
   */
  const close = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    onOpenChange(false);
  }, [onOpenChange]);

  const handleOpenChange = useCallback(
    (next: boolean) => (next ? onOpenChange(true) : close()),
    [close, onOpenChange],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error("Enter your current and new password.");
      return;
    }
    if (newPassword.length < MIN_LENGTH) {
      toast.error(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirm) {
      toast.error("The new passwords don't match.");
      return;
    }
    void (async () => {
      try {
        await changePassword.mutateAsync({ currentPassword, newPassword });
        toast.success("Password changed.");
        close();
      } catch (err) {
        toast.error(errMsg(err));
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              You stay signed in on this device after changing it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-current">Current password</Label>
              <Input
                id="cp-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-new">New password</Label>
              <Input
                id="cp-new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                At least {MIN_LENGTH} characters.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-confirm">Confirm new password</Label>
              <Input
                id="cp-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={changePassword.isPending}>
              {changePassword.isPending ? "Changing…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
