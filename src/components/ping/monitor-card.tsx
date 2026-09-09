"use client";

import { useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  FolderInput,
  Gauge,
  GripVertical,
  Hourglass,
  Loader2,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  ScanSearch,
  Trash2,
  UserRound,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  formatCountdown,
  formatInterval,
  formatMs,
  formatUptime,
  hostOf,
  timeAgo,
} from "@/lib/ping-client";
import type { FolderDTO, MaintenanceWindowDTO, MonitorDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { StatusDot, statusLabel } from "./status-dot";
import { checksToSegments, UptimeBars } from "./uptime-bars";

/** Time left in an active maintenance window: "12m left" / "1h 05m left". */
function formatMaintenanceLeft(endsAt: string): string {
  const s = Math.max(0, (new Date(endsAt).getTime() - Date.now()) / 1000);
  if (s <= 0) return "ending…";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${String(m % 60).padStart(2, "0")}m left` : `${Math.floor(h / 24)}d ${h % 24}h left`;
}

/** Drag-and-drop contract owned by the dashboard (manual sort mode only). */
export interface CardDnd {
  isDragging: boolean;
  onDragStart: (id: string) => void;
  onDragOverCard: (id: string) => void;
  onDragEnd: () => void;
}

export function MonitorCard({
  monitor,
  folders,
  onOpen,
  onRenamed,
  onEdited,
  onDeleted,
  onCheckNow,
  onSchedulePing,
  onScheduleMaintenance,
  nextPingAt,
  maintenanceWindow,
  canReorder,
  canMoveUp,
  canMoveDown,
  onMove,
  dnd,
}: {
  monitor: MonitorDTO;
  folders: FolderDTO[];
  onOpen: () => void;
  onRenamed: (name: string) => void;
  onEdited: () => void;
  onDeleted: () => void;
  onCheckNow: () => void;
  onSchedulePing: () => void;
  onScheduleMaintenance: () => void;
  nextPingAt: string | null;
  /** Active or next upcoming window for this monitor (null = none). */
  maintenanceWindow: MaintenanceWindowDTO | null;
  canReorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: "up" | "down") => void;
  dnd: CardDnd | null;
}) {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [dragArmed, setDragArmed] = useState(false);

  const status: "up" | "down" | "paused" | "pending" = !monitor.enabled
    ? "paused"
    : monitor.lastStatus === "up"
      ? "up"
      : monitor.lastStatus === "down"
        ? "down"
        : "pending";

  // Up but above the admin's latency threshold — an honest middle state.
  const degraded = status === "up" && monitor.degraded;

  // Maintenance context: is the window active right now, or upcoming?
  const maintenanceNow =
    maintenanceWindow != null &&
    new Date(maintenanceWindow.startsAt).getTime() <= Date.now() &&
    new Date(maintenanceWindow.endsAt).getTime() > Date.now();
  const maintenanceUpcoming =
    maintenanceWindow != null && new Date(maintenanceWindow.startsAt).getTime() > Date.now();

  const statusTone =
    status === "up"
      ? degraded
        ? "bg-warn/15 text-warn border-warn/40"
        : "bg-up/10 text-up border-up/25"
      : status === "down"
        ? maintenanceNow
          ? "bg-warn/15 text-warn border-warn/40"
          : "bg-down/10 text-down border-down/25"
        : "bg-muted text-muted-foreground border-border";

  const beingDragged = dnd?.isDragging === true && dragArmed;

  async function runAction(key: string, fn: () => Promise<unknown>, success: string) {
    setBusyAction(key);
    try {
      await fn();
      toast({ description: success });
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Action failed",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function checkNow(e: React.MouseEvent) {
    e.stopPropagation();
    if (checking) return;
    setChecking(true);
    try {
      const r = await api<{ check: { status: string; statusCode: number | null } }>(
        `/api/monitors/${monitor.id}/check`,
        { method: "POST" },
      );
      toast({
        description: `Check finished — ${r.check.status === "up" ? "up" : "down"}${
          r.check.statusCode != null ? ` (HTTP ${r.check.statusCode})` : ""
        }`,
      });
      onCheckNow();
    } catch (e) {
      toast({
        description: e instanceof ApiError || e instanceof Error ? e.message : "Check failed",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  }

  async function patch(data: Record<string, unknown>, success: string, key = "patch") {
    await runAction(
      key,
      () => api(`/api/monitors/${monitor.id}`, { method: "PATCH", body: JSON.stringify(data) }),
      success,
    );
    onEdited();
  }

  async function moveToFolder(folderId: string | null) {
    await patch({ folderId }, folderId ? "Moved" : "Removed from folder", "move");
  }

  async function rename() {
    const name = window.prompt("Rename monitor", monitor.name);
    if (!name || name.trim() === monitor.name) return;
    await patch({ name: name.trim() }, "Monitor renamed", "rename");
    onRenamed(name.trim());
  }

  async function deleteMonitor() {
    setConfirmDelete(false);
    await runAction(
      "delete",
      () => api(`/api/monitors/${monitor.id}`, { method: "DELETE" }),
      "Monitor deleted",
    );
    onDeleted();
  }

  async function pinToggle() {
    await patch(
      { pinned: !monitor.pinned },
      monitor.pinned ? "Unpinned" : "Pinned to top",
      "pin",
    );
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (dnd?.isDragging || dragArmed) return;
          onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        draggable={!!dnd && canReorder && dragArmed}
        onDragStart={(e) => {
          if (!dnd || !canReorder) {
            e.preventDefault();
            return;
          }
          // real drags only start on draggable elements (armed via the
          // handle); accepting any dispatched dragstart is harmless
          e.dataTransfer.effectAllowed = "move";
          try {
            e.dataTransfer.setData("text/plain", monitor.id);
          } catch {
            /* some browsers require data — ignore failures */
          }
          dnd.onDragStart(monitor.id);
        }}
        onDragOver={(e) => {
          if (!dnd || !dnd.isDragging) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          dnd.onDragOverCard(monitor.id);
        }}
        onDrop={(e) => {
          // The browser fires dragend on the source right after a drop —
          // commit happens there, so here we only allow the drop.
          e.preventDefault();
        }}
        onDragEnd={() => {
          setDragArmed(false);
          dnd?.onDragEnd();
        }}
        className={cn(
          "ping-fade-up group relative cursor-pointer rounded-lg border bg-card p-4 outline-none transition-colors sm:p-5",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
          status === "down" && !maintenanceNow && "border-down/30 hover:border-down/50",
          degraded && !maintenanceNow &&
            "border-warn/30 hover:border-warn/50 hover:bg-warn/[0.03]",
          !monitor.pinned && !maintenanceNow &&
            "hover:border-primary/40 hover:bg-card/70",
          monitor.pinned && !maintenanceNow &&
            "border-primary/35 bg-primary/[0.03] hover:border-primary/50 hover:bg-primary/[0.05]",
          status === "down" && monitor.pinned && !maintenanceNow && "border-down/40 bg-down/[0.04]",
          maintenanceNow &&
            "border-warn/35 bg-warn/[0.03] hover:border-warn/50 hover:bg-warn/[0.06]",
          beingDragged && "opacity-40",
          dnd?.isDragging && !dragArmed && "transition-transform",
        )}
        aria-label={`Monitor ${monitor.name}, status ${
          status === "down" && maintenanceNow ? "under maintenance" : degraded ? "slow" : statusLabel(status)
        }${monitor.pinned ? ", pinned" : ""}${maintenanceNow ? ", maintenance active" : ""}`}
      >
        <div className="flex items-start gap-2 sm:gap-3">
          {/* drag handle — desktop, manual sort only */}
          {canReorder && (
            <button
              type="button"
              aria-label={`Reorder ${monitor.name} (drag, or use Move up/down in the menu)`}
              title="Drag to reorder"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={() => setDragArmed(true)}
              onPointerUp={() => setDragArmed(false)}
              onPointerCancel={() => setDragArmed(false)}
              draggable={false}
              className={cn(
                "mt-1 hidden size-6 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground/50 transition-colors active:cursor-grabbing sm:grid",
                "hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                dragArmed && "text-foreground",
              )}
            >
              <GripVertical className="size-4" aria-hidden="true" />
            </button>
          )}

          <div className="mt-1.5">
            <StatusDot status={checking ? "checking" : status} pulse={status === "up" || status === "down" || checking} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate font-medium leading-tight text-foreground">
                {monitor.name}
              </span>
              {monitor.pinned && (
                <span
                  title="Pinned to top"
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary"
                >
                  <Pin className="size-2.5" aria-hidden="true" />
                  pinned
                </span>
              )}
              <span
                className={cn(
                  "rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
                  statusTone,
                )}
              >
                {checking
                  ? "checking…"
                  : status === "down" && maintenanceNow
                    ? "maintenance"
                    : degraded
                      ? "slow"
                      : statusLabel(status)}
              </span>
              {degraded && monitor.slowThresholdMs != null && (
                <span
                  title={`Response time above the ${monitor.slowThresholdMs} ms latency threshold${
                    monitor.lastResponseMs != null ? ` — last check ${formatMs(monitor.lastResponseMs)}` : ""
                  }`}
                  className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/15 px-1.5 py-px text-[10px] font-medium text-warn"
                >
                  <Gauge className="size-2.5" aria-hidden="true" />
                  {monitor.lastResponseMs != null
                    ? `${formatMs(monitor.lastResponseMs)} > ${monitor.slowThresholdMs} ms`
                    : `> ${monitor.slowThresholdMs} ms`}
                </span>
              )}
              {maintenanceNow && (
                <span
                  title={`Maintenance until ${new Date(maintenanceWindow!.endsAt).toLocaleString()} — alerts silenced`}
                  className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn/10 px-1.5 py-px text-[10px] font-medium text-warn"
                >
                  <Wrench className="size-2.5" aria-hidden="true" />
                  {formatMaintenanceLeft(maintenanceWindow!.endsAt)}
                </span>
              )}
              {maintenanceUpcoming && (
                <span
                  title={`Maintenance starts ${new Date(maintenanceWindow!.startsAt).toLocaleString()}`}
                  className="inline-flex items-center gap-1 rounded-full border border-warn/25 bg-warn/[0.06] px-1.5 py-px text-[10px] text-warn/80"
                >
                  <Wrench className="size-2.5" aria-hidden="true" />
                  maint. {formatCountdown(maintenanceWindow!.startsAt)}
                </span>
              )}
              {monitor.account && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-teal/25 bg-teal/10 px-1.5 py-px text-[10px] text-teal"
                  title={`Account used: ${monitor.account}`}
                >
                  <UserRound className="size-2.5" aria-hidden="true" />
                  {monitor.account}
                </span>
              )}
              {monitor.keyword && (
                <span
                  title={
                    monitor.keywordMode === "excludes"
                      ? `Keyword check — the response must NOT contain “${monitor.keyword}” (case-insensitive, first 256 KB)`
                      : `Keyword check — the response must contain “${monitor.keyword}” (case-insensitive, first 256 KB)`
                  }
                  className="inline-flex max-w-52 items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-px text-[10px] text-primary/90"
                >
                  <ScanSearch className="size-2.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {monitor.keywordMode === "excludes" ? "no" : "has"} “{monitor.keyword}”
                  </span>
                </span>
              )}
              {status === "down" &&
                !maintenanceNow &&
                monitor.alertDelay > 0 &&
                monitor.consecutiveDowns <= monitor.alertDelay && (
                  <span
                    title={`Down alerts fire after ${monitor.alertDelay + 1} consecutive failed checks — the status above is already honest downtime`}
                    className="inline-flex items-center gap-1 rounded-full border border-warn/25 bg-warn/[0.08] px-1.5 py-px text-[10px] font-medium text-warn/90"
                  >
                    <Hourglass className="size-2.5" aria-hidden="true" />
                    confirming {monitor.consecutiveDowns}/{monitor.alertDelay + 1}
                  </span>
                )}
              {monitor.folderName && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
                  <Folder className="size-2.5" aria-hidden="true" />
                  {monitor.folderName}
                </span>
              )}
              <span className="rounded-full border border-border bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
                every {formatInterval(monitor.intervalSec)}
              </span>
              {nextPingAt && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-px text-[10px] text-primary/90"
                  title={`Scheduled ping ${formatCountdown(nextPingAt)} — ${new Date(nextPingAt).toLocaleString()}`}
                >
                  <Clock className="size-2.5" aria-hidden="true" />
                  ping {formatCountdown(nextPingAt)}
                </span>
              )}
            </div>

            <a
              href={monitor.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-teal"
            >
              <span className="truncate">{hostOf(monitor.url)}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
              <span>
                Last updated{" "}
                <span className="text-foreground/80">{timeAgo(monitor.lastCheckAt)}</span>
              </span>
              {monitor.lastResponseMs != null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    degraded && "text-warn",
                  )}
                >
                  <Activity className="size-3" aria-hidden="true" />
                  {formatMs(monitor.lastResponseMs)}
                </span>
              )}
              {monitor.lastStatusCode != null && (
                <span
                  className={cn(
                    "tabular-nums",
                    monitor.lastStatusCode >= 400 ? "text-down" : "text-up",
                  )}
                >
                  HTTP {monitor.lastStatusCode}
                </span>
              )}
              {monitor.stats.uptime24h != null && (
                <span>
                  24h <span className="tabular-nums text-foreground/80">{formatUptime(monitor.stats.uptime24h)}</span>
                </span>
              )}
            </div>

            {monitor.lastError && status === "down" && (
              <p className="mt-1.5 truncate text-[11px] text-down/90" title={monitor.lastError}>
                {monitor.lastError}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
            <div className="w-24 sm:w-32">
              <UptimeBars
                segments={checksToSegments(monitor.recentChecks)}
                barClassName="h-6 sm:h-7"
              />
            </div>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  void pinToggle();
                }}
                disabled={busyAction === "pin"}
                aria-label={monitor.pinned ? "Unpin monitor" : "Pin to top"}
                title={monitor.pinned ? "Unpin" : "Pin to top"}
                className={cn(
                  "h-8 w-8",
                  monitor.pinned
                    ? "text-primary hover:text-primary"
                    : "text-muted-foreground/60 hover:text-primary",
                )}
              >
                {monitor.pinned ? (
                  <Pin className="size-4" aria-hidden="true" />
                ) : (
                  <PinOff className="size-4" aria-hidden="true" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={checkNow}
                disabled={checking}
                aria-label="Check now"
                title="Check now"
                className="h-8 w-8 text-muted-foreground hover:text-teal"
              >
                {checking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Monitor actions"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => setTimeout(() => void rename(), 0)}>
                    <Pencil className="size-4" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onOpen}>
                    Stats &amp; history <ChevronRight className="size-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onSchedulePing}>
                    <Clock className="size-4" /> Schedule ping…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onScheduleMaintenance}>
                    <Wrench className="size-4" /> Schedule maintenance…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busyAction === "pause"}
                    onClick={() => patch({ enabled: !monitor.enabled }, monitor.enabled ? "Paused" : "Resumed", "pause")}
                  >
                    <Play className="size-4" /> {monitor.enabled ? "Pause checks" : "Resume checks"}
                  </DropdownMenuItem>

                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <FolderInput className="size-4" /> Move to folder
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={() => moveToFolder(null)}>
                        (no folder)
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {folders.map((f) => (
                        <DropdownMenuItem
                          key={f.id}
                          disabled={f.id === monitor.folderId}
                          onClick={() => moveToFolder(f.id)}
                        >
                          {f.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuItem
                    disabled={busyAction === "visibility"}
                    onClick={() =>
                      patch(
                        { statusHidden: !monitor.statusHidden },
                        monitor.statusHidden
                          ? "Visible on the public status page"
                          : "Hidden from the public status page",
                        "visibility",
                      )
                    }
                  >
                    {monitor.statusHidden ? (
                      <Eye className="size-4" />
                    ) : (
                      <EyeOff className="size-4" />
                    )}
                    {monitor.statusHidden ? "Show on status page" : "Hide from status page"}
                  </DropdownMenuItem>

                  {canReorder && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                        Reorder
                      </DropdownMenuLabel>
                      <DropdownMenuItem disabled={!canMoveUp} onClick={() => onMove("up")}>
                        <ArrowUp className="size-4" /> Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!canMoveDown} onClick={() => onMove("down")}>
                        <ArrowDown className="size-4" /> Move down
                      </DropdownMenuItem>
                    </>
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="size-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{monitor.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The monitor and its entire recorded check history will be removed.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteMonitor}
              className="bg-down text-white hover:bg-down/90"
            >
              Delete monitor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
