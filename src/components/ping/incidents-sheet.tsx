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
import { api, formatDateTime, formatDuration } from "@/lib/ping-client";
import type { AdminIncidentDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { StatusPill } from "./status-pill";
import { EmptyState } from "./empty-state";
import { InlineAlert } from "./inline-alert";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Admin view of the last 30 days of incidents (derived from real checks)
 * with postmortem-note editing. Notes attach to the incident's exact start.
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
      toast({ description: "Note saved" });
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
            Down periods stitched from real checks over the last 30 days. Attach a postmortem note
            to any incident to record what happened for your own reference.
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
                  onSave={(note) => saveNote(inc, note)}
                  onClear={() => clearNote(inc)}
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
          <StatusPill tone="down" size="sm" uppercase>
            ongoing
          </StatusPill>
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
            placeholder="What happened, why, and what fixed it…"
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
          <p className="rounded-none border-l border-primary/30 bg-muted/40 px-2.5 py-1.5 text-xs italic leading-relaxed text-foreground/75">
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
              <FileText className="size-3" aria-hidden="true" /> your note
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
