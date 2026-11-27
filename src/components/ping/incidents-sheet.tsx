"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ShieldQuestion } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchIncidents, formatDateTime, timeAgo } from "@/lib/ping-client";
import type { AdminIncidentDTO } from "@/lib/ping-types";
import { StatusPill } from "./status-pill";
import { EmptyState } from "./empty-state";
import { InlineAlert } from "./inline-alert";
import { Skeleton } from "@/components/ui/skeleton";

/** Admin view of the last 30 days of incidents (derived from real checks). */
export function IncidentsSheet({
  open,
  onOpenChange,
  onViewed,
  folderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the list whenever it loads while open, so the dashboard can
   *  clear its badge's seen-incident half. Never called on a failed load. */
  onViewed: (incidents: AdminIncidentDTO[]) => void;
  /** Active Folder to scope to; null = the whole Fleet ("All monitors"). */
  folderId: string | null;
}) {
  const [incidents, setIncidents] = useState<AdminIncidentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The clock for "ongoing" durations. Read in an effect (not during render)
  // so a re-render never produces a different number from the same props, and
  // ticked while open so a long outage's duration stays honest.
  const [now, setNow] = useState(() => Date.now());
  // The header badge is the open live list: ongoing and paused, never resolved.
  const openCount = incidents?.filter((i) => i.endedAt == null).length ?? 0;

  const load = useCallback(async () => {
    try {
      const list = await fetchIncidents(folderId);
      setIncidents(list);
      setError(null);
      onViewed(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load incidents");
    }
  }, [folderId, onViewed]);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    void load();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open, load]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-md flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-down/90" aria-hidden="true" />
            Incidents
            {openCount > 0 && (
              <StatusPill tone="down" size="sm" className="tabular-nums">
                {openCount}
              </StatusPill>
            )}
          </SheetTitle>
          <SheetDescription>
            Outages from the last 30 days{folderId ? " in this folder" : " across all monitors"}.
          </SheetDescription>
        </SheetHeader>

        {error && (
          <div className="px-4 pt-3">
            <InlineAlert bordered>{error}</InlineAlert>
          </div>
        )}

        {incidents == null && !error ? (
          <div className="space-y-2.5 px-4 py-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : incidents != null && incidents.length === 0 ? (
          <EmptyState
            icon={ShieldQuestion}
            title="No incidents in the last 30 days"
            description="When a monitor fails consecutive checks, the down period shows up here."
          />
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2.5 px-4 py-4">
              {(incidents ?? []).map((inc, i) => (
                <IncidentRow
                  key={`${inc.monitorId}-${inc.startedAt}-${i}`}
                  inc={inc}
                  now={now}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The row's second line: the date once, then the time range. Repeating
 * "Nov 27, 10:34 PM" twice made start and end read the same at 11px. A paused
 * monitor's open incident shows the start alone — its end was never observed.
 */
function formatRange(startedAt: string, endedAt: string | null, paused: boolean): string {
  const started = new Date(startedAt);
  if (!endedAt) return paused ? formatDateTime(startedAt) : `${formatDateTime(startedAt)} → now`;
  const ended = new Date(endedAt);
  const end =
    ended.toDateString() === started.toDateString()
      ? ended.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : formatDateTime(endedAt);
  return `${formatDateTime(startedAt)} → ${end}`;
}

function IncidentRow({ inc, now }: { inc: AdminIncidentDTO; now: number }) {
  const ended = inc.endedAt != null;
  // A sleep gap closes the run at its last down check without seeing it recover.
  const recovered = inc.recovered === true;

  return (
    <div className="relative rounded-lg border bg-card px-3 pb-2.5 pt-6">
      <StatusPill
        tone={recovered ? "up" : ended || inc.monitorPaused ? "neutral" : "down"}
        size="sm"
        uppercase
        className="absolute left-0 top-0 z-10 min-w-13 justify-center border-t-0 border-l-0"
      >
        {recovered ? "resolved" : ended ? "no recovery" : inc.monitorPaused ? "paused" : "ongoing"}
      </StatusPill>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {inc.monitorName}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {timeAgo(inc.endedAt ?? inc.startedAt, now)}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {formatRange(inc.startedAt, inc.endedAt, inc.monitorPaused)}
      </div>
    </div>
  );
}
