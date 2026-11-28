"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const s = await api<SessionResponse>("/api/auth/session");
        if (!mounted.current) return;
        setInitialized(s.initialized);
        // A valid token inside the re-prompt window goes straight in; a valid
        // token whose window has lapsed shows the login screen again. The tab
        // is never interrupted once open — only a fresh visit re-prompts.
        setPhase(s.authenticated && s.windowOpen ? "app" : "login");
      } catch {
        if (!mounted.current) return;
        setInitialized(false);
        setPhase("login");
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Returns to login and syncs `initialized` in case the ephemeral DB reset. */
  const returnToLogin = useCallback(() => {
    setView("dashboard");
    setPhase("login");
    void api<SessionResponse>("/api/auth/session")
      .then((s) => {
        if (mounted.current) setInitialized(s.initialized);
      })
      .catch(() => {
        /* server unreachable — keep current initialized guess */
      });
  }, []);

  // Login → dashboard handoff: the panel cuts away, then the app fades in
  // behind a single wipe. Short by design — 760ms end to end — and skipped
  // entirely when the system asks for reduced motion.
  const [handoff, setHandoff] = useState<null | "out" | "in">(null);
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (handoffTimer.current) clearTimeout(handoffTimer.current);
    };
  }, []);

  const enterApp = useCallback(() => {
    setInitialized(true);
    setView("dashboard");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("app");
      return;
    }
    setHandoff("out");
    handoffTimer.current = setTimeout(() => {
      setPhase("app");
      setHandoff("in");
      handoffTimer.current = setTimeout(() => setHandoff(null), 420);
    }, 340);
  }, []);

  if (phase === "booting") {
    return (
      <div className="ping-ambient flex min-h-dvh flex-col items-center justify-center gap-4">
        <PingLogo className="size-14 ping-breathe" />
        <p className="text-sm text-muted-foreground">waking up…</p>
      </div>
    );
  }

  const wipe = handoff ? (
    <div className="ping-handoff-wipe" aria-hidden="true" />
  ) : null;

  if (phase === "login") {
    return (
      <>
        <div className={handoff === "out" ? "ping-handoff-out" : undefined}>
          <LoginView initialized={initialized} onAuthenticated={enterApp} />
        </div>
        {wipe}
      </>
    );
  }

  return (
    <>
      <div className={handoff === "in" ? "ping-handoff-in" : undefined}>
        {view === "admin" ? (
          <AdminView onBack={() => setView("dashboard")} onAuthLost={returnToLogin} />
        ) : (
          <DashboardView
            onLogout={returnToLogin}
            onOpenAdmin={() => setView("admin")}
          />
        )}
      </div>
      {wipe}
    </>
  );
}
