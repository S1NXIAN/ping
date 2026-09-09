// Shared types between PING's API routes and its frontend.
// These describe REAL data only — anything the backend cannot measure
// is `null`, never a fabricated number.

export type MonitorStatus = "up" | "down" | "paused" | "pending";

export interface CheckDTO {
  id: string;
  status: "up" | "down";
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
  checkedAt: string; // ISO
}

export interface FolderDTO {
  id: string;
  name: string;
  createdAt: string;
}

export interface MonitorStatsDTO {
  uptime24h: number | null; // fraction 0..1, null = no checks in window
  uptime7d: number | null;
  uptime30d: number | null;
  checks24h: number;
  avgMs24h: number | null;
  minMs24h: number | null;
  maxMs24h: number | null;
  avgMs7d: number | null;
  lastDownAt: string | null;
  firstCheckAt: string | null;
  totalChecks: number;
}

export interface MonitorDTO {
  id: string;
  name: string;
  url: string;
  method: "GET" | "HEAD";
  intervalSec: number;
  enabled: boolean;
  folderId: string | null;
  folderName: string | null;
  /** Optional label for which account/org runs this service (e.g. a Render account). */
  account: string | null;
  pinned: boolean;
  position: number;
  /** Excluded from the public status page when true. */
  statusHidden: boolean;
  /** Latency-alert threshold in ms; null = off. */
  slowThresholdMs: number | null;
  /** True when the last check was UP but slower than slowThresholdMs. */
  degraded: boolean;
  createdAt: string;
  lastCheckAt: string | null;
  lastStatus: "up" | "down" | null;
  lastStatusCode: number | null;
  lastResponseMs: number | null;
  lastError: string | null;
  stats: MonitorStatsDTO;
  recentChecks: CheckDTO[]; // newest first, small window for sparklines
}

/** A one-off check the user explicitly scheduled for a specific moment. */
export interface ScheduledPingDTO {
  id: string;
  monitorId: string;
  monitorName: string;
  runAt: string; // ISO — when it should fire
  note: string | null;
  status: "pending" | "running" | "done";
  ranAt: string | null;
  up: boolean | null; // null = not run yet / outcome unknown
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
}

/** A planned maintenance window for one monitor. */
export interface MaintenanceWindowDTO {
  id: string;
  monitorId: string;
  monitorName: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  note: string | null;
  createdAt: string;
}

export interface OverviewSummary {
  monitors: number;
  up: number;
  down: number;
  /** Up but slower than their slowThresholdMs. */
  degraded: number;
  paused: number;
  pending: number; // never checked yet
  avgUptime24h: number | null;
  checks24h: number;
  monitorsWithFailures24h: number;
  lastCheckAt: string | null;
}

export interface OverviewResponse {
  folders: FolderDTO[];
  monitors: MonitorDTO[];
  summary: OverviewSummary;
  /** Pending + recently finished scheduled pings (newest activity first). */
  scheduledPings: ScheduledPingDTO[];
  /** Active, upcoming and recently-ended maintenance windows. */
  maintenance: MaintenanceWindowDTO[];
  serverTime: string;
}

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  up: number;
  down: number;
}

export interface MonitorDetailResponse {
  monitor: MonitorDTO;
  p95Ms24h: number | null;
  daily: DailyBucket[]; // last 30 days, only days that have checks
  checks: CheckDTO[]; // newest first, up to 100
}

export type RenderIndicator = "none" | "minor" | "major" | "critical" | "unknown";

/** Monitor as it appears on the public status page (no URL, no account). */
export interface PublicStatusMonitor {
  id: string;
  name: string;
  status: "up" | "down" | "paused" | "pending";
  /** Up but slower than the admin's latency threshold. */
  degraded: boolean | null;
  /** Truthy when an active maintenance window covers this monitor. */
  maintenance: boolean | null;
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  avgMs24h: number | null;
  lastCheckAt: string | null;
  lastStatusCode: number | null;
  lastDownAt: string | null;
  daily: DailyBucket[]; // days with recorded checks only
}

/** A down period on the public status page, derived from recorded checks. */
export interface PublicIncident {
  monitorId: string;
  monitorName: string;
  startedAt: string;
  /** Null while the incident is still ongoing. */
  endedAt: string | null;
  downChecks: number;
  lastStatusCode: number | null;
  /** True when the down period overlaps a planned maintenance window. */
  duringMaintenance: boolean;
  /** Admin postmortem/acknowledgment note attached to this incident. */
  note: string | null;
}

/** Incident + its admin note, as listed in the admin incidents view. */
export interface AdminIncidentDTO {
  monitorId: string;
  monitorName: string;
  startedAt: string;
  endedAt: string | null;
  downChecks: number;
  lastStatusCode: number | null;
  duringMaintenance: boolean;
  /** Non-null when a note is attached (this is its row id). */
  noteId: string | null;
  note: string | null;
}

/** Maintenance window as shown on the public status page (name + times only). */
export interface PublicMaintenance {
  monitorId: string;
  monitorName: string;
  startsAt: string;
  endsAt: string;
  note: string | null;
}

export interface PublicStatusResponse {
  monitors: PublicStatusMonitor[];
  summary: {
    total: number;
    up: number;
    down: number;
    degraded: number;
    paused: number;
    pending: number;
    lastCheckAt: string | null;
  };
  /** Custom title set by the admin, null when unset. */
  title: string | null;
  /** Down periods in the last 30 days, newest first (derived from real checks). */
  incidents: PublicIncident[];
  /** Active + upcoming maintenance windows for visible monitors. */
  maintenance: PublicMaintenance[];
  serverTime: string;
}

/** Admin-facing status-page state (token only shown to an unlocked admin). */
export interface StatusPageInfoResponse {
  enabled: boolean;
  token: string | null;
  /** Custom title shown on the public status page (null = default). */
  title: string | null;
}

/** A webhook endpoint notified when a monitor goes down or recovers. */
export interface WebhookChannelDTO {
  id: string;
  name: string;
  url: string;
  /** Routes events for this monitor only; null = every monitor. */
  monitorId: string | null;
  monitorName: string | null;
  notifyDown: boolean;
  notifyUp: boolean;
  notifySlow: boolean;
  enabled: boolean;
  createdAt: string;
  deliveries: number;
  lastDeliveryAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
}

export interface RenderStatusResponse {
  ok: boolean;
  indicator: RenderIndicator;
  description: string;
  incidents: {
    name: string;
    impact: string;
    status: string;
    shortlink: string;
    startedAt: string | null;
    resolvedAt: string | null;
  }[];
  pageUrl: string;
  fetchedAt: string; // ISO — when we actually last reached the API
  error?: string;
}

export interface SessionResponse {
  initialized: boolean;
  authenticated: boolean;
  /** True when a valid session + valid (unexpired) Settings unlock cookie exist. */
  adminUnlocked: boolean;
  unlockExpiresAt: string | null; // ISO, null when locked
}

export interface AdminInfoResponse {
  processUptimeSec: number;
  nodeEnv: string;
  scheduler: {
    running: boolean;
    lastTickAt: string | null;
    lastTickRan: number;
    lastTickDurationMs: number | null;
    tickIntervalSec: number;
  };
  storage: {
    checksStored: number;
    monitors: number;
    folders: number;
    oldestCheckAt: string | null;
    dbBytes: number | null;
    retentionDays: number;
    maxChecksPerMonitor: number;
  };
}

export interface ImportResult {
  created: number;
  skipped: number;
  foldersCreated: number;
  /** Webhook channels imported (0 for v1 exports without channel data). */
  channelsCreated: number;
  /** Future maintenance windows imported. */
  windowsCreated: number;
}
