"use client";

import { useEffect, useState } from "react";

/**
 * Milliseconds left until an absolute session expiry (ISO), ticking every
 * second while one is set; null when there is no expiry. Shared by the
 * dashboard and Settings headers so their countdowns can never disagree.
 */
export function useSessionCountdown(expiresAt: string | null): number | null {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  return expiresAt ? new Date(expiresAt).getTime() - nowMs : null;
}
