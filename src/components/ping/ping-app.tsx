"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/ping-client";
import type { SessionResponse } from "@/lib/ping-types";
import { PingLogo } from "./ping-logo";
import { LoginView } from "./login-view";
import { DashboardView } from "./dashboard-view";
import { AdminView } from "./admin-view";

type Phase = "booting" | "login" | "app";

export function PingApp() {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("booting");
  const [initialized, setInitialized] = useState(false);
  const [view, setView] = useState<"dashboard" | "admin">("dashboard");
  // The session's absolute expiry (ISO), reported by the server. The header
  // counts down to it; when it passes, the next request 401s and we sign out.
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await api<SessionResponse>("/api/auth/session");
        if (cancelled) return;
        setInitialized(s.initialized);
        setExpiresAt(s.authenticated ? s.expiresAt : null);
        setPhase(s.authenticated ? "app" : "login");
      } catch {
        if (!cancelled) {
          setInitialized(false);
          setExpiresAt(null);
          setPhase("login");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // When the absolute expiry passes, drop the client back to the login
  // screen. The server is the authority (every request re-checks); this is
  // only so an idle tab re-gates without waiting for its next request.
  useEffect(() => {
    if (!expiresAt) return;
    const ms = new Date(expiresAt).getTime() - Date.now();
    const t = setTimeout(
      () => {
        setExpiresAt(null);
        setView("dashboard");
        toast({ description: "Session expired — sign in again" });
        setPhase("login");
      },
      Math.max(0, ms),
    );
    return () => clearTimeout(t);
  }, [expiresAt, toast]);

  /** Session died server-side (401) — return to login. */
  const handleAuthLost = useCallback(() => {
    setExpiresAt(null);
    setView("dashboard");
    setPhase("login");
  }, []);

  function handleLogout() {
    setExpiresAt(null);
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
          // Re-read the fresh session's absolute expiry.
          void api<SessionResponse>("/api/auth/session")
            .then((s) => setExpiresAt(s.expiresAt))
            .catch(() => setExpiresAt(null));
        }}
      />
    );
  }

  return view === "admin" ? (
    <AdminView
      expiresAt={expiresAt}
      onBack={() => setView("dashboard")}
      onAuthLost={handleAuthLost}
    />
  ) : (
    <DashboardView
      sessionExpiresAt={expiresAt}
      onLogout={handleLogout}
      onOpenAdmin={() => setView("admin")}
    />
  );
}
