"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/ping-client";
import type { SessionResponse } from "@/lib/ping-types";
import { PingLogo } from "./ping-logo";
import { LoginView } from "./login-view";
import { DashboardView } from "./dashboard-view";
import { AdminView } from "./admin-view";
import { UnlockDialog } from "./unlock-dialog";

type Phase = "booting" | "login" | "app";

export function PingApp() {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("booting");
  const [initialized, setInitialized] = useState(false);
  const [view, setView] = useState<"dashboard" | "admin">("dashboard");

  // Admin unlock state: while an unlock cookie is valid Settings opens
  // directly; otherwise the Settings button prompts for the password.
  const [unlockExpiresAt, setUnlockExpiresAt] = useState<string | null>(null);
  const [unlockPromptOpen, setUnlockPromptOpen] = useState(false);

  const adminUnlocked =
    !!unlockExpiresAt && new Date(unlockExpiresAt).getTime() > Date.now();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api<SessionResponse>("/api/auth/session");
        if (cancelled) return;
        setInitialized(s.initialized);
        setUnlockExpiresAt(s.adminUnlocked ? s.unlockExpiresAt : null);
        setPhase(s.authenticated ? "app" : "login");
      } catch {
        if (!cancelled) {
          setInitialized(false);
          setUnlockExpiresAt(null);
          setPhase("login");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-lock: when the 15-minute unlock expires, drop it. If the user is
  // sitting in Settings, bounce them back to the dashboard and say why.
  useEffect(() => {
    if (!unlockExpiresAt) return;
    const ms = new Date(unlockExpiresAt).getTime() - Date.now();
    const t = setTimeout(
      () => {
        setUnlockExpiresAt(null);
        if (view === "admin") {
          setView("dashboard");
          toast({ description: "Settings re-locked — the 15-minute unlock expired" });
        }
      },
      Math.max(0, ms),
    );
    return () => clearTimeout(t);
  }, [unlockExpiresAt, view, toast]);

  /** Settings entry point: open directly when unlocked, else prompt. */
  function openAdmin() {
    if (adminUnlocked) {
      setView("admin");
    } else {
      setUnlockPromptOpen(true);
    }
  }

  function handleUnlocked(expiresAt: string) {
    setUnlockExpiresAt(expiresAt);
    setView("admin");
  }

  async function lockAdmin() {
    try {
      await api("/api/auth/lock", { method: "POST" });
      setUnlockExpiresAt(null);
      setView("dashboard");
      toast({ description: "Settings locked" });
    } catch (err) {
      toast({
        description: err instanceof Error ? err.message : "Could not lock Settings",
        variant: "destructive",
      });
    }
  }

  /** Server-side lock/expiry (401 "Admin locked") while inside Settings. */
  function handleAdminLockLost() {
    setUnlockExpiresAt(null);
    setView("dashboard");
    setUnlockPromptOpen(true);
  }

  function handleLogout() {
    setUnlockExpiresAt(null);
    setView("dashboard");
    setPhase("login");
  }

  if (phase === "booting") {
    return (
      <div className="ping-ambient flex min-h-dvh flex-col items-center justify-center gap-4">
        <PingLogo className="size-14 ping-breathe" />
        <p className="text-sm text-muted-foreground">waking up…</p>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <LoginView
        initialized={initialized}
        onAuthenticated={() => {
          setPhase("app");
          setView("dashboard");
          setUnlockExpiresAt(null);
        }}
      />
    );
  }

  return (
    <>
      {view === "admin" ? (
        <AdminView
          unlockExpiresAt={unlockExpiresAt}
          onBack={() => setView("dashboard")}
          onLock={lockAdmin}
          onExpired={handleAdminLockLost}
          onAuthLost={handleLogout}
          onUnlockRenewed={(expiresAt) => setUnlockExpiresAt(expiresAt)}
        />
      ) : (
        <DashboardView
          adminUnlocked={adminUnlocked}
          onLogout={handleLogout}
          onOpenAdmin={openAdmin}
          onLockAdmin={lockAdmin}
        />
      )}

      <UnlockDialog
        open={unlockPromptOpen}
        onOpenChange={setUnlockPromptOpen}
        onUnlocked={handleUnlocked}
      />
    </>
  );
}
