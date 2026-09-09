"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarClock,
  FolderPlus,
  Folder,
  Gauge,
  LayoutGrid,
  ListChecks,
  LockKeyhole,
  LockOpen,
  LogOut,
  MoveVertical,
  Plus,
  RefreshCw,
  Search,
  Settings,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useOverview } from "@/hooks/use-overview";
import { api, ApiError, formatUptime, timeAgo } from "@/lib/ping-client";
import type { FolderDTO, MonitorDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { PingLogo, PingWordmark } from "./ping-logo";
import { MonitorCard, type CardDnd } from "./monitor-card";
import { MonitorDetailSheet } from "./monitor-detail-sheet";
import { AddMonitorDialog } from "./add-monitor-dialog";
import { SchedulePingDialog } from "./schedule-ping-dialog";
import { ScheduledPingsSheet } from "./scheduled-pings-sheet";
import { TextPromptDialog } from "./text-prompt-dialog";
import { StatCard } from "./stat-card";

export type SortMode = "manual" | "az" | "za" | "status";
const SORT_STORAGE_KEY = "ping.sort";

export function DashboardView({
  adminUnlocked,
  onLogout,
  onOpenAdmin,
  onLockAdmin,
}: {
  adminUnlocked: boolean;
  onLogout: () => void;
  onOpenAdmin: () => void;
  onLockAdmin: () => void;
}) {
  const { data, error, loading, refreshing, refresh } = useOverview(15000);
  const { toast } = useToast();

  // view state
  const [activeFolder, setActiveFolder] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MonitorDTO | null>(null);
  const [folderDialog, setFolderDialog] = useState<{
    open: boolean;
    mode: "create" | "rename";
    folder?: FolderDTO;
  }>({ open: false, mode: "create" });

  // sort — persisted per device
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  useEffect(() => {
    try {
      const v = localStorage.getItem(SORT_STORAGE_KEY);
      if (v === "manual" || v === "az" || v === "za" || v === "status") setSortMode(v);
    } catch {
      /* private browsing etc. */
    }
  }, []);
  function changeSort(v: string) {
    const mode = (v as SortMode) ?? "manual";
    setSortMode(mode);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }

  // scheduled pings — sheet + per-monitor dialog
  const [pingsOpen, setPingsOpen] = useState(false);
  const [scheduleTargetId, setScheduleTargetId] = useState<string | null>(null);

  // drag-and-drop reorder (manual sort only)
  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<MonitorDTO[] | null>(null);
  const committingRef = useRef(false);

  const monitors = data?.monitors ?? [];
  const folders = data?.folders ?? [];
  const summary = data?.summary;

  const detailMonitor = detailId ? (monitors.find((m) => m.id === detailId) ?? null) : null;
  const scheduleMonitor = scheduleTargetId
    ? (monitors.find((m) => m.id === scheduleTargetId) ?? null)
    : null;

  // the manual-order list: server order (pinned → position), or the live
  // drag preview while reordering
  const manualList = preview ?? monitors;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: MonitorDTO[] = manualList;
    if (activeFolder !== "all") list = list.filter((m) => m.folderId === activeFolder);
    if (q) {
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.url.toLowerCase().includes(q) ||
          (m.folderName ?? "").toLowerCase().includes(q) ||
          (m.account ?? "").toLowerCase().includes(q),
      );
    }

    if (sortMode === "status") {
      // down first, then pending, then up, then paused; pinned wins within a rank
      const rank = (m: MonitorDTO) =>
        !m.enabled ? 3 : m.lastStatus === "down" ? 0 : m.lastStatus === null ? 1 : 2;
      return [...list].sort(
        (a, b) => rank(a) - rank(b) || Number(b.pinned) - Number(a.pinned) || a.position - b.position,
      );
    }

    if (sortMode === "az" || sortMode === "za") {
      const dir = sortMode === "az" ? 1 : -1;
      const sorted = [...list].sort(
        (a, b) =>
          dir *
            a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) ||
          a.position - b.position,
      );
      // pinned monitors always float to the top, even when browsing alphabetically
      return [...sorted.filter((m) => m.pinned), ...sorted.filter((m) => !m.pinned)];
    }

    // manual: list already arrives pinned-first in position order (server
    // order, or the live drag preview)
    return list;
  }, [manualList, activeFolder, query, sortMode]);

  // next pending scheduled ping per monitor (for the card badge)
  const nextPingByMonitor = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of data?.scheduledPings ?? []) {
      if (p.status === "done") continue;
      const existing = map.get(p.monitorId);
      if (!existing || p.runAt < existing) map.set(p.monitorId, p.runAt);
    }
    return map;
  }, [data?.scheduledPings]);

  const pendingPingCount = useMemo(
    () => (data?.scheduledPings ?? []).filter((p) => p.status !== "done").length,
    [data?.scheduledPings],
  );

  const folderStats = useMemo(() => {
    const map = new Map<string, { total: number; down: number }>();
    for (const f of folders) map.set(f.id, { total: 0, down: 0 });
    for (const m of monitors) {
      if (!m.folderId) continue;
      const s = map.get(m.folderId);
      if (!s) continue;
      s.total += 1;
      if (m.enabled && m.lastStatus === "down") s.down += 1;
    }
    return map;
  }, [monitors, folders]);

  async function createFolder(name: string) {
    await api("/api/folders", { method: "POST", body: JSON.stringify({ name }) });
    toast({ description: `Folder “${name}” created` });
    refresh(true);
  }

  async function renameFolder(name: string) {
    const folder = folderDialog.folder;
    if (!folder) return;
    await api(`/api/folders/${folder.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
    toast({ description: "Folder renamed" });
    refresh(true);
  }

  async function deleteFolder(id: string) {
    try {
      await api(`/api/folders/${id}`, { method: "DELETE" });
      toast({ description: "Folder deleted — its monitors moved to the top level" });
      if (activeFolder === id) setActiveFolder("all");
      refresh(true);
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Failed to delete folder",
        variant: "destructive",
      });
    }
  }

  // ---------- reorder / pin engine ----------

  /**
   * After moving `movedId` inside `list`, decides whether it should be
   * pinned: the pinned zone is the block of OTHER pinned monitors at the
   * top — dropping strictly inside it pins the card, landing at or below
   * the boundary (first unpinned slot) unpins it.
   */
  function pinnedSetAfterMove(list: MonitorDTO[], movedId: string): Set<string> {
    const pinned = new Set(list.filter((m) => m.pinned).map((m) => m.id));
    const idx = list.findIndex((m) => m.id === movedId);
    if (idx >= 0) {
      const otherPinned = list.filter((m) => m.id !== movedId && m.pinned).length;
      if (idx < otherPinned) pinned.add(movedId);
      else pinned.delete(movedId);
    }
    return pinned;
  }

  /** Persists an order (and pin set) to the server, then refreshes. */
  async function commitOrder(list: MonitorDTO[], movedId: string | null) {
    if (committingRef.current) return;
    committingRef.current = true;
    const ids = list.map((m) => m.id);
    const pinned = movedId
      ? pinnedSetAfterMove(list, movedId)
      : new Set(list.filter((m) => m.pinned).map((m) => m.id));
    try {
      await api("/api/monitors/reorder", {
        method: "PATCH",
        body: JSON.stringify({ ids, pinnedIds: [...pinned] }),
      });
      if (movedId) {
        const before = monitors.find((m) => m.id === movedId)?.pinned ?? false;
        if (before !== pinned.has(movedId)) {
          toast({
            description: pinned.has(movedId)
              ? "Moved into the pinned zone — pinned to top"
              : "Moved below the pinned zone — unpinned",
          });
        }
      }
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Could not save the new order",
        variant: "destructive",
      });
    } finally {
      committingRef.current = false;
      setPreview(null);
      setDragId(null);
      refresh(true);
    }
  }

  /** Move up/down via the card menu — works everywhere incl. touch. */
  async function moveMonitor(id: string, dir: "up" | "down") {
    if (sortMode !== "manual") return;
    const list = [...manualList];
    const i = list.findIndex((m) => m.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setPreview(list); // instant feedback
    await commitOrder(list, id);
  }

  // contract handed to each card (manual sort only)
  const dnd: CardDnd | null =
    sortMode === "manual" && monitors.length > 0
      ? {
          isDragging: dragId != null,
          onDragStart: (id) => setDragId(id),
          onDragOverCard: (targetId) => {
            if (!dragId || dragId === targetId) return;
            setPreview((prev) => {
              const list = prev ?? monitors;
              const from = list.findIndex((m) => m.id === dragId);
              const to = list.findIndex((m) => m.id === targetId);
              if (from < 0 || to < 0 || from === to) return list;
              const next = [...list];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              return next;
            });
          },
          onDragEnd: () => {
            if (!dragId) return;
            void commitOrder(preview ?? monitors, dragId);
          },
        }
      : null;

  async function cancelScheduledPing(id: string) {
    await api(`/api/scheduled-pings/${id}`, { method: "DELETE" });
    refresh(true);
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      onLogout();
    }
  }

  const headerPill = (label: string, value: number, tone: string) => (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums", tone)}>
      {value}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );

  return (
    <div className="ping-ambient flex min-h-dvh flex-col">
      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <PingLogo className="size-7" />
          <PingWordmark className="text-base" />
          <span className="hidden text-xs text-muted-foreground sm:inline">uptime for Render Free</span>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {summary && (
              <div className="hidden items-center gap-1.5 md:flex">
                {headerPill("up", summary.up, "border-up/25 bg-up/10 text-up")}
                {headerPill("down", summary.down, "border-down/25 bg-down/10 text-down")}
                {summary.paused > 0 && headerPill("paused", summary.paused, "border-border bg-muted text-muted-foreground")}
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refresh()}
              disabled={refreshing}
              aria-label="Refresh"
              title="Refresh now"
              className="text-muted-foreground hover:text-teal"
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Menu" className="text-muted-foreground hover:text-foreground">
                  <span className="relative">
                    <Settings className="size-4" aria-hidden="true" />
                    {adminUnlocked && (
                      <span
                        className="absolute -right-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-full bg-teal text-[#0b0d12]"
                        title="Settings unlocked"
                      >
                        <LockOpen className="size-2.5" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={onOpenAdmin}>
                  {adminUnlocked ? (
                    <LockOpen className="size-4 text-teal" />
                  ) : (
                    <LockKeyhole className="size-4" />
                  )}
                  Settings &amp; keep-awake
                  <span
                    className={cn(
                      "ml-auto text-[10px] font-medium",
                      adminUnlocked ? "text-teal" : "text-muted-foreground",
                    )}
                  >
                    {adminUnlocked ? "unlocked" : "admin"}
                  </span>
                </DropdownMenuItem>
                {adminUnlocked && (
                  <DropdownMenuItem onClick={onLockAdmin}>
                    <LockKeyhole className="size-4" /> Lock settings now
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={logout}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              className="hidden bg-white font-semibold text-black shadow-sm transition-transform hover:bg-zinc-200 active:scale-[0.98] sm:inline-flex"
            >
              <Plus className="size-4" /> New monitor
            </Button>
          </div>
        </div>
      </header>

      {/* ---------- body: sidebar (lg) + main ---------- */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 gap-6 px-0 sm:px-4 lg:px-4">
        {/* folder nav — sidebar on desktop */}
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 flex-col gap-0.5 overflow-y-auto py-4 lg:flex">
          <button
            onClick={() => setActiveFolder("all")}
            className={cn(
              "flex items-center gap-2 rounded-md border-l-2 px-2.5 py-2 text-sm transition-colors",
              activeFolder === "all"
                ? "border-primary bg-secondary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <LayoutGrid className="size-4" aria-hidden="true" />
            All monitors
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {monitors.length}
            </span>
          </button>

          {folders.map((f) => {
            const s = folderStats.get(f.id);
            const active = activeFolder === f.id;
            return (
              <div key={f.id} className="group relative">
                <button
                  onClick={() => setActiveFolder(f.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border-l-2 px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "border-primary bg-secondary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <Folder className={cn("size-4", s?.down ? "text-down" : "text-muted-foreground")} aria-hidden="true" />
                  <span className="truncate">{f.name}</span>
                  <span className="ml-auto pr-6 text-xs tabular-nums text-muted-foreground">
                    {s?.total ?? 0}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`Folder actions for ${f.name}`}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Settings className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => setFolderDialog({ open: true, mode: "rename", folder: f })}
                    >
                      Rename folder
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => deleteFolder(f.id)}>
                      Delete folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}

          <button
            onClick={() => setFolderDialog({ open: true, mode: "create" })}
            className="mt-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground/80 transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <FolderPlus className="size-4" aria-hidden="true" />
            New folder
          </button>
        </aside>

        {/* main column */}
        <main className="min-w-0 flex-1 space-y-4 px-4 pb-24 pt-4 sm:px-0 sm:pb-10">
          {/* mobile folder chips */}
          <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 lg:hidden">
            <button
              onClick={() => setActiveFolder("all")}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                activeFolder === "all"
                  ? "border-primary/40 bg-primary/15 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              All ({monitors.length})
            </button>
            {folders.map((f) => {
              const s = folderStats.get(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() => setActiveFolder(f.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    activeFolder === f.id
                      ? "border-primary/40 bg-primary/15 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Folder className={cn("size-3", s?.down ? "text-down" : "text-muted-foreground")} aria-hidden="true" />
                  {f.name} ({s?.total ?? 0})
                </button>
              );
            })}
            <button
              onClick={() => setFolderDialog({ open: true, mode: "create" })}
              className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              aria-label="New folder"
            >
              <FolderPlus className="size-3" /> New
            </button>
          </div>

          {/* stats strip */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatCard
              label="Monitors"
              value={summary ? `${summary.up}/${summary.monitors}` : "—"}
              sub={summary ? `${summary.up} up · ${summary.down} down${summary.paused ? ` · ${summary.paused} paused` : ""}` : undefined}
              icon={Activity}
              tone={summary && summary.down > 0 ? "down" : "up"}
            />
            <StatCard
              label="Uptime 24h"
              value={formatUptime(summary?.avgUptime24h ?? null)}
              sub="average across monitors"
              icon={Gauge}
              tone={summary?.avgUptime24h != null && summary.avgUptime24h < 1 ? "warn" : "default"}
            />
            <StatCard
              label="Checks 24h"
              value={summary ? summary.checks24h.toLocaleString() : "—"}
              sub="real HTTP requests"
              icon={ListChecks}
              tone="teal"
            />
            <StatCard
              label="Failures 24h"
              value={summary ? summary.monitorsWithFailures24h : "—"}
              sub="monitors with ≥1 failed check"
              icon={XCircle}
              tone={summary && summary.monitorsWithFailures24h > 0 ? "down" : "up"}
            />
          </div>

          {/* toolbar: search + sort + scheduled pings */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-44">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                title="Search by name, URL, folder, or account"
                className="border-border/70 pl-9 focus-visible:border-primary/40 focus-visible:ring-primary/20"
                aria-label="Search monitors"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <Select value={sortMode} onValueChange={changeSort}>
              <SelectTrigger
                aria-label="Sort monitors"
                title="How the monitor list is ordered — manual drag order, alphabetical, or status"
                className="h-9 w-[112px] shrink-0 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">
                  <span className="flex items-center gap-2">
                    <MoveVertical className="size-3.5" aria-hidden="true" /> Manual
                  </span>
                </SelectItem>
                <SelectItem value="az">
                  <span className="flex items-center gap-2">
                    <ArrowDownAZ className="size-3.5" aria-hidden="true" /> A–Z
                  </span>
                </SelectItem>
                <SelectItem value="za">
                  <span className="flex items-center gap-2">
                    <ArrowUpAZ className="size-3.5" aria-hidden="true" /> Z–A
                  </span>
                </SelectItem>
                <SelectItem value="status">
                  <span className="flex items-center gap-2">
                    <Activity className="size-3.5" aria-hidden="true" /> Status
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPingsOpen(true)}
              className="relative h-9 shrink-0 gap-1.5 text-xs"
              aria-label={`Scheduled pings${pendingPingCount ? ` (${pendingPingCount} upcoming)` : ""}`}
              title="Scheduled pings — one-off checks at a specific time"
            >
              <CalendarClock className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Scheduled</span>
              {pendingPingCount > 0 && (
                <span
                  className={cn(
                    "ml-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                    "bg-primary/15 text-primary",
                  )}
                >
                  {pendingPingCount}
                </span>
              )}
            </Button>
          </div>

          {sortMode === "manual" && monitors.length > 1 && (
            <p className="-mt-1 text-[11px] text-muted-foreground/80">
              Drag the <span className="text-muted-foreground">⠿</span> handle to reorder, or use
              ⋮ → Move up/down. Pin a monitor to keep it at the top.
            </p>
          )}

          {/* error */}
          {error && (
            <div className="rounded-lg border border-down/30 bg-down/10 px-4 py-3 text-sm text-down">
              {error}
              {(error.includes("Unauthorized")) && (
                <button onClick={onLogout} className="ml-2 underline">
                  sign in again
                </button>
              )}
            </div>
          )}

          {/* list */}
          {loading ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />
              ))}
            </div>
          ) : monitors.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/50 p-8 text-center">
              <PingLogo className="mx-auto size-12 opacity-80" />
              <h2 className="mt-4 text-base font-semibold">Add your first monitor</h2>
              <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                Point PING at any URL — your Render services, an API, a portfolio site. PING will
                send it a real HTTP request on a schedule and keep the history here.
              </p>
              <Button
                onClick={() => setAddOpen(true)}
                className="mt-5 bg-white font-semibold text-black hover:bg-zinc-200"
              >
                <Plus className="size-4" /> New monitor
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
              {query
                ? `No monitors match “${query}”.`
                : activeFolder === "all"
                  ? "No monitors yet."
                  : "This folder is empty — add a monitor or move one here."}
            </div>
          ) : (
            <div className="space-y-2.5">
              {visible.map((m) => {
                const mi = manualList.findIndex((x) => x.id === m.id);
                return (
                  <MonitorCard
                    key={m.id}
                    monitor={m}
                    folders={folders}
                    onOpen={() => setDetailId(m.id)}
                    onRenamed={() => refresh(true)}
                    onEdited={() => refresh(true)}
                    onDeleted={() => refresh(true)}
                    onCheckNow={() => refresh(true)}
                    onSchedulePing={() => setScheduleTargetId(m.id)}
                    nextPingAt={nextPingByMonitor.get(m.id) ?? null}
                    canReorder={sortMode === "manual" && manualList.length > 1}
                    canMoveUp={mi > 0}
                    canMoveDown={mi >= 0 && mi < manualList.length - 1}
                    onMove={(dir) => void moveMonitor(m.id, dir)}
                    dnd={dnd}
                  />
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* mobile FAB */}
      {monitors.length > 0 && (
        <button
          onClick={() => setAddOpen(true)}
          aria-label="New monitor"
          className="fixed bottom-20 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-white text-black shadow-xl shadow-black/40 transition-transform hover:scale-105 active:scale-95 sm:hidden"
        >
          <Plus className="size-6" />
        </button>
      )}

      {/* footer */}
      <footer className="sticky bottom-0 z-30 mt-auto border-t bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span className="font-medium tracking-wide text-foreground/80">PING</span>
          <span>honest uptime for Render Free</span>
          <span className="ml-auto flex items-center gap-3">
            <span>not affiliated with render.com</span>
            <span className="tabular-nums">
              updated {data ? timeAgo(data.serverTime) : "…"}
            </span>
          </span>
        </div>
      </footer>

      {/* ---------- overlays ---------- */}
      <AddMonitorDialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) setEditTarget(null);
        }}
        folders={folders}
        defaultFolderId={activeFolder === "all" ? null : activeFolder}
        initial={editTarget}
        onSaved={() => refresh(true)}
      />

      <MonitorDetailSheet
        open={!!detailId}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
        monitor={detailMonitor}
        onEdit={(m) => {
          setDetailId(null);
          setEditTarget(m);
          setAddOpen(true);
        }}
        onChanged={() => refresh(true)}
        onDeleted={() => refresh(true)}
      />

      <SchedulePingDialog
        open={!!scheduleTargetId}
        onOpenChange={(o) => {
          if (!o) setScheduleTargetId(null);
        }}
        monitor={scheduleMonitor}
        pings={data?.scheduledPings ?? []}
        onChanged={() => refresh(true)}
      />

      <ScheduledPingsSheet
        open={pingsOpen}
        onOpenChange={setPingsOpen}
        pings={data?.scheduledPings ?? []}
        onCancel={cancelScheduledPing}
        serverTime={data?.serverTime ?? null}
      />

      <TextPromptDialog
        open={folderDialog.open}
        onOpenChange={(o) => setFolderDialog((s) => ({ ...s, open: o }))}
        title={folderDialog.mode === "create" ? "New folder" : "Rename folder"}
        description={
          folderDialog.mode === "create"
            ? "Folders group monitors — e.g. “Render Free”, “Side projects”."
            : undefined
        }
        label="Folder name"
        placeholder="Render Free"
        maxLength={40}
        initialValue={folderDialog.mode === "rename" ? (folderDialog.folder?.name ?? "") : ""}
        submitLabel={folderDialog.mode === "create" ? "Create" : "Rename"}
        onSubmit={folderDialog.mode === "create" ? createFolder : renameFolder}
      />
    </div>
  );
}
