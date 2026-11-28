"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ShieldQuestion } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDateTime, timeAgo } from "@/lib/ping-client";
import type { IncidentDTO, IncidentState } from "@/lib/ping-types";
import { groupIncidents } from "@/hooks/use-incidents";
import { cn } from "@/lib/utils";
import { StatusPill, type PillTone } from "./status-pill";
import { EmptyState } from "./empty-state";
import { InlineAlert } from "./inline-alert";
import { SectionLabel } from "./section-label";
import { Skeleton } from "@/components/ui/skeleton";

const STATE_PILL: Record<IncidentState, { label: string; tone: PillTone }> = {
  ongoing: { label: "ongoing", tone: "down" },
  paused: { label: "paused", tone: "neutral" },
  "no-recovery": { label: "no recovery", tone: "neutral" },
  resolved: { label: "resolved", tone: "up" },
};

/** Admin view of the last 30 days of incidents (derived from real checks), the
 *  unread ones split out on top. The list and the seen watermark are owned by
 *  the dashboard's Incident state, so the badge and this sheet never disagree. */
export function IncidentsSheet({
  open,
  onOpenChange,
  folderId,
  incidents,
  error,
  ongoingCount,
  seenStartedAt,
  onViewed,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active Folder to scope to; null = the whole Fleet ("All monitors"). */
  folderId: string | null;
  /** The active Scope's shared list; null while nothing has loaded yet. */
  incidents: IncidentDTO[] | null;
  error: string | null;
  ongoingCount: number;
  /** The watermark the badge counted against, frozen when the sheet opened:
   *  everything newer than it is "New" here. */
  seenStartedAt: number;
  /** Called once with the list each time the sheet closes, so the badge clears
   *  only for a list that was actually on screen. */
  onViewed: (incidents: IncidentDTO[]) => void;
  /** One background refresh on open, so the list is current when shown. */
  onRefresh: () => Promise<void>;
}) {
  // The clock for "ongoing" durations. Read in an effect (not during render)
  // so a re-render never produces a different number from the same props, and
  // ticked while open so a long outage's duration stays honest.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    void onRefresh();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open, onRefresh]);

  // The watermark advances only when the sheet closes (below), so the rows the
  // badge counted stay in "New" for as long as the sheet is on screen. A list
  // that never loaded marks nothing, so a failed fetch cannot silence the badge.
  function handleOpenChange(next: boolean) {
    if (!next && incidents) onViewed(incidents);
    onOpenChange(next);
  }

  const groups = incidents ? groupIncidents(incidents, seenStartedAt) : null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-md flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-down/90" aria-hidden="true" />
            Incidents
            {ongoingCount > 0 && (
              <StatusPill tone="down" size="sm" className="tabular-nums">
                {ongoingCount}
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
            <div className="space-y-4 px-4 py-4">
              <IncidentGroup
                label={`New (${groups?.unseen.length ?? 0})`}
                className="text-foreground"
                incidents={groups?.unseen ?? []}
                now={now}
              />
              <IncidentGroup label="Ongoing" incidents={groups?.ongoing ?? []} now={now} />
              <IncidentGroup label="Earlier" incidents={groups?.earlier ?? []} now={now} />
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
function formatRange(startedAt: string, endedAt: string | null, state: IncidentState): string {
  const started = new Date(startedAt);
  if (!endedAt) return state === "paused" ? formatDateTime(startedAt) : `${formatDateTime(startedAt)} → now`;
  const ended = new Date(endedAt);
  const end =
    ended.toDateString() === started.toDateString()
      ? ended.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : formatDateTime(endedAt);
  return `${formatDateTime(startedAt)} → ${end}`;
}

/**
 * One labelled run of rows. "New" carries the count the badge showed, in
 * foreground ink so it leads the eye; an empty group renders nothing at all,
 * so an all-seen sheet looks like the plain history it is.
 */
function IncidentGroup({
  label,
  className,
  incidents,
  now,
}: {
  label: string;
  className?: string;
  incidents: IncidentDTO[];
  now: number;
}) {
  if (incidents.length === 0) return null;
  return (
    <section>
      <SectionLabel className={cn("mb-2", className)}>{label}</SectionLabel>
      <div className="space-y-2.5">
        {incidents.map((inc, i) => (
          <IncidentRow key={`${inc.monitorId}-${inc.startedAt}-${i}`} inc={inc} now={now} />
        ))}
      </div>
    </section>
  );
}

function IncidentRow({ inc, now }: { inc: IncidentDTO; now: number }) {
  const state = STATE_PILL[inc.state];

  return (
    <div className="relative rounded-lg border bg-card px-3 pb-2.5 pt-6">
      <StatusPill
        tone={state.tone}
        size="sm"
        uppercase
        className="absolute left-0 top-0 z-10 min-w-13 justify-center border-t-0 border-l-0"
      >
        {state.label}
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
        {formatRange(inc.startedAt, inc.endedAt, inc.state)}
      </div>
    </div>
  );
}
