"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/ping-client";
import type { SessionResponse } from "@/lib/ping-types";
import { PingLogo } from "./ping-logo";
import { LoginView } from "./login-view";
import { DashboardView } from "./dashboard-view";
import { AdminView } from "./admin-view";

type Phase = "booting" | "login" | "app";

export function PingApp() {
  const [phase, setPhase] = useState<Phase>("booting");
  const [initialized, setInitialized] = useState(false);
  const [view, setView] = useState<"dashboard" | "admin">("dashboard");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await api<SessionResponse>("/api/auth/session");
        if (cancelled) return;
        setInitialized(s.initialized);
        // A valid token inside the re-prompt window goes straight in; a valid
        // token whose window has lapsed shows the login screen again. The tab
        // is never interrupted once open — only a fresh visit re-prompts.
        setPhase(s.authenticated && s.windowOpen ? "app" : "login");
      } catch {
        if (!cancelled) {
          setInitialized(false);
          setPhase("login");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Session died server-side (401) — return to login. */
  const handleAuthLost = useCallback(() => {
    setView("dashboard");
    setPhase("login");
  }, []);

  function handleLogout() {
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
        }}
      />
    );
  }

  return view === "admin" ? (
    <AdminView
      onBack={() => setView("dashboard")}
      onAuthLost={handleAuthLost}
    />
  ) : (
    <DashboardView
      onLogout={handleLogout}
      onOpenAdmin={() => setView("admin")}
    />
  );
}
