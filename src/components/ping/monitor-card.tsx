"use client";

import { useState } from "react";
import {
  Activity,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderInput,
  Loader2,
  MoreVertical,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { api, ApiError, formatInterval, formatMs, formatUptime, hostOf, timeAgo } from "@/lib/ping-client";
import type { FolderDTO, MonitorDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { StatusDot, statusLabel } from "./status-dot";
import { checksToSegments, UptimeBars } from "./uptime-bars";

export function MonitorCard({
  monitor,
  folders,
  onOpen,
  onRenamed,
  onEdited,
  onDeleted,
  onCheckNow,
}: {
  monitor: MonitorDTO;
  folders: FolderDTO[];
  onOpen: () => void;
  onRenamed: (name: string) => void;
  onEdited: () => void;
  onDeleted: () => void;
  onCheckNow: () => void;
}) {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const status: "up" | "down" | "paused" | "pending" = !monitor.enabled
    ? "paused"
    : monitor.lastStatus === "up"
      ? "up"
      : monitor.lastStatus === "down"
        ? "down"
        : "pending";

  const statusTone =
    status === "up"
      ? "bg-up/10 text-up border-up/25"
      : status === "down"
        ? "bg-down/10 text-down border-down/25"
        : "bg-muted text-muted-foreground border-border";

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

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          "ping-fade-up group relative cursor-pointer rounded-lg border bg-card p-4 outline-none transition-colors",
          "hover:border-primary/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
          status === "down" && "border-down/30 hover:border-down/50",
        )}
        aria-label={`Monitor ${monitor.name}, status ${statusLabel(status)}`}
      >
        <div className="flex items-start gap-3">
          <div className="mt-1.5">
            <StatusDot status={checking ? "checking" : status} pulse={status === "up" || status === "down" || checking} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate font-medium leading-tight text-foreground">
                {monitor.name}
              </span>
              <span
                className={cn(
                  "rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
                  statusTone,
                )}
              >
                {checking ? "checking…" : statusLabel(status)}
              </span>
              {monitor.folderName && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
                  <Folder className="size-2.5" aria-hidden="true" />
                  {monitor.folderName}
                </span>
              )}
              <span className="rounded-full border border-border bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
                every {formatInterval(monitor.intervalSec)}
              </span>
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

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                Last updated{" "}
                <span className="text-foreground/80">{timeAgo(monitor.lastCheckAt)}</span>
              </span>
              {monitor.lastResponseMs != null && (
                <span className="inline-flex items-center gap-1">
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
