"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownAZ,
  CalendarClock,
  Check,
  Folder,
  Gauge,
  LayoutGrid,
  LockKeyhole,
  LogOut,
  MoveVertical,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { hostOf, formatMs } from "@/lib/ping-client";
import type { FolderDTO, MonitorDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { StatusDot } from "./status-dot";
import type { SortMode } from "./dashboard-view";

const SORT_OPTIONS: { value: SortMode; label: string; icon: typeof MoveVertical }[] = [
  { value: "manual", label: "Manual order", icon: MoveVertical },
  { value: "az", label: "Sort A–Z", icon: ArrowDownAZ },
  { value: "status", label: "Sort by status", icon: Activity },
  { value: "slowest", label: "Sort by slowest", icon: Gauge },
];

function monitorStatus(m: MonitorDTO): "up" | "down" | "paused" | "pending" {
  if (!m.enabled) return "paused";
  return m.lastStatus ?? "pending";
}

/**
 * ⌘K / Ctrl+K command palette — fuzzy jump to any monitor plus quick
 * actions, sort switching and folder navigation without touching the mouse.
 */
export function CommandPalette({
  open,
  onOpenChange,
  monitors,
  folders,
  activeFolder,
  sortMode,
  adminUnlocked,
  onNewMonitor,
  onRefresh,
  onOpenPings,
  onOpenMaintenance,
  onOpenIncidents,
  onOpenSettings,
  onLogout,
  onSelectMonitor,
  onSelectFolder,
  onChangeSort,
  onMonitorPatch,
  onDeleteRequest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitors: MonitorDTO[];
  folders: FolderDTO[];
  activeFolder: string | "all";
  sortMode: SortMode;
  adminUnlocked: boolean;
  onNewMonitor: () => void;
  onRefresh: () => void;
  onOpenPings: () => void;
  onOpenMaintenance: () => void;
  onOpenIncidents: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onSelectMonitor: (id: string) => void;
  onSelectFolder: (id: string | "all") => void;
  onChangeSort: (mode: SortMode) => void;
  onMonitorPatch: (id: string, data: Record<string, unknown>, success: string) => void;
  onDeleteRequest: (id: string, name: string) => void;
}) {
  // Type a thing's name, get its actions: when the query narrows to exactly
  // one monitor, a per-monitor ops group appears (pause/pin/delete). With no
  // or multiple matches the group stays hidden — the list never grows with
  // the fleet. Strict substring matching, so ops never surface for a monitor
  // the fuzzy list itself isn't showing. The query resets on every close
  // (Esc, overlay, item-select all route through handleOpenChange) so the
  // palette always opens fresh — no setState-in-effect needed.
  const [query, setQuery] = useState("");
  const handleOpenChange = (o: boolean) => {
    if (!o) setQuery("");
    onOpenChange(o);
  };
  const close = () => handleOpenChange(false);
  const run = (fn: () => void) => {
    close();
    fn();
  };
  const q = query.trim().toLowerCase();
  const matched =
    q.length > 0
      ? monitors.filter((m) =>
          `${m.name} ${hostOf(m.url)} ${m.account ?? ""}`.toLowerCase().includes(q),
        )
      : [];
  const opsMonitor = matched.length === 1 ? matched[0] : null;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command palette"
      description="Search monitors and run actions"
      className="sm:max-w-lg"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search monitors, actions, folders…"
      />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>No results — try a monitor name, “sort”, or “new”.</CommandEmpty>

        <CommandGroup heading="Jump to monitor">
          {monitors.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No monitors yet — add one first.
            </div>
          )}
          {monitors.map((m) => {
            const st = monitorStatus(m);
            return (
              <CommandItem
                key={m.id}
                value={`${m.name} ${hostOf(m.url)} ${m.account ?? ""} ${st} ${m.folderName ?? ""}`}
                onSelect={() => run(() => onSelectMonitor(m.id))}
              >
                <StatusDot status={st} pulse={false} className="size-2" />
                <span className="truncate font-medium">{m.name}</span>
                <span className="truncate text-xs text-muted-foreground">{hostOf(m.url)}</span>
                {m.lastResponseMs != null && (
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {formatMs(m.lastResponseMs)}
                  </span>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {opsMonitor && (
          <>
            <CommandSeparator />
            <CommandGroup
              heading={`Actions for “${opsMonitor.name}”`}
            >
              <CommandItem
                value={`monitor pause resume ${opsMonitor.name}`}
                onSelect={() =>
                  run(() =>
                    onMonitorPatch(
                      opsMonitor.id,
                      { enabled: !opsMonitor.enabled },
                      opsMonitor.enabled ? "Paused" : "Resumed",
                    ),
                  )
                }
              >
                {opsMonitor.enabled ? <Pause /> : <Play />}
                {opsMonitor.enabled ? "Pause checks" : "Resume checks"}
              </CommandItem>
              <CommandItem
                value={`monitor pin ${opsMonitor.name}`}
                onSelect={() =>
                  run(() =>
                    onMonitorPatch(
                      opsMonitor.id,
                      { pinned: !opsMonitor.pinned },
                      opsMonitor.pinned ? "Unpinned" : "Pinned to top",
                    ),
                  )
                }
              >
                {opsMonitor.pinned ? <PinOff /> : <Pin />}
                {opsMonitor.pinned ? "Unpin" : "Pin to top"}
              </CommandItem>
              <CommandItem
                value={`monitor delete ${opsMonitor.name}`}
                className="text-down"
                onSelect={() => run(() => onDeleteRequest(opsMonitor.id, opsMonitor.name))}
              >
                <Trash2 />
                Delete…
              </CommandItem>
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        {/* Decision residue (critique 2026-09-16 P2): seven flat actions
            became four real commands — the three sheets cascade under their
            own "Open" group, so Actions stops duplicating the toolbar. */}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(onNewMonitor)}>
            <Plus />
            New monitor
          </CommandItem>
          <CommandItem onSelect={() => run(onRefresh)}>
            <RefreshCw />
            Refresh now
          </CommandItem>
          <CommandItem onSelect={() => run(onOpenSettings)}>
            <LockKeyhole className={cn(adminUnlocked && "text-teal")} />
            {adminUnlocked ? "Settings (unlocked)" : "Settings & keep-awake"}
          </CommandItem>
          <CommandItem onSelect={() => run(onLogout)} className="text-down">
            <LogOut />
            Sign out
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Open">
          <CommandItem onSelect={() => run(onOpenPings)}>
            <CalendarClock />
            Scheduled pings
          </CommandItem>
          <CommandItem onSelect={() => run(onOpenMaintenance)}>
            <Wrench />
            Maintenance windows
          </CommandItem>
          <CommandItem onSelect={() => run(onOpenIncidents)}>
            <AlertTriangle />
            Incidents &amp; notes
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Sort">
          {SORT_OPTIONS.map(({ value, label, icon: Icon }) => (
            <CommandItem
              key={value}
              value={`sort ${label}`}
              onSelect={() => run(() => onChangeSort(value))}
            >
              <Icon />
              {label}
              {sortMode === value && (
                <CommandShortcut className="flex items-center gap-1 text-teal">
                  <Check className="size-3" aria-hidden="true" /> current
                </CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        {(folders.length > 0 || activeFolder !== "all") && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Folders">
              <CommandItem
                value="folder all monitors"
                onSelect={() => run(() => onSelectFolder("all"))}
              >
                <LayoutGrid />
                All monitors
                {activeFolder === "all" && (
                  <CommandShortcut className="flex items-center gap-1 text-teal">
                    <Check className="size-3" aria-hidden="true" /> current
                  </CommandShortcut>
                )}
              </CommandItem>
              {folders.map((f) => (
                <CommandItem
                  key={f.id}
                  value={`folder ${f.name}`}
                  onSelect={() => run(() => onSelectFolder(f.id))}
                >
                  <Folder />
                  {f.name}
                  {activeFolder === f.id && (
                    <CommandShortcut className="flex items-center gap-1 text-teal">
                      <Check className="size-3" aria-hidden="true" /> current
                    </CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
        <span className="font-medium text-foreground/70">↑↓</span> navigate ·{" "}
        <span className="font-medium text-foreground/70">↵</span> run ·{" "}
        <span className="font-medium text-foreground/70">esc</span> close
      </div>
    </CommandDialog>
  );
}
