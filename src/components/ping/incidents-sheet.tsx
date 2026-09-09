"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  Pencil,
  Plus,
  ShieldQuestion,
  Trash2,
  X,
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError, formatDateTime, formatDuration } from "@/lib/ping-client";
import type { AdminIncidentDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";

/**
 * Admin view of the last 30 days of incidents (derived from real checks)
 * with postmortem-note editing. Notes attach to the incident's exact start
 * and are shown on the public status page — write them for an audience.
 */
export function IncidentsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [incidents, setIncidents] = useState<AdminIncidentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ incidents: AdminIncidentDTO[] }>("/api/incidents");
      setIncidents(r.incidents);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load incidents");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function saveNote(inc: AdminIncidentDTO, note: string) {
    try {
      await api("/api/incidents", {
        method: "POST",
        body: JSON.stringify({ monitorId: inc.monitorId, startedAt: inc.startedAt, note }),
      });
      setIncidents((prev) =>
        (prev ?? []).map((i) =>
          i.monitorId === inc.monitorId && i.startedAt === inc.startedAt ? { ...i, note } : i,
        ),
      );
      toast({ description: "Note saved — visible on the public status page" });
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Failed to save note",
        variant: "destructive",
      });
    }
  }

  async function clearNote(inc: AdminIncidentDTO) {
    try {
      await api(
        `/api/incidents?monitorId=${encodeURIComponent(inc.monitorId)}&startedAt=${encodeURIComponent(inc.startedAt)}`,
        { method: "DELETE" },
      );
      setIncidents((prev) =>
        (prev ?? []).map((i) =>
          i.monitorId === inc.monitorId && i.startedAt === inc.startedAt ? { ...i, note: null } : i,
        ),
      );
      toast({ description: "Note removed" });
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Failed to remove note",
        variant: "destructive",
      });
    }
  }

  const now = Date.now();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-down/90" aria-hidden="true" />
            Incidents
            {incidents && incidents.length > 0 && (
              <span className="rounded-full border border-down/30 bg-down/10 px-1.5 py-px text-[10px] font-medium tabular-nums text-down">
                {incidents.length}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            Down periods stitched from real checks over the last 30 days. Attach a postmortem note
            to any incident and it appears on the public status page.
          </SheetDescription>
        </SheetHeader>

        {error && (
          <div className="px-4 pt-3">
            <p className="rounded-md border border-down/30 bg-down/10 px-3 py-2 text-xs text-down">
              {error}
            </p>
          </div>
        )}

        {incidents == null && !error ? (
          <div className="space-y-2.5 px-4 py-4">
            <div className="h-20 animate-pulse rounded-lg border bg-muted/30" />
            <div className="h-20 animate-pulse rounded-lg border bg-muted/30" />
            <div className="h-20 animate-pulse rounded-lg border bg-muted/30" />
          </div>
        ) : incidents != null && incidents.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
            <div className="grid size-12 place-items-center rounded-full border border-dashed border-border">
              <ShieldQuestion className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No incidents in the last 30 days</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                When a monitor fails consecutive checks, the down period shows up here — and on the
                public status page.
              </p>
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-2.5 px-4 py-4">
              {(incidents ?? []).map((inc, i) => (
                <IncidentRow
                  key={`${inc.monitorId}-${inc.startedAt}-${i}`}
                  inc={inc}
                  now={now}
                  onSave={(note) => void saveNote(inc, note)}
                  onClear={() => void clearNote(inc)}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function IncidentRow({
  inc,
  now,
  onSave,
  onClear,
}: {
  inc: AdminIncidentDTO;
  now: number;
  onSave: (note: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(inc.note ?? "");
  const [busy, setBusy] = useState(false);

  const started = new Date(inc.startedAt);
  const ended = inc.endedAt ? new Date(inc.endedAt) : null;
  const durationMs = (ended ? ended.getTime() : now) - started.getTime();

  function startEdit() {
    setDraft(inc.note ?? "");
    setEditing(true);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setBusy(true);
    await onSave(trimmed);
    setBusy(false);
    setEditing(false);
  }

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-foreground">{inc.monitorName}</span>
        {ended ? (
          <span className="text-[11px] text-muted-foreground">resolved</span>
        ) : (
          <span className="rounded-full border border-down/40 bg-down/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-down">
            ongoing
          </span>
        )}
        {inc.duringMaintenance && (
          <span
            title="This down period overlapped a planned maintenance window"
            className="rounded-full border border-warn/35 bg-warn/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-warn"
          >
            during maintenance
          </span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
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

      {editing ? (
        <div className="mt-2 space-y-1.5">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            rows={3}
            autoFocus
            placeholder="What happened, why, and what fixed it — this text is shown publicly…"
            aria-label={`Postmortem note for ${inc.monitorName} incident`}
            className="text-xs"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 bg-white px-2.5 text-xs font-semibold text-black hover:bg-zinc-200"
              onClick={() => void save()}
              disabled={busy || !draft.trim()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Save note
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/70">
              {draft.length}/500
            </span>
          </div>
        </div>
      ) : inc.note ? (
        <div className="mt-2">
          <p className="rounded-md border-l-2 border-primary/30 bg-muted/40 px-2.5 py-1.5 text-xs italic leading-relaxed text-foreground/75">
            {inc.note}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={startEdit}
            >
              <Pencil className="size-3" /> Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-down"
              onClick={() => void onClear()}
            >
              <Trash2 className="size-3" /> Remove
            </Button>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <FileText className="size-3" aria-hidden="true" /> on the status page
            </span>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className={cn("mt-1.5 h-6 gap-1 px-2 text-[11px] text-muted-foreground")}
          onClick={startEdit}
        >
          <Plus className="size-3" /> Add postmortem note
        </Button>
      )}
    </div>
  );
}
