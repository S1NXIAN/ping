"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CalendarClock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError, formatDateTime, formatDuration, formatMs, formatUptime, timeAgo } from "@/lib/ping-client";
import type { DailyBucket, PublicIncident, PublicStatusMonitor, PublicStatusResponse } from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { PingLogo, PingWordmark } from "./ping-logo";
import { StatusDot } from "./status-dot";

const REFRESH_MS = 30_000;

/**
 * Public, read-only status page served at `/?status=<token>` — no login.
 * Shows only monitor names, statuses and honest uptime aggregates.
 */
export function PublicStatusView({ token }: { token: string }) {
  const [data, setData] = useState<PublicStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      try {
        const next = await api<PublicStatusResponse>(
          `/api/public/status?token=${encodeURIComponent(token)}`,
        );
        setData(next);
        setError(null);
        setNotFound(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : "Failed to load status");
        }
      } finally {
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    refresh(true);
    const t = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) refresh(true);
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) refresh(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // ticking clock so "Xm ago" stays fresh without new requests
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  if (notFound) {
    return (
      <div className="ping-ambient flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <PingLogo className="size-14 opacity-70" />
        <h1 className="text-lg font-semibold">Status page not found</h1>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          This link is invalid, expired, or the status page has been disabled by its owner.
        </p>
      </div>
    );
  }

  const summary = data?.summary;
  const banner = bannerState(summary);

  return (
    <div className="ping-ambient flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <PingLogo className="size-7" />
          <PingWordmark className="text-base" />
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-px text-[10px] font-medium uppercase tracking-wider text-primary">
            status
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {data ? `updated ${timeAgo(data.serverTime, now)}` : "…"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refresh()}
            disabled={refreshing}
            aria-label="Refresh"
            className="h-8 w-8 text-muted-foreground hover:text-teal"
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-6">
        {error && (
          <div className="rounded-lg border border-down/30 bg-down/10 px-4 py-3 text-sm text-down">
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="space-y-3">
            <div className="h-28 animate-pulse rounded-xl border bg-card" />
            <div className="h-36 animate-pulse rounded-xl border bg-card" />
            <div className="h-36 animate-pulse rounded-xl border bg-card" />
          </div>
        )}

        {data && (
          <>
            {/* overall banner */}
            <section
              aria-live="polite"
              className={cn(
                "ping-fade-up flex items-center gap-3 rounded-xl border p-5",
                banner.tone,
              )}
            >
              <StatusDot status={banner.dot} pulse={banner.dot === "up" || banner.dot === "down"} />
              <div className="min-w-0">
                {data.title && (
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {data.title}
                  </p>
                )}
                <h1 className="text-lg font-semibold leading-snug">{banner.headline}</h1>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {summary && summary.total > 0 ? (
                    <>
                      {summary.up} up
                      {summary.down > 0 && ` · ${summary.down} down`}
                      {summary.paused > 0 && ` · ${summary.paused} paused`}
                      {summary.pending > 0 && ` · ${summary.pending} awaiting first check`}
                      {" · checks are real HTTP requests"}
                    </>
                  ) : (
                    "no monitors are being tracked right now"
                  )}
                </p>
              </div>
              <CalendarClock
                className="ml-auto hidden size-8 shrink-0 opacity-40 sm:block"
                aria-hidden="true"
              />
            </section>

            {/* monitor rows */}
            {data.monitors.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
                This instance has no monitors on its public status page yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {data.monitors.map((m) => (
                  <MonitorRow key={m.id} monitor={m} now={now} />
                ))}
              </div>
            )}

            {/* incidents (derived from real checks only) */}
            {data.incidents.length > 0 ? (
              <IncidentList incidents={data.incidents} now={now} />
            ) : (
              data.monitors.length > 0 && (
                <div className="rounded-xl border bg-card/60 px-4 py-3 text-xs text-muted-foreground">
                  No incidents recorded in the last 30 days.
                </div>
              )
            )}

            <p className="pt-1 text-center text-[11px] leading-relaxed text-muted-foreground">
              Uptime is computed only from recorded checks — days without checks show as empty
              grey bars, never as perfect uptime. This page auto-refreshes every 30 seconds.
            </p>
          </>
        )}
      </main>

      <footer className="sticky bottom-0 z-20 mt-auto border-t bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/70">PING</span>
          <span>honest uptime monitoring</span>
          <span className="ml-auto">not affiliated with render.com</span>
        </div>
      </footer>
    </div>
  );
}

function bannerState(summary: PublicStatusResponse["summary"] | undefined): {
  headline: string;
  tone: string;
  dot: "up" | "down" | "paused" | "pending";
} {
  if (!summary || summary.total === 0) {
    return {
      headline: "Nothing tracked yet",
      tone: "border-border bg-card",
      dot: "paused",
    };
  }
  if (summary.down > 0) {
    return {
      headline:
        summary.down === 1 ? "One service is down" : `${summary.down} services are down`,
      tone: "border-down/40 bg-down/10",
      dot: "down",
    };
  }
  if (summary.up > 0) {
    return {
      headline: "All systems operational",
      tone: "border-up/30 bg-up/10",
      dot: "up",
    };
  }
  if (summary.pending > 0) {
    return {
      headline: "Waiting for the first checks",
      tone: "border-border bg-card",
      dot: "pending",
    };
  }
  return {
    headline: "All monitors are paused",
    tone: "border-border bg-card",
    dot: "paused",
  };
}

function MonitorRow({ monitor, now }: { monitor: PublicStatusMonitor; now: number }) {
  return (
    <article
      className={cn(
        "ping-fade-up rounded-xl border bg-card p-4",
        monitor.status === "down" && "border-down/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusDot status={monitor.status} pulse={monitor.status === "up" || monitor.status === "down"} />
        <h2 className="min-w-0 truncate text-sm font-medium text-foreground">{monitor.name}</h2>
        {monitor.status === "paused" && (
          <span className="rounded-full border border-border bg-muted px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
            paused
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {monitor.uptime7d != null ? (
            <span className="tabular-nums">
              7d <span className="font-medium text-foreground/80">{formatUptime(monitor.uptime7d)}</span>
            </span>
          ) : (
            <span>7d —</span>
          )}
          {monitor.avgMs24h != null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Activity className="size-3" aria-hidden="true" />
              {formatMs(monitor.avgMs24h)}
            </span>
          )}
        </span>
      </div>

      <DayBars daily={monitor.daily} />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          last check <span className="text-foreground/80">{timeAgo(monitor.lastCheckAt, now)}</span>
        </span>
        {monitor.lastStatusCode != null && (
          <span
            className={cn(
              "tabular-nums",
              monitor.lastStatusCode >= 400 ? "text-down" : "text-up",
            )}
          >
            HTTP {monitor.lastStatusCode}
          </span>
        )}
        {monitor.uptime30d != null ? (
          <span>
            30d <span className="tabular-nums text-foreground/80">{formatUptime(monitor.uptime30d)}</span>
          </span>
        ) : (
          <span>30d —</span>
        )}
        {monitor.lastDownAt && (
          <span>last down {timeAgo(monitor.lastDownAt, now)}</span>
        )}
      </div>
    </article>
  );
}

/** 30 calendar-day strip ending today. Grey = no recorded checks that day. */
function IncidentList({ incidents, now }: { incidents: PublicIncident[]; now: number }) {
  return (
    <section className="ping-fade-up rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="size-4 text-down/90" aria-hidden="true" />
        Incidents <span className="font-normal text-muted-foreground">· last 30 days</span>
      </h2>
      <ul className="mt-3 divide-y divide-border">
        {incidents.map((inc, i) => {
          const started = new Date(inc.startedAt);
          const ended = inc.endedAt ? new Date(inc.endedAt) : null;
          const durationMs = (ended ? ended.getTime() : now) - started.getTime();
          return (
            <li key={`${inc.monitorId}-${inc.startedAt}-${i}`} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-foreground">{inc.monitorName}</span>
                {ended ? (
                  <span className="text-xs text-muted-foreground">resolved</span>
                ) : (
                  <span className="rounded-full border border-down/40 bg-down/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-down">
                    ongoing
                  </span>
                )}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {formatDuration(Math.round(durationMs / 1000))}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>started {formatDateTime(inc.startedAt)}</span>
                <span>
                  {inc.downChecks} failed check{inc.downChecks === 1 ? "" : "s"}
                </span>
                {inc.lastStatusCode != null && (
                  <span className="tabular-nums">HTTP {inc.lastStatusCode}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground/80">
        Incidents are stitched from recorded checks — consecutive failed checks count as one
        incident. Gaps with no recorded data never count as downtime.
      </p>
    </section>
  );
}

/** 30 calendar-day strip ending today. Grey = no recorded checks that day. */
function DayBars({ daily }: { daily: DailyBucket[] }) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const days: { key: string; bucket?: DailyBucket }[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(cursor.getTime() - i * 86400_000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ key, bucket: byDate.get(key) });
  }

  return (
    <div
      className="mt-3 flex items-stretch gap-[2px]"
      role="img"
      aria-label="Uptime over the last 30 days — one bar per day, green means all checks passed"
    >
      {days.map(({ key, bucket }, i) => {
        const up = bucket?.up ?? 0;
        const down = bucket?.down ?? 0;
        const title = bucket
          ? `${key} — ${up} up / ${down} down${down > 0 ? ` (${formatUptime(up / (up + down))} uptime)` : ""}`
          : `${key} — no checks recorded`;
        return (
          <div
            key={key}
            title={title}
            className={cn(
              "h-8 flex-1 rounded-[3px] transition-colors",
              !bucket && "bg-muted/50",
              bucket && down === 0 && "bg-up/60 hover:bg-up/80",
              bucket && down > 0 && "bg-down/70 hover:bg-down",
              i === days.length - 1 && "ring-1 ring-inset ring-primary/30",
            )}
          />
        );
      })}
    </div>
  );
}
