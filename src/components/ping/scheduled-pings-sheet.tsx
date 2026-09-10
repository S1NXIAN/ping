"use client";

import { useState } from "react";
import { CalendarClock, Clock, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { api, formatCountdown, formatDateTime, formatMs, timeAgo } from "@/lib/ping-client";
import type { ScheduledPingDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";

/**
 * Full list of scheduled pings: upcoming first (soonest), then recent real
 * results. Data comes from the overview poll — no separate fetch needed.
 */
export function ScheduledPingsSheet({
  open,
  onOpenChange,
  pings,
  onCancel,
  serverTime,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pings: ScheduledPingDTO[];
  onCancel: (id: string) => Promise<void>;
  serverTime: string | null;
}) {
  const now = serverTime ? new Date(serverTime).getTime() : Date.now();
  const upcoming = pings
    .filter((p) => p.status !== "done")
    .sort((a, b) => a.runAt.localeCompare(b.runAt));
  const recent = pings
    .filter((p) => p.status === "done")
    .sort((a, b) => (b.ranAt ?? b.runAt).localeCompare(a.ranAt ?? a.runAt));
  const empty = upcoming.length === 0 && recent.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-primary" aria-hidden="true" />
            Scheduled pings
            {upcoming.length > 0 && (
              <span className="rounded-none border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-medium tabular-nums text-primary">
                {upcoming.length}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            One-off checks you asked PING to run at a specific moment. Every result is a real
            HTTP request, recorded in the monitor&rsquo;s history.
          </SheetDescription>
        </SheetHeader>

        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
            <div className="grid size-12 place-items-center rounded-none border border-dashed border-border">
              <CalendarClock className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No scheduled pings yet</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Open a monitor&rsquo;s <span className="text-foreground/80">⋮ menu → Schedule ping…</span>{" "}
                to run one real check at an exact time — handy right after a deploy.
              </p>
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-5 px-4 py-4">
              {upcoming.length > 0 && (
                <section aria-label="Upcoming scheduled pings">
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <Clock className="size-3" aria-hidden="true" />
                    Upcoming
                  </h3>
                  <div className="space-y-1.5">
                    {upcoming.map((p) => (
                      <UpcomingRow key={p.id} ping={p} now={now} onCancel={onCancel} />
                    ))}
                  </div>
                </section>
              )}

              {recent.length > 0 && (
                <section aria-label="Recent scheduled ping results">
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Recent results
                  </h3>
                  <div className="space-y-1.5">
                    {recent.map((p) => (
                      <DoneRow key={p.id} ping={p} now={now} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function UpcomingRow({
  ping,
  now,
  onCancel,
}: {
  ping: ScheduledPingDTO;
  now: number;
  onCancel: (id: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      await onCancel(ping.id);
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Failed to cancel",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-none border",
          ping.status === "running"
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border bg-secondary text-muted-foreground",
        )}
        title={ping.status === "running" ? "Running now" : "Waiting"}
      >
        {ping.status === "running" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Clock className="size-4" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{ping.monitorName}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {ping.status === "running" ? (
            <span className="text-primary">running now…</span>
          ) : (
            <>
              {formatDateTime(ping.runAt)} ·{" "}
              <span className="text-primary/90">{formatCountdown(ping.runAt, now)}</span>
            </>
          )}
          {ping.note && <span className="text-muted-foreground/80"> — {ping.note}</span>}
        </p>
      </div>
      {ping.status === "pending" && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void cancel()}
          disabled={busy}
          aria-label={`Cancel scheduled ping for ${ping.monitorName}`}
          title="Cancel"
          className="size-8 shrink-0 text-muted-foreground hover:text-down"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
        </Button>
      )}
    </div>
  );
}

function DoneRow({ ping, now }: { ping: ScheduledPingDTO; now: number }) {
  const up = ping.up === true;
  const unknown = ping.up == null;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card/60 px-3 py-2.5">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-none border text-[11px] font-semibold tabular-nums",
          unknown
            ? "border-border bg-muted text-muted-foreground"
            : up
              ? "border-up/30 bg-up/10 text-up"
              : "border-down/30 bg-down/10 text-down",
        )}
        title={unknown ? "Outcome unknown" : up ? "Up" : "Down"}
        aria-hidden="true"
      >
        {unknown ? "?" : up ? "UP" : "DN"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{ping.monitorName}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          ran {timeAgo(ping.ranAt, now)}
          {ping.statusCode != null && (
            <span className={cn("ml-1.5 tabular-nums", ping.statusCode >= 400 ? "text-down" : "text-up")}>
              HTTP {ping.statusCode}
            </span>
          )}
          {ping.responseMs != null && (
            <span className="ml-1.5 tabular-nums">{formatMs(ping.responseMs)}</span>
          )}
          {ping.note && <span className="text-muted-foreground/80"> — {ping.note}</span>}
          {ping.error && <span className="ml-1.5 truncate text-down/90">{ping.error}</span>}
        </p>
      </div>
    </div>
  );
}
