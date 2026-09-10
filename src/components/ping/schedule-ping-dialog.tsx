"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock, Loader2, X } from "lucide-react";
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
import { api, ApiError, formatCountdown, formatDateTime } from "@/lib/ping-client";
import type { MonitorDTO, ScheduledPingDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date → value accepted by <input type="datetime-local"> (device-local). */
function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SchedulePingDialog({
  open,
  onOpenChange,
  monitor,
  pings,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor: MonitorDTO | null;
  /** All scheduled pings — filtered to this monitor inside. */
  pings: ScheduledPingDTO[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upcoming = useMemo(
    () =>
      pings
        .filter((p) => p.monitorId === monitor?.id && p.status !== "done")
        .sort((a, b) => a.runAt.localeCompare(b.runAt)),
    [pings, monitor?.id],
  );

  useEffect(() => {
    if (!open) return;
    // default: ~5 minutes from now, rounded to the minute
    const target = new Date(Date.now() + 5 * 60_000);
    target.setSeconds(0, 0);
    setWhen(toLocalInputValue(target));
    setNote("");
    setError(null);
  }, [open, monitor?.id]);

  function applyPreset(msAhead: number, label: string) {
    const target = new Date(Date.now() + msAhead);
    target.setSeconds(0, 0);
    setWhen(toLocalInputValue(target));
    toast({ description: `Time set: ${label} (${formatDateTime(target.toISOString())})` });
  }

  function applyTomorrow9() {
    const target = new Date();
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    setWhen(toLocalInputValue(target));
    toast({ description: `Time set: tomorrow 09:00 (${formatDateTime(target.toISOString())})` });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!monitor) return;

    if (!when) {
      setError("Pick a date and time");
      return;
    }
    const runAt = new Date(when).getTime();
    if (Number.isNaN(runAt)) {
      setError("That date/time could not be read");
      return;
    }
    if (runAt < Date.now() - 30_000) {
      setError("Pick a time in the future");
      return;
    }

    setBusy(true);
    try {
      await api("/api/scheduled-pings", {
        method: "POST",
        body: JSON.stringify({
          monitorId: monitor.id,
          runAt,
          note: note.trim() || null,
        }),
      });
      toast({
        description: `Ping scheduled for ${formatDateTime(new Date(runAt).toISOString())} — a real check will run then`,
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

  async function cancelPing(id: string) {
    setCancellingId(id);
    try {
      await api(`/api/scheduled-pings/${id}`, { method: "DELETE" });
      toast({ description: "Scheduled ping cancelled" });
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

  const nowLocal = toLocalInputValue(new Date());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" aria-hidden="true" />
            Schedule a ping
          </DialogTitle>
          <DialogDescription>
            {monitor ? (
              <>
                PING will send <span className="text-foreground">{monitor.name}</span> one real HTTP
                request at the exact time you pick — perfect for right after a deploy.
              </>
            ) : (
              "One real check, at a time you pick."
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "+1 min", ms: 60_000 },
              { label: "+5 min", ms: 300_000 },
              { label: "+1 hour", ms: 3_600_000 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.ms, p.label)}
                className="rounded-none border border-border bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={applyTomorrow9}
              className="rounded-none border border-border bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              tomorrow 09:00
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sp-when">Run at (your local time)</Label>
            <Input
              id="sp-when"
              type="datetime-local"
              value={when}
              min={nowLocal}
              step={60}
              onChange={(e) => setWhen(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sp-note">Note (optional)</Label>
            <Input
              id="sp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. after the morning deploy"
              maxLength={120}
            />
          </div>

          {upcoming.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Already scheduled for this monitor
              </Label>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border bg-muted/30 p-1.5 slim-scrollbar">
                {upcoming.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                  >
                    <Clock
                      className={cn(
                        "size-3.5 shrink-0",
                        p.status === "running" ? "animate-pulse text-primary" : "text-muted-foreground",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-foreground/90">{formatDateTime(p.runAt)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {p.status === "running" ? "running now…" : formatCountdown(p.runAt)}
                      </span>
                      {p.note && (
                        <span className="ml-1 truncate text-muted-foreground/80" title={p.note}>
                          — {p.note}
                        </span>
                      )}
                    </span>
                    {p.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => void cancelPing(p.id)}
                        disabled={cancellingId === p.id}
                        aria-label="Cancel this scheduled ping"
                        className="rounded p-1 text-muted-foreground hover:bg-down/10 hover:text-down disabled:opacity-50"
                      >
                        {cancellingId === p.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <X className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="rounded-md bg-down/10 px-3 py-2 text-xs text-down">{error}</p>}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="bg-white font-semibold text-black hover:bg-zinc-200"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Scheduling…
                </>
              ) : (
                <>
                  <Clock className="size-4" /> Schedule ping
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
