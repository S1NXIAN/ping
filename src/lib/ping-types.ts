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

export interface OverviewSummary {
  monitors: number;
  up: number;
  down: number;
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
}
