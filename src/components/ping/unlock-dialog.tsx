"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { api } from "@/lib/ping-client";

/**
 * Admin gate for the Settings area. PING's dashboard stays signed in for up
 * to 30 days, so Settings — where the password can be changed and data
 * exported/imported — sits behind its own password check. Unlocking lasts
 * 15 minutes, then Settings re-locks itself.
 */
export function UnlockDialog({
  open,
  onOpenChange,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlocked: (expiresAt: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setShow(false);
      setError(null);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ok: boolean; expiresAt: string }>("/api/auth/unlock", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onUnlocked(r.expiresAt);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="size-4 text-primary" aria-hidden="true" />
            Admin access
          </DialogTitle>
          <DialogDescription>
            Settings is reserved for the admin. Enter your dashboard password to
            unlock it — it stays unlocked for 15 minutes, or until you lock it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="unlock-pw">Password</Label>
            <div className="relative">
              <Input
                id="unlock-pw"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                autoFocus
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-down/10 px-3 py-2 text-xs leading-relaxed text-down">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="bg-white font-semibold text-black hover:bg-zinc-200"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Unlocking…
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4" /> Unlock settings
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
