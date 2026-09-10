"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  ExternalLink,
  Folder,
  History,
  Hourglass,
  Loader2,
  Pause,
  Pin,
  Play,
  RefreshCw,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  api,
  ApiError,
  formatClock,
  formatDateTime,
  formatInterval,
  formatMs,
  formatUptime,
  hostOf,
  timeAgo,
} from "@/lib/ping-client";
import type { MonitorDetailResponse, MonitorDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { HistoryChart } from "./history-chart";
import { StatusDot, statusLabel } from "./status-dot";
import { dailyToSegments, UptimeBars } from "./uptime-bars";

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 text-base font-semibold tabular-nums leading-tight", tone)}>
        {value}
      </div>
    </div>
  );
}

export function MonitorDetailSheet({
  open,
  onOpenChange,
  monitor,
  onEdit,
  onChanged,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor: MonitorDTO | null;
  onEdit: (m: MonitorDTO) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<MonitorDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Bumped on every (re)load so the history chart silently refetches. */
  const [historyTick, setHistoryTick] = useState(0);

  const id = monitor?.id;

  const load = useCallback(
    async (silent = false) => {
      if (!id) return;
      if (!silent) setLoading(true);
      try {
        const d = await api<MonitorDetailResponse>(`/api/monitors/${id}`);
        setDetail(d);
        setHistoryTick((n) => n + 1);
      } catch (e) {
        toast({
          description: e instanceof Error ? e.message : "Failed to load monitor",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [id, toast],
  );

  useEffect(() => {
    if (open && id) {
      setDetail(null);
      load();
    }
  }, [open, id, load]);

  // Live refresh while the sheet is open (skips hidden tabs).
  useEffect(() => {
    if (!open || !id) return;
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load(true);
    }, 15000);
    return () => clearInterval(t);
  }, [open, id, load]);

  async function checkNow() {
    if (!id || checking) return;
    setChecking(true);
    try {
      await api(`/api/monitors/${id}/check`, { method: "POST" });
      await load(true);
      onChanged();
    } catch (e) {
      toast({
        description: e instanceof ApiError || e instanceof Error ? e.message : "Check failed",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  }

  async function togglePause() {
    if (!id || !monitor) return;
    try {
      await api(`/api/monitors/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !monitor.enabled }),
      });
      toast({ description: monitor.enabled ? "Checks paused" : "Checks resumed" });
      await load(true);
      onChanged();
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Failed",
        variant: "destructive",
      });
    }
  }

  async function doDelete() {
    if (!id) return;
    setConfirmDelete(false);
    try {
      await api(`/api/monitors/${id}`, { method: "DELETE" });
      toast({ description: "Monitor deleted" });
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Delete failed",
        variant: "destructive",
      });
    }
  }

  const m = detail?.monitor ?? monitor;
  const stats = m?.stats;
  const status: "up" | "down" | "paused" | "pending" = !m?.enabled
    ? "paused"
    : m?.lastStatus === "up"
      ? "up"
      : m?.lastStatus === "down"
        ? "down"
        : "pending";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-xl lg:max-w-2xl"
      >
        <SheetHeader className="border-b bg-card/40 p-4 pb-3">
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8 text-left">
            <StatusDot status={checking ? "checking" : status} />
            <span className="truncate">{m?.name ?? "Monitor"}</span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
                status === "up"
                  ? "border-up/25 bg-up/10 text-up"
                  : status === "down"
                    ? "border-down/25 bg-down/10 text-down"
                    : "border-border bg-muted text-muted-foreground",
              )}
            >
              {checking ? "checking…" : statusLabel(status)}
            </span>
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-left">
            <a
              href={m?.url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-teal"
            >
              {m ? hostOf(m.url) : "—"}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
            <span className="inline-flex items-center gap-1">
              <History className="size-3" aria-hidden="true" /> every{" "}
              {m ? formatInterval(m.intervalSec) : "—"} · {m?.method ?? "GET"}
            </span>
            {m?.folderName && (
              <span className="inline-flex items-center gap-1">
                <Folder className="size-3" aria-hidden="true" /> {m.folderName}
              </span>
            )}
            {m?.account && (
              <span className="inline-flex items-center gap-1 rounded-full border border-teal/25 bg-teal/10 px-1.5 py-px text-[10px] text-teal">
                <UserRound className="size-2.5" aria-hidden="true" />
                {m.account}
              </span>
            )}
            {m?.pinned && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-px text-[10px] text-primary">
                <Pin className="size-2.5" aria-hidden="true" />
                pinned
              </span>
            )}
            {m && m.alertDelay > 0 && (
              <span
                title={
                  m.lastStatus === "down" && m.consecutiveDowns <= m.alertDelay
                    ? `Down alerts fire after ${m.alertDelay + 1} consecutive failed checks — this downtime is already recorded, only the notification is waiting`
                    : `Down webhooks wait for ${m.alertDelay + 1} consecutive failed checks`
                }
                className="inline-flex items-center gap-1 rounded-full border border-warn/25 bg-warn/[0.06] px-1.5 py-px text-[10px] font-medium text-warn/90"
              >
                <Hourglass className="size-2.5" aria-hidden="true" />
                {m.lastStatus === "down" && m.consecutiveDowns <= m.alertDelay
                  ? `confirming ${m.consecutiveDowns}/${m.alertDelay + 1}`
                  : `alerts after ${m.alertDelay + 1} failed checks`}
              </span>
            )}
            <span>Last updated {timeAgo(m?.lastCheckAt)}</span>
          </SheetDescription>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={checkNow} disabled={checking || !m?.enabled}>
              {checking ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Checking…
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5" /> Check now
                </>
              )}
            </Button>
            <Button size="sm" variant="outline" onClick={() => load()}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            {m && (
              <Button size="sm" variant="outline" onClick={() => onEdit(m)}>
                Edit
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={togglePause}>
              {m?.enabled ? (
                <>
                  <Pause className="size-3.5" /> Pause
                </>
              ) : (
                <>
                  <Play className="size-3.5" /> Resume
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-down/30 text-down hover:bg-down/10 hover:text-down"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        </SheetHeader>

        <div className="space-y-5 p-4">
          {loading && !detail && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading real check data…
            </div>
          )}

          {/* Availability — from genuinely recorded checks only */}
          <section aria-label="Availability">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <BarChart3 className="size-3.5" aria-hidden="true" /> Availability (recorded checks)
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="24h uptime"
                value={formatUptime(stats?.uptime24h)}
                tone={
                  stats?.uptime24h == null
                    ? "text-muted-foreground"
                    : stats.uptime24h >= 1
                      ? "text-up"
                      : stats.uptime24h >= 0.9
                        ? "text-warn"
                        : "text-down"
                }
              />
              <Stat
                label="7d uptime"
                value={formatUptime(stats?.uptime7d)}
                tone="text-foreground"
              />
              <Stat
                label="30d uptime"
                value={formatUptime(stats?.uptime30d)}
                tone="text-foreground"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {stats?.totalChecks
                ? `Based on ${stats.totalChecks.toLocaleString()} recorded checks since ${formatDateTime(stats.firstCheckAt)}. Windows with no checks show “—”.`
                : "No checks recorded yet — uptime appears after the first real check."}
            </p>
          </section>

          {/* 30-day daily bars */}
          <section aria-label="Daily history">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Last 30 days
            </h3>
            <UptimeBars
              segments={dailyToSegments(detail?.daily ?? [])}
              barClassName="h-9"
              className="gap-[2px]"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>30 days ago</span>
              <span className="flex items-center gap-2">
                <span className="inline-block size-2 rounded-[2px] bg-up/90" /> up
                <span className="inline-block size-2 rounded-[2px] bg-warn/90" /> partial
                <span className="inline-block size-2 rounded-[2px] bg-down/90" /> down
                <span className="inline-block size-2 rounded-[2px] bg-muted opacity-40" /> no data
              </span>
              <span>today</span>
            </div>
          </section>

          {/* Response times */}
          <section aria-label="Response times">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Activity className="size-3.5" aria-hidden="true" /> Response time
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="avg (24h)" value={formatMs(stats?.avgMs24h)} />
              <Stat label="p95 (24h)" value={formatMs(detail?.p95Ms24h ?? null)} />
              <Stat label="min (24h)" value={formatMs(stats?.minMs24h)} />
              <Stat label="max (24h)" value={formatMs(stats?.maxMs24h)} />
            </div>
            <div className="mt-2">
              {id && m && (
                <HistoryChart
                  monitorId={id}
                  monitorName={m.name}
                  slowThresholdMs={m.slowThresholdMs}
                  refreshKey={historyTick}
                />
              )}
            </div>
          </section>

          {/* Extra stats */}
          <section aria-label="More stats" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="avg (7d)" value={formatMs(stats?.avgMs7d)} />
            <Stat label="checks (24h)" value={stats?.checks24h ?? 0} />
            <Stat label="last failure" value={timeAgo(stats?.lastDownAt)} />
            <Stat label="total checks" value={(stats?.totalChecks ?? 0).toLocaleString()} />
          </section>

          {/* History table */}
          <section aria-label="Check history">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent checks
            </h3>
            <ScrollArea className="max-h-96 rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card/95 backdrop-blur">
                  <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium text-right">Response</th>
                    <th className="px-3 py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.checks ?? []).map((c) => (
                    <tr key={c.id} className="border-b border-border/50 tabular-nums">
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {formatClock(c.checkedAt)}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5",
                            c.status === "up" ? "text-up" : "text-down",
                          )}
                        >
                          <StatusDot status={c.status === "up" ? "up" : "down"} pulse={false} />
                          {c.status === "up" ? "up" : "down"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        {c.statusCode != null ? (
                          <span className={c.statusCode >= 400 ? "text-down" : "text-up"}>
                            {c.statusCode}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right text-foreground/80">
                        {formatMs(c.responseMs)}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-1.5 text-muted-foreground">
                        {c.error ?? ""}
                      </td>
                    </tr>
                  ))}
                  {detail && detail.checks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                        No checks recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
            {detail && detail.checks.length === 100 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Showing the latest 100 checks — full history is kept for 30 days.
              </p>
            )}
          </section>
        </div>
      </SheetContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{m?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The monitor and its entire recorded check history will be removed.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              className="bg-down text-white hover:bg-down/90"
            >
              Delete monitor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
