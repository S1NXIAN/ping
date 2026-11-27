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
import { fetchIncidents, formatDateTime, formatDuration } from "@/lib/ping-client";
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
            {incidents && incidents.length > 0 && (
              <StatusPill tone="down" size="sm" className="tabular-nums">
                {incidents.length}
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

function IncidentRow({ inc, now }: { inc: AdminIncidentDTO; now: number }) {
  const started = new Date(inc.startedAt);
  const ended = inc.endedAt ? new Date(inc.endedAt) : null;
  const durationMs = (ended ? ended.getTime() : now) - started.getTime();

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-foreground">{inc.monitorName}</span>
        {ended ? (
          <StatusPill tone="up" size="sm" uppercase>
            resolved
          </StatusPill>
        ) : (
          <StatusPill tone="down" size="sm" uppercase>
            ongoing
          </StatusPill>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {formatDuration(Math.round(durationMs / 1000), { coarse: true })}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>started {formatDateTime(inc.startedAt)}</span>
        {ended && <span>resolved {formatDateTime(inc.endedAt)}</span>}
      </div>
    </div>
  );
}
