"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarClock,
  Check,
  Folder,
  Gauge,
  LayoutGrid,
  LockKeyhole,
  LogOut,
  MoveVertical,
  Plus,
  RefreshCw,
  Wrench,
  Zap,
} from "lucide-react";
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
  { value: "za", label: "Sort Z–A", icon: ArrowUpAZ },
  { value: "status", label: "Sort by status", icon: Activity },
  { value: "slowest", label: "Sort by slowest", icon: Gauge },
  { value: "fastest", label: "Sort by fastest", icon: Zap },
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
}) {
  const close = () => onOpenChange(false);
  const run = (fn: () => void) => {
    close();
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search monitors and run actions"
      className="sm:max-w-lg"
    >
      <CommandInput placeholder="Search monitors, actions, folders…" />
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

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(onNewMonitor)}>
            <Plus />
            New monitor
          </CommandItem>
          <CommandItem onSelect={() => run(onRefresh)}>
            <RefreshCw />
            Refresh now
          </CommandItem>
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
          <CommandItem onSelect={() => run(onOpenSettings)}>
            <LockKeyhole className={cn(adminUnlocked && "text-teal")} />
            {adminUnlocked ? "Settings (unlocked)" : "Settings & keep-awake"}
          </CommandItem>
          <CommandItem onSelect={() => run(onLogout)} className="text-down">
            <LogOut />
            Sign out
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
