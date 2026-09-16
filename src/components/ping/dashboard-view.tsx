"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownAZ,
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
  Wrench,
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
import { useOverview } from "@/hooks/use-overview";
import { api, ApiError, formatUptime, timeAgo, uptimeTone } from "@/lib/ping-client";
import type {
  AdminIncidentDTO,
  FolderDTO,
  MaintenanceWindowDTO,
  MonitorDTO,
} from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { PingLogo, PingWordmark } from "./ping-logo";
import { MonitorCard, type CardDnd } from "./monitor-card";
import { MonitorDetailSheet } from "./monitor-detail-sheet";
import { AddMonitorDialog } from "./add-monitor-dialog";
import { SchedulePingDialog } from "./schedule-ping-dialog";
import { ScheduledPingsSheet } from "./scheduled-pings-sheet";
import { MaintenanceDialog } from "./maintenance-dialog";
import { MaintenanceSheet } from "./maintenance-sheet";
import { IncidentsSheet } from "./incidents-sheet";
import { TextPromptDialog } from "./text-prompt-dialog";
import { StatCard } from "./stat-card";
import { CommandPalette } from "./command-palette";

export type SortMode = "manual" | "az" | "status" | "slowest";
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
  const searchRef = useRef<HTMLInputElement>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MonitorDTO | null>(null);
  const [folderDialog, setFolderDialog] = useState<{
    open: boolean;
    mode: "create" | "rename";
    folder?: FolderDTO;
  }>({ open: false, mode: "create" });
  const [folderDelete, setFolderDelete] = useState<{ open: boolean; folder: FolderDTO | null }>({
    open: false,
    folder: null,
  });

  // sort — persisted per device
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  useEffect(() => {
    try {
      const v = localStorage.getItem(SORT_STORAGE_KEY);
      // "za"/"fastest" were distilled away — stale stored values fall
      // through to the manual default
      if (v === "manual" || v === "az" || v === "status" || v === "slowest")
        setSortMode(v);
    } catch {
      /* private browsing etc. */
    }
  }, []);

  // “/” focuses the search box (Gmail/GitHub-style). Ignored while typing
  // in any field, while a modifier is held, or inside dialogs/sheets.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ⌘K / Ctrl+K toggles the command palette. Skipped while another dialog or
  // sheet is open so overlays never stack confusingly.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("[role=dialog]") && !t?.closest("[cmdk-root]")) return;
      e.preventDefault();
      setPaletteOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  // maintenance — sheet + per-monitor dialog
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceTargetId, setMaintenanceTargetId] = useState<string | null>(null);

  // incidents — postmortem-note sheet, plus the 30d list that drives both
  // the toolbar's rose state and the cards' outage rows (same endpoint the
  // sheet renders; refreshed on mount and on sheet close so the badge never
  // outlives its data)
  const [incidents, setIncidents] = useState<AdminIncidentDTO[] | null>(null);
  const loadIncidents = useCallback(async () => {
    try {
      const r = await api<{ incidents: AdminIncidentDTO[] }>("/api/incidents");
      setIncidents(r.incidents);
    } catch {
      // The sheet surfaces its own errors; the badge keeps the last list.
    }
  }, []);
  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);
  const incidentCount = incidents?.length ?? 0;

  // Down cards' honest "down since": the ONGOING incident's real first
  // failed check (endedAt == null). No incident known → no claim, never a
  // guess; the label simply stays hidden.
  const downSinceByMonitor = useMemo(() => {
    const map = new Map<string, string>();
    for (const inc of incidents ?? []) {
      if (inc.endedAt == null) map.set(inc.monitorId, inc.startedAt);
    }
    return map;
  }, [incidents]);

  const [incidentsOpen, setIncidentsOpen] = useState(false);

  // ⌘K / Ctrl+K command palette
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Palette-initiated delete — confirmed here with the same consequence copy
  // as the card's dialog (the palette itself can't host a confirm step).
  const [paletteDelete, setPaletteDelete] = useState<{ id: string; name: string } | null>(null);

  // drag-and-drop reorder (manual sort only)
  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<MonitorDTO[] | null>(null);
  const committingRef = useRef(false);

  const monitors = data?.monitors ?? [];
  const folders = data?.folders ?? [];
  const summary = data?.summary;

  // 24h fleet floor — a mean hides outliers; "worst" is the honest companion
  // readout (min over the same monitors the API averages, nulls excluded).
  const uptimes24h = monitors
    .map((m) => m.stats.uptime24h)
    .filter((u): u is number => u != null);
  const worst24h = uptimes24h.length ? Math.min(...uptimes24h) : null;

  const detailMonitor = detailId ? (monitors.find((m) => m.id === detailId) ?? null) : null;

  // Palette monitor ops (distill pass): pause/pin run directly; the palette
  // is the keyboard path to the same API the card ⋮ uses.
  const paletteMonitorPatch = useCallback(
    async (id: string, data: Record<string, unknown>, success: string) => {
      try {
        await api(`/api/monitors/${id}`, { method: "PATCH", body: JSON.stringify(data) });
        toast({ description: success });
      } catch (e) {
        toast({
          description: e instanceof Error ? e.message : "Could not update the monitor",
          variant: "destructive",
        });
      }
      refresh(true);
    },
    [refresh, toast],
  );

  const paletteMonitorDelete = useCallback(async () => {
    if (!paletteDelete) return;
    const { id } = paletteDelete;
    setPaletteDelete(null);
    try {
      await api(`/api/monitors/${id}`, { method: "DELETE" });
      toast({ description: "Monitor deleted" });
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Could not delete the monitor",
        variant: "destructive",
      });
    }
    refresh(true);
  }, [paletteDelete, refresh, toast]);
  const scheduleMonitor = scheduleTargetId
    ? (monitors.find((m) => m.id === scheduleTargetId) ?? null)
    : null;
  const maintenanceMonitor = maintenanceTargetId
    ? (monitors.find((m) => m.id === maintenanceTargetId) ?? null)
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

    if (sortMode === "az") {
      const sorted = [...list].sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) ||
          a.position - b.position,
      );
      // pinned monitors always float to the top, even when browsing alphabetically
      return [...sorted.filter((m) => m.pinned), ...sorted.filter((m) => !m.pinned)];
    }

    if (sortMode === "slowest") {
      // by real average response time (24h), slowest first — monitors with no
      // up checks (paused/pending/all-failed) always sink to the bottom, honestly.
      const sorted = [...list].sort((a, b) => {
        const av = a.stats.avgMs24h;
        const bv = b.stats.avgMs24h;
        if (av == null && bv == null) return a.position - b.position;
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av || a.position - b.position;
      });
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

  // maintenance windows — the window to surface on each card: the active one
  // if any, else the next upcoming one
  const maintenanceByMonitor = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, MaintenanceWindowDTO>();
    for (const w of data?.maintenance ?? []) {
      const end = new Date(w.endsAt).getTime();
      if (end <= now) continue;
      const existing = map.get(w.monitorId);
      if (!existing) {
        map.set(w.monitorId, w);
        continue;
      }
      const exStart = new Date(existing.startsAt).getTime();
      const wStart = new Date(w.startsAt).getTime();
      // prefer the active window; otherwise the soonest upcoming
      const wActive = wStart <= now;
      const exActive = exStart <= now;
      if (wActive && !exActive) map.set(w.monitorId, w);
      else if (wActive === exActive && wStart < exStart) map.set(w.monitorId, w);
    }
    return map;
  }, [data?.maintenance]);

  const activeMaintenanceCount = useMemo(() => {
    const now = Date.now();
    return (data?.maintenance ?? []).filter(
      (w) => new Date(w.startsAt).getTime() <= now && new Date(w.endsAt).getTime() > now,
    ).length;
  }, [data?.maintenance]);

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

  async function cancelMaintenance(id: string) {
    await api(`/api/maintenance/${id}`, { method: "DELETE" });
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
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-none border px-2.5 text-xs tabular-nums", tone)}>
      {value}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );

  return (
    <div className="ping-ambient flex min-h-dvh flex-col">
      {/* keyboard bypass — first focusable element on the surface */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none"
      >
        Skip to monitor list
      </a>

      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 2xl:max-w-7xl">
          <PingLogo className="size-7" />
          <PingWordmark className="text-base" />
          <span className="hidden text-xs text-muted-foreground sm:inline">honest uptime monitoring</span>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
              title="Command palette — jump to any monitor or action (Ctrl/⌘+K)"
              className="h-11 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground sm:h-9 md:px-3"
            >
              <Search className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden md:inline">Search…</span>
              <kbd
                className="pointer-events-none hidden rounded-none border border-border/70 bg-muted/60 px-1.5 py-px text-[10px] font-medium text-muted-foreground md:inline"
                aria-hidden="true"
              >
                ⌘K
              </kbd>
            </Button>
            {summary && (
              <>
                {/* Fleet health survives the <md header squeeze: the full pills
                    only fit from md up, so phones get the same truth as one
                    compact chip (critique 2026-09-16 P2 — "is anything down?"
                    never required scrolling to the stat quadrants). Numbers
                    tint only when real — zero stays neutral, the idle rule. */}
                <div
                  className="flex h-6 items-center gap-1.5 rounded-none border border-border bg-muted/40 px-2 text-[11px] tabular-nums md:hidden"
                  aria-label={`${summary.up} up, ${summary.down} down${summary.degraded ? `, ${summary.degraded} slow` : ""}`}
                >
                  <span className={summary.up > 0 ? "text-up" : "text-muted-foreground"} aria-hidden="true">
                    {summary.up}↑
                  </span>
                  <span className={summary.down > 0 ? "text-down" : "text-muted-foreground"} aria-hidden="true">
                    {summary.down}↓
                  </span>
                  {summary.degraded > 0 && (
                    <span className="text-warn" aria-hidden="true">
                      {summary.degraded}~
                    </span>
                  )}
                </div>
                {/* Full pills: md and up. */}
                <div className="hidden items-center gap-1.5 md:flex">
                {/* Header pills tint only when the count is real (the paused
                    pill's idle pattern): a rose "0 down" was a false alarm —
                    color encodes state, and zero is not a state. */}
                {headerPill(
                  "up",
                  summary.up,
                  summary.up > 0
                    ? "border-up/25 bg-up/10 text-up"
                    : "border-border bg-muted text-muted-foreground",
                )}
                {headerPill(
                  "down",
                  summary.down,
                  summary.down > 0
                    ? "border-down/25 bg-down/10 text-down"
                    : "border-border bg-muted text-muted-foreground",
                )}
                {summary.degraded > 0 &&
                  headerPill("slow", summary.degraded, "border-warn/30 bg-warn/10 text-warn")}
                {summary.paused > 0 && headerPill("paused", summary.paused, "border-border bg-muted text-muted-foreground")}
                </div>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refresh()}
              disabled={refreshing}
              aria-label="Refresh"
              title="Refresh now"
              className="size-11 text-muted-foreground hover:text-teal sm:size-9"
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Menu" className="size-11 text-muted-foreground hover:text-foreground sm:size-9">
                  <span className="relative">
                    <Settings className="size-4" aria-hidden="true" />
                    {adminUnlocked && (
                      <span
                        className="absolute -right-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-none bg-teal text-[#0b0c0e]"
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
            {/* documented primary: 36px (h-9) — size="sm" measured 32px (critique 2026-09-16 P3) */}
            <Button
              onClick={() => setAddOpen(true)}
              className="hidden bg-primary font-semibold text-primary-foreground shadow-sm shadow-primary/25 transition-transform hover:bg-primary/90 active:scale-[0.98] sm:inline-flex"
            >
              <Plus className="size-4" /> New monitor
            </Button>
          </div>
        </div>
      </header>

      {/* ---------- body: sidebar (lg) + main ---------- */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 gap-6 px-0 sm:px-4 lg:px-4 2xl:max-w-7xl 2xl:gap-8">
        {/* folder nav — sidebar on desktop */}
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/50 py-4 pr-3 lg:flex">
          <button
            onClick={() => setActiveFolder("all")}
            className={cn(
              "flex items-center gap-2.5 rounded-md border-l px-2.5 py-2.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              activeFolder === "all"
                ? "border-primary bg-secondary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <LayoutGrid className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">All monitors</span>
            <span className="ml-auto rounded-none bg-secondary/80 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
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
                    "flex w-full items-center gap-2.5 rounded-md border-l px-2.5 py-2.5 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                    active
                      ? "border-primary bg-secondary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <Folder className={cn("size-4 shrink-0", s?.down ? "text-down" : "text-muted-foreground")} aria-hidden="true" />
                  <span className="truncate">{f.name}</span>
                  <span className="ml-auto rounded-none bg-secondary/80 px-1.5 pr-5.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {s?.total ?? 0}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`Folder actions for ${f.name}`}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-none p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
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
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setFolderDelete({ open: true, folder: f })}
                    >
                      Delete folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}

          <button
            onClick={() => setFolderDialog({ open: true, mode: "create" })}
            className="mt-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground/80 transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <FolderPlus className="size-4" aria-hidden="true" />
            New folder
          </button>
        </aside>

        {/* main column */}
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pb-24 pt-4 focus:outline-none sm:px-0 sm:pb-10"
        >
          {/* mobile folder chips */}
          <div className="no-scrollbar -mx-4 mb-3 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 lg:hidden">
            <button
              onClick={() => setActiveFolder("all")}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-none border px-3 py-1.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
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
                    "flex min-h-11 shrink-0 items-center gap-1.5 rounded-none border px-3 py-1.5 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
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
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-none border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              aria-label="New folder"
            >
              <FolderPlus className="size-3" /> New
            </button>
          </div>

          {/* stats strip — one instrument on phones: hairline-divided quadrants
              (structure is drawn with 1px hairlines, not four floating fat
              cards); ≥sm restores the incumbent four-card row. One generous
              break below separates overview from the working group. */}
          <div className="mb-6 grid grid-cols-2 gap-px border bg-border sm:grid-cols-4 sm:gap-2 sm:border-0 sm:bg-transparent">
            <StatCard
              label="Monitors"
              value={summary ? `${summary.up}/${summary.monitors}` : "—"}
              sub={
                summary
                  ? ([
                      summary.down > 0 ? `${summary.down} down` : null,
                      summary.degraded > 0 ? `${summary.degraded} slow` : null,
                      summary.paused > 0 ? `${summary.paused} paused` : null,
                      summary.pending > 0 ? `${summary.pending} pending` : null,
                    ].filter(Boolean).join(" · ") ||
                      // Healthy fleet: freshness fills the caption slot — the
                      // most recent check across all monitors (a max, so one
                      // paused or stalled monitor can't fake staleness).
                      (summary.lastCheckAt
                        ? `last check ${timeAgo(summary.lastCheckAt)}`
                        : undefined))
                  : undefined
              }
              icon={Activity}
              tone={summary && summary.down > 0 ? "down" : summary && summary.degraded > 0 ? "warn" : "up"}
            />
            <StatCard
              label="Uptime 24h"
              value={formatUptime(summary?.avgUptime24h ?? null)}
              sub={worst24h != null ? `worst ${formatUptime(worst24h)}` : undefined}
              icon={Gauge}
              // Shared band ink (uptimeTone): displays-as-100% -> emerald,
              // 90–99.99% amber, <90% rose. Before, a perfect fleet shared
              // the neutral ink of "no data" — the up state was invisible.
              tone={uptimeTone(summary?.avgUptime24h) ?? "default"}
            />
            <StatCard
              label="Checks 24h"
              value={summary ? summary.checks24h.toLocaleString() : "—"}
              sub="HTTP requests sent"
              icon={ListChecks}
              tone="teal"
            />
            <StatCard
              label="Failures 24h"
              value={summary ? summary.monitorsWithFailures24h : "—"}
              sub="monitors with failures"
              icon={XCircle}
              tone={summary && summary.monitorsWithFailures24h > 0 ? "down" : "up"}
            />
          </div>

          {/* working group: toolbar + list — one tight unit (10px internal rhythm) */}
          <div className="space-y-2.5">
          {/* toolbar: search + sort + scheduled pings + maintenance — two designed
              clusters so resizing never mixes orphans: find+order stays a unit,
              working tools wrap as a whole row when space runs out */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
              <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                title="Search by name, URL, folder, or account — press / to focus"
                className="h-11 border-border bg-muted/30 pl-9 focus-visible:border-primary/40 focus-visible:ring-primary/20 sm:h-9"
                aria-label="Search monitors"
                aria-keyshortcuts="/"
              />
              {!query && (
                <kbd
                  className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-none border border-border/70 bg-muted/60 px-1.5 py-px text-[10px] font-medium text-muted-foreground sm:block"
                  aria-hidden="true"
                >
                  /
                </kbd>
              )}
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -m-3.5 -translate-y-1/2 p-3.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  aria-label="Clear search"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <Select value={sortMode} onValueChange={changeSort}>
              {/* data-[size] variant: SelectTrigger's own h-9/h-8 use
                  attribute-scoped selectors that out-specify bare h-11 —
                  mirror the pattern or the 44px touch height never applies */}
              <SelectTrigger
                aria-label="Sort monitors"
                title="How the monitor list is ordered — manual drag order, alphabetical, status, or response time"
                className="w-[124px] shrink-0 text-xs data-[size=default]:h-11 sm:data-[size=default]:h-9"
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
                <SelectItem value="status">
                  <span className="flex items-center gap-2">
                    <Activity className="size-3.5" aria-hidden="true" /> Status
                  </span>
                </SelectItem>
                <SelectItem value="slowest">
                  <span className="flex items-center gap-2">
                    <Gauge className="size-3.5" aria-hidden="true" /> Slowest
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            </div>

            {/* working tools — self-describing at every width (critique
                2026-09-16 P2: tooltips don't exist on touch, so meaning can't
                live in hover-only titles). Phones read 10px labels next to the
                icons at natural width — never stretched equal thirds — with
                the 44px touch height kept (DESIGN.md: density is visual, not
                physical); sm+ restores the incumbent 12px labels. */}
            <div className="flex flex-wrap items-center gap-1 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPingsOpen(true)}
              className="relative h-11 gap-1 px-1.5 text-[10px] sm:h-9 sm:gap-1.5 sm:px-3 sm:text-xs"
              aria-label={`Scheduled pings${pendingPingCount ? ` (${pendingPingCount} upcoming)` : ""}`}
              title="Scheduled pings — one-off checks at a specific time"
            >
              <CalendarClock className="size-4" aria-hidden="true" />
              <span>Scheduled</span>
              {pendingPingCount > 0 && (
                <span
                  className={cn(
                    "ml-0.5 grid min-w-4 place-items-center rounded-none px-1 text-[10px] font-semibold tabular-nums",
                    "bg-primary/15 text-primary",
                  )}
                >
                  {pendingPingCount}
                </span>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setMaintenanceOpen(true)}
              className={cn(
                "relative h-11 gap-1 px-1.5 text-[10px] sm:h-9 sm:gap-1.5 sm:px-3 sm:text-xs",
                activeMaintenanceCount > 0 &&
                  "border-warn/45 bg-warn/15 text-warn hover:bg-warn/20 hover:text-warn",
              )}
              aria-label={`Maintenance windows${activeMaintenanceCount ? ` (${activeMaintenanceCount} active)` : ""}`}
              title="Maintenance windows — silence alerts during planned work"
            >
              <Wrench className="size-4" aria-hidden="true" />
              <span>Maintenance</span>
              {activeMaintenanceCount > 0 && (
                <span
                  className="ml-0.5 grid min-w-4 place-items-center rounded-none bg-warn/20 px-1 text-[10px] font-semibold tabular-nums text-warn"
                >
                  {activeMaintenanceCount}
                </span>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIncidentsOpen(true)}
              className={cn(
                "relative h-11 gap-1 px-1.5 text-[10px] sm:h-9 sm:gap-1.5 sm:px-3 sm:text-xs",
                // Rose state voice (mirrors Maintenance's amber): the /10 wash
                // is the AA-safe rose recipe (4.63:1; /15 measures 4.35:1).
                incidentCount > 0 &&
                  "border-down/40 bg-down/10 text-down hover:bg-down/10 hover:text-down",
              )}
              aria-label={`Incidents and postmortem notes${incidentCount > 0 ? ` (${incidentCount} in the last 30 days)` : ""}`}
              title="Incidents — down periods over the last 30 days, with postmortem notes shown on the public status page"
            >
              <AlertTriangle className="size-4" aria-hidden="true" />
              <span>Incidents</span>
              {incidentCount > 0 && (
                <span
                  className="ml-0.5 grid min-w-4 place-items-center rounded-none border border-down/40 bg-background/50 px-1 text-[10px] font-semibold tabular-nums text-down"
                >
                  {incidentCount}
                </span>
              )}
            </Button>
            </div>
          </div>

          {sortMode === "manual" && monitors.length > 1 && (
            <p className="-mt-1 text-[11px] text-muted-foreground/80">
              Drag the <span className="text-muted-foreground">⠿</span> handle to reorder, or use
              ⋮ → Move up/down. Pin a monitor to keep it at the top.
            </p>
          )}

          {/* error — announced, and never a dead end: recovery is inline */}
          {error && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-down/30 bg-down/10 px-4 py-3 text-sm text-down"
            >
              <span className="min-w-0 flex-1">{error}</span>
              <button
                onClick={() => refresh()}
                disabled={refreshing}
                className="inline-flex min-h-11 shrink-0 items-center border border-down/40 px-3 text-xs font-medium transition-colors hover:bg-down/15 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {refreshing ? "Checking…" : "Try again"}
              </button>
              {error.includes("Unauthorized") && (
                <button
                  onClick={onLogout}
                  className="shrink-0 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
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
            <div className="rounded-none border border-dashed bg-card/50 p-8 text-center">
              <PingLogo className="mx-auto size-12 opacity-80" />
              <h2 className="mt-4 text-base font-semibold">Add your first monitor</h2>
              <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                Point PING at any URL — your Render services, an API, a portfolio site. PING will
                send it a real HTTP request on a schedule and keep the history here.
              </p>
              <Button
                onClick={() => setAddOpen(true)}
                className="mt-5 bg-primary font-semibold text-primary-foreground shadow-sm shadow-primary/25 hover:bg-primary/90"
              >
                <Plus className="size-4" /> New monitor
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-none border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
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
                    onScheduleMaintenance={() => setMaintenanceTargetId(m.id)}
                    onViewIncidents={() => setIncidentsOpen(true)}
                    downSince={downSinceByMonitor.get(m.id) ?? null}
                    nextPingAt={nextPingByMonitor.get(m.id) ?? null}
                    maintenanceWindow={maintenanceByMonitor.get(m.id) ?? null}
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
          </div>
        </main>
      </div>

      {/* mobile FAB */}
      {monitors.length > 0 && (
        <button
          onClick={() => setAddOpen(true)}
          aria-label="New monitor"
          className="fixed bottom-20 right-4 z-40 flex size-14 items-center justify-center rounded-none bg-primary text-primary-foreground shadow-xl shadow-primary/30 transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 sm:hidden"
        >
          <Plus className="size-6" />
        </button>
      )}

      {/* footer */}
      <footer className="sticky bottom-0 z-30 mt-auto border-t bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-[11px] text-foreground/65 2xl:max-w-7xl">
          <span className="font-medium tracking-wide text-foreground/90">PING</span>
          <span>honest uptime monitoring</span>
          <span className="ml-auto flex items-center gap-3">
            <span>not affiliated with render.com</span>
            <span className="tabular-nums text-foreground/75">
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

      <MaintenanceDialog
        open={!!maintenanceTargetId}
        onOpenChange={(o) => {
          if (!o) setMaintenanceTargetId(null);
        }}
        monitor={maintenanceMonitor}
        windows={data?.maintenance ?? []}
        onChanged={() => refresh(true)}
      />

      <MaintenanceSheet
        open={maintenanceOpen}
        onOpenChange={setMaintenanceOpen}
        windows={data?.maintenance ?? []}
        onCancel={cancelMaintenance}
        serverTime={data?.serverTime ?? null}
      />

      <IncidentsSheet
        open={incidentsOpen}
        onOpenChange={(o) => {
          setIncidentsOpen(o);
          if (!o) void loadIncidents();
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        monitors={monitors}
        folders={folders}
        activeFolder={activeFolder}
        sortMode={sortMode}
        adminUnlocked={adminUnlocked}
        onNewMonitor={() => setAddOpen(true)}
        onRefresh={() => refresh()}
        onOpenPings={() => setPingsOpen(true)}
        onOpenMaintenance={() => setMaintenanceOpen(true)}
        onOpenIncidents={() => setIncidentsOpen(true)}
        onOpenSettings={onOpenAdmin}
        onLogout={logout}
        onSelectMonitor={(id) => setDetailId(id)}
        onSelectFolder={(id) => setActiveFolder(id)}
        onChangeSort={changeSort}
        onMonitorPatch={paletteMonitorPatch}
        onDeleteRequest={(id, name) => setPaletteDelete({ id, name })}
      />

      <AlertDialog
        open={!!paletteDelete}
        onOpenChange={(o) => !o && setPaletteDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{paletteDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The monitor and its entire recorded check history will be removed.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-down text-down-foreground hover:bg-down active:scale-[0.98]"
              onClick={paletteMonitorDelete}
            >
              Delete monitor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* Deleting a folder is destructive (the group itself is gone for good),
          so it gets the same guard as monitor deletion — with an honest count
          of what happens to the monitors inside: they survive, ungrouped. */}
      <AlertDialog
        open={folderDelete.open}
        onOpenChange={(o) => setFolderDelete((s) => ({ ...s, open: o }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{folderDelete.folder?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const n =
                  data?.monitors.filter((m) => m.folderId === folderDelete.folder?.id).length ?? 0;
                if (n === 0)
                  return "The folder is empty — nothing else is affected. This cannot be undone.";
                if (n === 1)
                  return "The folder will be removed. Its 1 monitor stays — it moves back to the top level. This cannot be undone.";
                return `The folder will be removed. Its ${n} monitors stay — they move back to the top level. This cannot be undone.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = folderDelete.folder?.id;
                setFolderDelete({ open: false, folder: null });
                if (id) void deleteFolder(id);
              }}
              className="bg-down text-down-foreground hover:bg-down active:scale-[0.98]"
            >
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
