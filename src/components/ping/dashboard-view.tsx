"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  FolderPlus,
  Folder,
  Gauge,
  LayoutGrid,
  ListChecks,
  LockKeyhole,
  LockOpen,
  LogOut,
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
import { MonitorCard } from "./monitor-card";
import { MonitorDetailSheet } from "./monitor-detail-sheet";
import { AddMonitorDialog } from "./add-monitor-dialog";
import { TextPromptDialog } from "./text-prompt-dialog";
import { StatCard } from "./stat-card";

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

  const monitors = data?.monitors ?? [];
  const folders = data?.folders ?? [];
  const summary = data?.summary;

  const detailMonitor = detailId ? (monitors.find((m) => m.id === detailId) ?? null) : null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = monitors;
    if (activeFolder !== "all") list = list.filter((m) => m.folderId === activeFolder);
    if (q) {
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.url.toLowerCase().includes(q) ||
          (m.folderName ?? "").toLowerCase().includes(q),
      );
    }
    // down first, then pending, then up, then paused; newest created first within ties
    const rank = (m: MonitorDTO) =>
      !m.enabled ? 3 : m.lastStatus === "down" ? 0 : m.lastStatus === null ? 1 : 2;
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [monitors, activeFolder, query]);

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
              className="hidden bg-white font-semibold text-black hover:bg-zinc-200 sm:inline-flex"
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
              "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
              activeFolder === "all"
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
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
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
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

          {/* search row (desktop also has sidebar add) */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search monitors…"
                className="pl-9"
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
          </div>

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
              {visible.map((m) => (
                <MonitorCard
                  key={m.id}
                  monitor={m}
                  folders={folders}
                  onOpen={() => setDetailId(m.id)}
                  onRenamed={() => refresh(true)}
                  onEdited={() => refresh(true)}
                  onDeleted={() => refresh(true)}
                  onCheckNow={() => refresh(true)}
                />
              ))}
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
          <span className="font-medium text-foreground/70">PING</span>
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
