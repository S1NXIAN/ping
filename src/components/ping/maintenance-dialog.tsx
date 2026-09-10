"use client";

import { useEffect, useMemo, useState } from "react";
import { Hammer, Loader2, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError, formatDateTime } from "@/lib/ping-client";
import type { MaintenanceWindowDTO, MonitorDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date → value accepted by <input type="datetime-local"> (device-local). */
function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Duration in minutes → compact label. */
function durationLabel(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/**
 * Schedules a maintenance window for one monitor: checks keep running and
 * being recorded, but webhook notifications are suppressed and the public
 * status page shows a maintenance state instead of an outage.
 */
export function MaintenanceDialog({
  open,
  onOpenChange,
  monitor,
  windows,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor: MonitorDTO | null;
  /** All maintenance windows — filtered to this monitor inside. */
  windows: MaintenanceWindowDTO[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [start, setStart] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const now = Date.now();
  const upcoming = useMemo(
    () =>
      windows
        .filter((w) => w.monitorId === monitor?.id && new Date(w.endsAt).getTime() > now)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [windows, monitor?.id, now],
  );

  useEffect(() => {
    if (!open) return;
    // default: start now, run for 30 minutes
    const target = new Date();
    target.setSeconds(0, 0);
    setStart(toLocalInputValue(target));
    setDurationMin(30);
    setNote("");
    setError(null);
  }, [open, monitor?.id]);

  function applyStartPreset(minAhead: number) {
    const target = new Date(Date.now() + minAhead * 60_000);
    target.setSeconds(0, 0);
    setStart(toLocalInputValue(target));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!monitor) return;

    if (!start) {
      setError("Pick a start date and time");
      return;
    }
    const startsAt = new Date(start).getTime();
    if (Number.isNaN(startsAt)) {
      setError("That date/time could not be read");
      return;
    }
    if (startsAt < Date.now() - 60_000) {
      setError("Start time cannot be in the past");
      return;
    }
    if (durationMin < 1 || durationMin > 7 * 24 * 60) {
      setError("Duration must be between 1 minute and 7 days");
      return;
    }
    const endsAt = startsAt + durationMin * 60_000;

    setBusy(true);
    try {
      await api("/api/maintenance", {
        method: "POST",
        body: JSON.stringify({
          monitorId: monitor.id,
          startsAt,
          endsAt,
          note: note.trim() || null,
        }),
      });
      toast({
        description: `Maintenance window set — ${formatDateTime(new Date(startsAt).toISOString())} for ${durationLabel(durationMin)}`,
      });
      onOpenChange(false);
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelWindow(id: string) {
    setCancellingId(id);
    try {
      await api(`/api/maintenance/${id}`, { method: "DELETE" });
      toast({ description: "Maintenance window cancelled" });
      onChanged();
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Failed to cancel",
        variant: "destructive",
      });
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-4 text-warn" aria-hidden="true" />
            Schedule maintenance
          </DialogTitle>
          <DialogDescription>
            {monitor ? (
              <>
                Planned work on <span className="text-foreground">{monitor.name}</span> — e.g. a
                deploy. Checks keep running and stay recorded, but down/recovery alerts are
                silenced and the public status page shows a maintenance state.
              </>
            ) : (
              "Silence alerts and show a maintenance state on the status page during planned work."
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "start now", min: 0 },
              { label: "+15m", min: 15 },
              { label: "+1h", min: 60 },
              { label: "+3h", min: 180 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyStartPreset(p.min)}
                className="rounded-none border border-border bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-warn/50 hover:text-foreground"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mw-start">Starts (your local time)</Label>
              <Input
                id="mw-start"
                type="datetime-local"
                value={start}
                step={60}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mw-duration">Duration</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="mw-duration"
                  type="number"
                  min={1}
                  max={10080}
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                  className="w-24"
                  required
                />
                <span className="text-xs text-muted-foreground">min</span>
                <span className="ml-auto text-[11px] tabular-nums text-warn/90">
                  {durationLabel(durationMin)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[15, 30, 60, 120, 180].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDurationMin(m)}
                className={cn(
                  "rounded-none border px-2.5 py-1 text-[11px] transition-colors",
                  durationMin === m
                    ? "border-warn/50 bg-warn/10 text-warn"
                    : "border-border bg-secondary text-muted-foreground hover:border-warn/50 hover:text-foreground",
                )}
              >
                {durationLabel(m)}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mw-note">Note (optional, shown on the status page)</Label>
            <Input
              id="mw-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. upgrading the database"
              maxLength={120}
            />
          </div>

          {upcoming.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Windows for this monitor
              </Label>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border bg-muted/30 p-1.5 slim-scrollbar">
                {upcoming.map((w) => {
                  const active = new Date(w.startsAt).getTime() <= Date.now();
                  return (
                    <div
                      key={w.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                    >
                      <Hammer
                        className={cn(
                          "size-3.5 shrink-0",
                          active ? "text-warn" : "text-muted-foreground",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-foreground/90">{formatDateTime(w.startsAt)}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {active ? "active now" : `starts ${formatDateTime(w.startsAt)}`}
                        </span>
                        {w.note && (
                          <span className="ml-1 truncate text-muted-foreground/80" title={w.note}>
                            — {w.note}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => void cancelWindow(w.id)}
                        disabled={cancellingId === w.id}
                        aria-label="Cancel this maintenance window"
                        className="rounded p-1 text-muted-foreground hover:bg-down/10 hover:text-down disabled:opacity-50"
                      >
                        {cancellingId === w.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <X className="size-3.5" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="rounded-md bg-down/10 px-3 py-2 text-xs text-down">{error}</p>}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="bg-warn text-black hover:bg-warn/90">
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Scheduling…
                </>
              ) : (
                <>
                  <Wrench className="size-4" /> Schedule window
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
