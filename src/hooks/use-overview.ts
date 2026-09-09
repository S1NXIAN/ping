"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/ping-client";
import type { OverviewResponse } from "@/lib/ping-types";

/**
 * Polls /api/overview on an interval. Pauses while the tab is hidden
 * and refetches on return so you never see stale "time ago" values.
 */
export function useOverview(intervalMs = 15000) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const next = await api<OverviewResponse>("/api/overview");
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load overview");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh(true);
    timer.current = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh(true);
    }, intervalMs);

    const onVisible = () => {
      if (!document.hidden) refresh(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, intervalMs]);

  return { data, error, loading, refreshing, refresh };
}
