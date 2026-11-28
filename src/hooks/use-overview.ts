"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/ping-client";
import type { OverviewResponse } from "@/lib/ping-types";

/**
 * Polls /api/overview on an interval. Pauses while the tab is hidden
 * and refetches on return so you never see stale "time ago" values.
 */

// The login handoff starts this request ~340ms before the dashboard mounts,
// so the first paint usually lands with data instead of skeletons.
let warmed: Promise<OverviewResponse> | null = null;

export function warmOverview() {
  if (!warmed) {
    warmed = api<OverviewResponse>("/api/overview");
    // Never let a prefetch failure surface as an unhandled rejection; the
    // hook retries with a fresh request if the warmed one rejects.
    warmed.catch(() => {
      warmed = null;
    });
  }
  return warmed;
}

async function loadOverview(): Promise<OverviewResponse> {
  const pending = warmed;
  warmed = null;
  if (pending) {
    try {
      return await pending;
    } catch {
      /* fall through to a fresh request */
    }
  }
  return api<OverviewResponse>("/api/overview");
}

export function useOverview(intervalMs = 15000) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Slow-network guard: never let 15s polls pile up behind a stalled
  // request. The next tick (or visibility return) picks up after it.
  const inFlight = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setRefreshing(true);
    try {
      const next = await loadOverview();
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load overview");
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    timer.current = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh(true);
    }, intervalMs);

    const onVisible = () => {
      if (!document.hidden) void refresh(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, intervalMs]);

  return { data, error, loading, refreshing, refresh };
}
