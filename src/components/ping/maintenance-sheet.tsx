"use client";

import { useState } from "react";
import { Hammer, Loader2, Wrench, X } from "lucide-react";
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
import { api, formatDateTime, formatDuration } from "@/lib/ping-client";
import type { MaintenanceWindowDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";

/**
 * All maintenance windows: active first (ends-soonest), then upcoming, then
 * recently ended. Data comes from the overview poll — no separate fetch.
 */
export function MaintenanceSheet({
  open,
  onOpenChange,
  windows,
  onCancel,
  serverTime,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  windows: MaintenanceWindowDTO[];
  onCancel: (id: string) => Promise<void>;
  serverTime: string | null;
}) {
  const now = serverTime ? new Date(serverTime).getTime() : Date.now();
  const active = windows
    .filter((w) => new Date(w.startsAt).getTime() <= now && new Date(w.endsAt).getTime() > now)
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  const upcoming = windows
    .filter((w) => new Date(w.startsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const ended = windows
    .filter((w) => new Date(w.endsAt).getTime() <= now)
    .sort((a, b) => b.endsAt.localeCompare(a.endsAt));
  const empty = active.length === 0 && upcoming.length === 0 && ended.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Wrench className="size-4 text-warn" aria-hidden="true" />
            Maintenance
            {active.length > 0 && (
              <span className="rounded-none border border-warn/40 bg-warn/10 px-1.5 py-px text-[10px] font-medium tabular-nums text-warn">
                {active.length} active
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            Planned work windows. Checks keep running and stay recorded — alerts are just
            silenced, and the public status page shows a maintenance state instead of an outage.
          </SheetDescription>
        </SheetHeader>

        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
            <div className="grid size-12 place-items-center rounded-none border border-dashed border-border">
              <Wrench className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No maintenance windows</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Open a monitor&rsquo;s <span className="text-foreground/80">⋮ menu → Schedule
                maintenance…</span>{" "}
                before a deploy to silence alerts and show an honest maintenance state.
              </p>
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-5 px-4 py-4">
              {active.length > 0 && (
                <section aria-label="Active maintenance windows">
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-warn">
                    <Hammer className="size-3" aria-hidden="true" />
                    Active now
                  </h3>
                  <div className="space-y-1.5">
                    {active.map((w) => (
                      <WindowRow key={w.id} w={w} now={now} tone="active" onCancel={onCancel} />
                    ))}
                  </div>
                </section>
              )}

              {upcoming.length > 0 && (
                <section aria-label="Upcoming maintenance windows">
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Upcoming
                  </h3>
                  <div className="space-y-1.5">
                    {upcoming.map((w) => (
                      <WindowRow key={w.id} w={w} now={now} tone="upcoming" onCancel={onCancel} />
                    ))}
                  </div>
                </section>
              )}

              {ended.length > 0 && (
                <section aria-label="Recently ended maintenance windows">
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Recently ended
                  </h3>
                  <div className="space-y-1.5">
                    {ended.map((w) => (
                      <WindowRow key={w.id} w={w} now={now} tone="ended" onCancel={onCancel} />
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

function WindowRow({
  w,
  now,
  tone,
  onCancel,
}: {
  w: MaintenanceWindowDTO;
  now: number;
  tone: "active" | "upcoming" | "ended";
  onCancel: (id: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const start = new Date(w.startsAt).getTime();
  const end = new Date(w.endsAt).getTime();
  const durationSec = Math.round((end - start) / 1000);

  async function cancel() {
    setBusy(true);
    try {
      await onCancel(w.id);
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Failed to cancel",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const minsLeft = Math.max(0, Math.round((end - now) / 60_000));
  const minsToStart = Math.max(0, Math.round((start - now) / 60_000));

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
        tone === "active" && "border-warn/30 bg-warn/[0.06]",
        tone === "upcoming" && "bg-card",
        tone === "ended" && "bg-card/60 opacity-75",
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-none border",
          tone === "active"
            ? "border-warn/40 bg-warn/15 text-warn"
            : "border-border bg-secondary text-muted-foreground",
        )}
        title={tone === "active" ? "In maintenance" : tone === "upcoming" ? "Scheduled" : "Ended"}
      >
        {tone === "active" ? (
          <Hammer className="size-4" aria-hidden="true" />
        ) : (
          <Wrench className="size-4" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{w.monitorName}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {formatDateTime(w.startsAt)} · {formatDuration(durationSec)}
          {tone === "active" && (
            <span className="ml-1.5 text-warn">
              {minsLeft <= 0 ? "ending…" : minsLeft < 60 ? `${minsLeft}m left` : `${Math.round(minsLeft / 60)}h left`}
            </span>
          )}
          {tone === "upcoming" && (
            <span className="ml-1.5 text-primary/90">
              {minsToStart < 60 ? `starts in ${minsToStart}m` : `starts in ${Math.round(minsToStart / 60)}h`}
            </span>
          )}
          {w.note && <span className="text-muted-foreground/80"> — {w.note}</span>}
        </p>
      </div>
      {tone !== "ended" && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void cancel()}
          disabled={busy}
          aria-label={`Cancel maintenance window for ${w.monitorName}`}
          title="Cancel"
          className="size-8 shrink-0 text-muted-foreground hover:text-down"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
        </Button>
      )}
    </div>
  );
}
