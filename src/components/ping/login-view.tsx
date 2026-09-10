"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/ping-client";
import { PingLogo, PingWordmark } from "./ping-logo";

export function LoginView({
  initialized,
  onAuthenticated,
}: {
  initialized: boolean;
  onAuthenticated: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSetup = !initialized;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (isSetup) {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match.");
        return;
      }
    } else if (!password) {
      setError("Enter your password.");
      return;
    }

    setBusy(true);
    try {
      await api(isSetup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onAuthenticated();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Something went wrong — try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ping-ambient relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="ping-fade-up relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <PingLogo className="size-14 ping-breathe" />
          <div className="flex items-baseline gap-1.5">
            <PingWordmark className="text-2xl" />
            <span className="text-sm text-muted-foreground">for Render Free</span>
          </div>
          <p className="max-w-[280px] text-sm leading-relaxed text-muted-foreground">
            Lightweight, honest uptime monitoring. Real HTTP checks — no invented
            statistics, no uptime guarantees.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-xl border bg-card p-5 shadow-lg shadow-black/30"
        >
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            {isSetup ? (
              <ShieldCheck className="size-4 text-teal" aria-hidden="true" />
            ) : (
              <LockKeyhole className="size-4 text-primary" aria-hidden="true" />
            )}
            {isSetup ? "Create your dashboard password" : "Sign in to PING"}
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="password">{isSetup ? "Password" : "Password"}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSetup ? "At least 8 characters" : "••••••••"}
                  autoComplete={isSetup ? "new-password" : "current-password"}
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

            {isSetup && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type={show ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat it"
                  autoComplete="new-password"
                />
              </div>
            )}

            {error && (
              <p className="rounded-md bg-down/10 px-3 py-2 text-xs leading-relaxed text-down">
                {error}
              </p>
            )}

            {/* Render-style primary CTA: white button, black text */}
            <Button
              type="submit"
              disabled={busy}
              className="h-10 w-full bg-white text-black font-semibold hover:bg-zinc-200 disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Please wait…
                </>
              ) : isSetup ? (
                "Secure my dashboard"
              ) : (
                "Sign in"
              )}
            </Button>
          </div>
        </form>
      </div>

      <footer className="absolute bottom-4 left-0 right-0 z-10 text-center text-[11px] text-muted-foreground/70">
        PING is an independent tool — not affiliated with render.com
      </footer>
    </main>
  );
}
