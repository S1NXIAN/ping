// Shared types between PING's API routes and its frontend.
// These describe REAL data only — anything the backend cannot measure
// is `null`, never a fabricated number.

/** How a monitor's check cadence is defined. */
export type ScheduleMode = "interval" | "times";

/** How a keyword check treats its keyword. */
export type KeywordMode = "contains" | "excludes";

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
  /** How the cadence is defined. "times" ignores intervalSec. */
  scheduleMode: ScheduleMode;
  /** Clock times "HH:MM" in `timezone`, sorted; [] for an interval monitor. */
  scheduleTimes: string[];
  /** IANA zone the times are read in; null for an interval monitor. */
  timezone: string | null;
  enabled: boolean;
  folderId: string | null;
  folderName: string | null;
  /** Optional label for which account/org runs this service (e.g. a Render account). */
  account: string | null;
  pinned: boolean;
  position: number;
  /** Keyword check: body must contain (or must not contain) this string; null = off. */
  keyword: string | null;
  keywordMode: KeywordMode;
  /** Latency-alert threshold in ms; null = off. */
  slowThresholdMs: number | null;
  /** Extra consecutive failed checks required before a down webhook (0 = immediate). */
  alertDelay: number;
  /** Current consecutive failed-check streak (reset by any success). */
  consecutiveDowns: number;
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

/** Chart window for the per-monitor history endpoint. */
export type HistoryRange = "1h" | "24h" | "7d";

/** One point on the monitor response-time chart — a single check, or an
 *  averaged bucket when the window is dense (honest: `downsampled` is set). */
export interface HistoryPoint {
  /** Check/bucket start time in epoch ms. */
  t: number;
  /** Response time of the check (avg of up checks in a bucket); null = failed/none. */
  ms: number | null;
  /** "down" when this point (or bucket) contains any failed check. */
  s: "up" | "down";
}

export interface MonitorHistoryResponse {
  range: HistoryRange;
  from: string; // ISO
  to: string; // ISO
  /** Chart points, chronological, buckets with no checks skipped. */
  points: HistoryPoint[];
  /** Real recorded checks inside the window (before bucketing). */
  checks: number;
  /** True when the points are bucket-averaged rather than raw checks. */
  downsampled: boolean;
}

export type RenderIndicator = "none" | "minor" | "major" | "critical" | "unknown";

/** Incident + its admin note, as listed in the admin incidents view. */
export interface AdminIncidentDTO {
  monitorId: string;
  monitorName: string;
  startedAt: string;
  endedAt: string | null;
  downChecks: number;
  lastStatusCode: number | null;
  /** Non-null when a note is attached (this is its row id). */
  noteId: string | null;
  note: string | null;
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
    /** Raw setting: null = default policy (30 days + cap), 0 = keep forever. */
    retentionDays: number | null;
    maxChecksPerMonitor: number;
    lastPrunedAt: string | null;
    lastPrunedCount: number | null;
  };
}

/** GET /api/admin/retention — current data-retention configuration. */
export interface RetentionResponse {
  /** Raw setting: null = default (30 days + 1,000/monitor cap), 0 = forever. */
  retentionDays: number | null;
  lastPrunedAt: string | null;
  lastPrunedCount: number | null;
}

export interface ImportResult {
  created: number;
  skipped: number;
  foldersCreated: number;
  /** Webhook channels imported (0 for v1 exports without channel data). */
  channelsCreated: number;
}
