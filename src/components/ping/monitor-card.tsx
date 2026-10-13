"use client";

import { useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Folder,
  FolderInput,
  GripVertical,
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
  formatDateTime,
  formatInterval,
  formatMs,
  formatUptime,
  hostOf,
  timeAgo,
} from "@/lib/ping-client";
import type { FolderDTO, MonitorDTO } from "@/lib/ping-types";
import { formatTimesForDisplay } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { StatusDot, statusLabel, statusWord } from "./status-dot";
import { monitorStatus, averageUpResponseMs, type MonitorStatus } from "@/lib/monitor-status";
import { StatusPill, monitorStatusTone } from "./status-pill";
import { checksToSegments, UptimeBars } from "./uptime-bars";

/** Duration since an outage began, from its real first failed check:
 *  "12m" / "3h 05m" / "1d 4h" / "<1m". */
function formatDownFor(startedAt: string): string {
  const s = Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 1000);
  const m = Math.floor(s / 60);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Drag-reorder contract owned by the dashboard (manual sort mode only). */
export interface CardDnd {
  /** The monitor currently being dragged, or null. */
  draggingId: string | null;
  /** Begin a drag from the card's handle. */
  start: (id: string, e: React.PointerEvent) => void;
  /** Step this card one slot up (-1) or down (1) via the menu. */
  move: (id: string, dir: -1 | 1) => void;
}

export function MonitorCard({
  monitor,
  folders,
  onOpen,
  onEdit,
  onEdited,
  onDeleted,
  onCheckNow,
  onViewIncidents,
  /** Start of the monitor's ONGOING incident (its real first failed check),
   *  or null when none is known — null never becomes a guess. */
  downSince,
  canReorder,
  canMoveUp,
  canMoveDown,
  dnd,
}: {
  monitor: MonitorDTO;
  folders: FolderDTO[];
  onViewIncidents: () => void;
  downSince: string | null;
  onOpen: () => void;
  onEdit: () => void;
  onEdited: () => void;
  onDeleted: () => void;
  onCheckNow: () => void;
  canReorder: boolean;
  /** False at the ends of the visible list — the menu items disable there. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  dnd: CardDnd | null;
}) {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const status: MonitorStatus = monitorStatus(monitor);

  // Up but above the admin's latency threshold — an honest middle state.
  const degraded = status === "up" && monitor.degraded;
  // The average the slow state is judged from, shown on the pill so the
  // number and the label agree.
  const avgUpMs = averageUpResponseMs(monitor.recentChecks);

  const statusTone = monitorStatusTone(status, degraded);

  const isDragging = dnd?.draggingId === monitor.id;

  // Icon shows the action a click performs (PinOff = "unpin"), matching the
  // ⌘K palette; the same pair labels the card button and the phone menu item.
  const PinIcon = monitor.pinned ? PinOff : Pin;
  const pinLabel = monitor.pinned ? "Unpin" : "Pin to top";

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
      const r = await api<{ check: { status: "up" | "down"; statusCode: number | null } }>(
        `/api/monitors/${monitor.id}/check`,
        { method: "POST" },
      );
      toast({
        description: `Check finished — ${statusWord(r.check.status)}${
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

  async function moveToFolder(folderId: string) {
    await patch({ folderId }, "Moved", "move");
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
        role="group"
        data-monitor-id={monitor.id}
        onClick={() => {
          if (dnd?.draggingId) return;
          onOpen();
        }}
        className={cn(
          "ping-fade-up group relative cursor-pointer rounded-lg border bg-card p-3 outline-none transition-colors sm:p-5 @container",
          status === "down" && "border-down/30 hover:border-down/50",
          degraded &&
            "border-warn/30 hover:border-warn/50 hover:bg-warn/[0.03]",
          !monitor.pinned &&
            "hover:border-primary/40 hover:bg-card/70",
          monitor.pinned &&
            "border-primary/35 bg-primary/[0.03] hover:border-primary/50 hover:bg-primary/[0.05]",
          status === "down" && monitor.pinned && "border-down/40 bg-down/[0.04]",
          // Lifted card: it follows the pointer (transform set imperatively) and
          // reads as picked up through light, not a drop shadow — the design
          // system's Light-Not-Shadow rule. z-20 keeps it above its siblings.
          isDragging &&
            "z-20 cursor-grabbing border-primary/60 bg-card will-change-transform shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)]",
        )}
        aria-label={`Monitor ${monitor.name}, status ${
          degraded ? "slow" : statusWord(status)
        }`}
      >
        {/* phone: stacked — full-width identity/meta rows, bars + actions share
            a bottom strip (a side column would pin the name to a ~150px sliver);
            ≥sm: incumbent two-column card, rendering unchanged */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-3">
          {/* drag handle — desktop, manual sort only */}
          {canReorder && (
            <button
              type="button"
              aria-label={`Reorder ${monitor.name}`}
              title="Drag to reorder"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => dnd?.start(monitor.id, e)}
              className={cn(
                "mt-1 hidden size-6 shrink-0 cursor-grab touch-none place-items-center rounded-none text-muted-foreground/50 transition-colors sm:grid",
                "hover:text-foreground focus-visible:text-foreground focus-ring",
                isDragging && "cursor-grabbing text-foreground",
              )}
            >
              <GripVertical className="size-4" aria-hidden="true" />
            </button>
          )}

          <div className="flex min-w-0 flex-1 items-start gap-2">
            <div className="mt-1.5">
              <StatusDot status={checking ? "checking" : status} pulse={status === "up" || status === "down" || checking} />
            </div>

            <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (dnd?.draggingId) return;
                  onOpen();
                }}
                title={`Open details for ${monitor.name}`}
                className="max-w-full truncate rounded-none font-medium leading-tight text-foreground outline-none focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {monitor.name}
              </button>
              {/* min-w-13 + center: live/down/slow are the three states a card
                  flips between, so they share one width — the pill no longer
                  twitches wider on "down". Longer labels still grow. */}
              <StatusPill tone={statusTone} uppercase className="min-w-13 justify-center">
                {checking ? "checking…" : degraded ? "slow" : statusLabel(status)}
              </StatusPill>
              {monitor.account && (
                <StatusPill
                  tone="teal"
                  icon={UserRound}
                  className="max-w-52"
                  title={`Account used: ${monitor.account}`}
                >
                  <span className="min-w-0 truncate">{monitor.account}</span>
                </StatusPill>
              )}
              {monitor.keyword && (
                <StatusPill
                  tone="accent"
                  icon={ScanSearch}
                  className="max-w-52 text-primary/90"
                  title={
                    monitor.keywordMode === "excludes"
                      ? `Keyword check — the response must NOT contain “${monitor.keyword}” (case-insensitive, first 256 KB)`
                      : `Keyword check — the response must contain “${monitor.keyword}” (case-insensitive, first 256 KB)`
                  }
                >
                  <span className="min-w-0 truncate">
                    {monitor.keywordMode === "excludes" ? "no" : "has"} “{monitor.keyword}”
                  </span>
                </StatusPill>
              )}
              {monitor.folderName && (
                <StatusPill tone="neutral" icon={Folder}>
                  {monitor.folderName}
                </StatusPill>
              )}
            </div>

            <a
              href={monitor.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-teal"
            >
              <span className="min-w-0 truncate">{hostOf(monitor.url)}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-foreground/70">
              <span>
                Last updated{" "}
                <span className="text-foreground/95">{timeAgo(monitor.lastCheckAt)}</span>
              </span>
              <span>
                {monitor.scheduleMode === "times" && monitor.scheduleTimes.length > 0
                  ? `at ${formatTimesForDisplay(monitor.scheduleTimes, monitor.timezone ?? "UTC")}`
                  : `every ${formatInterval(monitor.intervalSec)}`}
              </span>
              {/* The average, not the newest sample: the same number the slow
                  state is judged from, so the reading and the pill agree. The
                  `avg` label is stated in text, not a title — touch has none.
                  Ink follows the threshold: amber over it, emerald under it,
                  plain when no threshold is set or the monitor isn't up (a
                  green reading on a down card would be a false signal). */}
              {avgUpMs != null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    degraded && "text-warn",
                    status === "up" && monitor.slowThresholdMs != null && !degraded && "text-up",
                  )}
                  title={
                    monitor.slowThresholdMs != null
                      ? `Average response time of the recent up checks (slow above ${monitor.slowThresholdMs} ms)`
                      : "Average response time of the recent up checks"
                  }
                >
                  <Activity className="size-3" aria-hidden="true" />
                  avg {formatMs(Math.round(avgUpMs))}
                </span>
              )}
              {monitor.stats.uptime24h != null && (
                <span>
                  24h <span className="tabular-nums text-foreground/80">{formatUptime(monitor.stats.uptime24h)}</span>
                </span>
              )}
            </div>

            {monitor.lastError && status === "down" && (
              // Wraps to two lines: on touch there is no hover title, so the
              // card itself must carry the diagnosis (the sheet's check table
              // holds the full history). break-words guards URL-length tokens.
              <p className="mt-1.5 line-clamp-2 break-words text-[11px] text-down/90" title={monitor.lastError}>
                {monitor.lastError}
              </p>
            )}

            {/* The outage moment, answered on the card: how long (the ongoing
                incident's real first failed check — never an estimate) and a
                way into the incidents timeline. */}
            {status === "down" && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-down/90">
                {downSince && (
                  <span
                    className="inline-flex items-center gap-1 py-2 font-medium text-down tabular-nums"
                    title={`Down since ${formatDateTime(downSince)} — stitched from real failed checks`}
                  >
                    down {formatDownFor(downSince)}
                  </span>
                )}
                {downSince && (
                  <span className="text-down/40" aria-hidden="true">·</span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewIncidents();
                  }}
                  title="Open the incidents timeline — down periods stitched from real checks"
                  className="-my-2 inline-flex min-h-11 items-center rounded-none px-0.5 font-medium underline-offset-2 transition-colors hover:text-down hover:underline focus-ring"
                >
                  View incident
                </button>
              </div>
            )}
            </div>
          </div>

          {/* right block: honest-width check bars + actions. Phone: one bottom
              strip — bars flex to the leftover width with the buttons pinned
              right; sm+: side-by-side column with the incumbent width tiers.
              Bars always keep a definite honest width — the buttons can never
              flex-shrink them below it. */}
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
            <div className="min-w-0 flex-1 sm:w-32 sm:flex-none @xl:w-44 @4xl:w-56">
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
                title={pinLabel}
                className={cn(
                  "ml-auto h-11 w-11 hover:bg-secondary max-sm:hidden sm:ml-0 sm:h-8 sm:w-8",
                  monitor.pinned
                    ? "text-primary hover:text-primary"
                    : "text-muted-foreground/60 hover:text-primary",
                )}
              >
                <PinIcon className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={checkNow}
                disabled={checking}
                aria-label="Check now"
                title="Check now"
                className="h-11 w-11 text-muted-foreground hover:bg-secondary hover:text-teal max-sm:hidden sm:h-8 sm:w-8"
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
                    className="h-11 w-11 text-muted-foreground hover:bg-secondary hover:text-foreground sm:h-8 sm:w-8"
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  {/* Two chunks, not ten flat decisions: the monitor's own
                      controls, then the destructive outlier. "Stats & history"
                      is not here — the card itself opens it, one click away. */}
                  {/* Below sm the Pin and Check now icon buttons are hidden, so
                      the menu carries those two actions; at sm+ the icons are
                      visible and these duplicates stay out of the menu. */}
                  <DropdownMenuItem
                    disabled={checking}
                    onClick={checkNow}
                    className="sm:hidden"
                  >
                    <RefreshCw className="size-4" /> Check now
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="size-4" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busyAction === "pause"}
                    onClick={() => patch({ enabled: !monitor.enabled }, monitor.enabled ? "Paused" : "Resumed", "pause")}
                  >
                    <Play className="size-4" /> {monitor.enabled ? "Pause" : "Resume"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busyAction === "pin"}
                    onClick={() => void pinToggle()}
                    className="sm:hidden"
                  >
                    <PinIcon className="size-4" />
                    {pinLabel}
                  </DropdownMenuItem>

                  {folders.length > 0 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <FolderInput className="size-4" /> Move to folder
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {folders.map((f) => (
                          <DropdownMenuItem
                            key={f.id}
                            onClick={() => moveToFolder(f.id)}
                            className={cn(
                              f.id === monitor.folderId && "font-semibold text-foreground",
                            )}
                          >
                            {f.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}

                  <DropdownMenuSeparator />
                  {/* Reorder by menu — the touch and keyboard path. The grip
                      handle above is desktop-only, so without this a phone has
                      no way to reorder. Disabled at the ends of the list. */}
                  {canReorder && (
                    <>
                      <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                        Reorder
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        disabled={!canMoveUp}
                        onClick={() => dnd?.move(monitor.id, -1)}
                      >
                        <ArrowUp className="size-4" /> Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!canMoveDown}
                        onClick={() => dnd?.move(monitor.id, 1)}
                      >
                        <ArrowDown className="size-4" /> Move down
                      </DropdownMenuItem>
                    </>
                  )}

                  <DropdownMenuSeparator />
                  {/* The destructive outlier gets its own labeled chunk —
                      danger is a decision, not an afterthought. */}
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                    Danger
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="size-4" /> Delete…
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
              className="bg-down text-down-foreground hover:bg-down active:scale-[0.98]"
            >
              Delete monitor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
