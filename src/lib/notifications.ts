// The notification decision, extracted from runCheckInner so the
// delay/maintenance/slow interaction is pure and synchronous — testable
// without fetch or a database.
//
// The contract it preserves: downtime is always recorded (the caller's job);
// only the notification is deferred. `lastNotifiedStatus` diverges from
// `lastStatus` while a maintenance window suppresses events or an alert delay
// is still confirming, so a service that went down during either still raises
// "down" on the first check after it ends. Deferred, never lost.
import { isTransition } from "./webhooks";

export type NotificationEvent = "down" | "up" | "slow";

/** Why the decision came out the way it did — drives the caller's logging. */
export type NotificationOutcome =
  | "fired"
  | "slow"
  | "held"
  | "suppressed"
  | "slow-suppressed"
  | "none";

export interface NotificationInput {
  /** The monitor's status before this check ran. */
  previousStatus: string | null;
  /** The last status a webhook was actually sent for. */
  lastNotifiedStatus: string | null;
  status: "up" | "down";
  /** Consecutive failures INCLUDING this check. */
  consecutiveDowns: number;
  alertDelay: number;
  slowThresholdMs: number | null;
  /** The previous check's response time (for the was-already-slow test). */
  lastResponseMs: number | null;
  responseMs: number;
  /** True while the monitor is inside an active maintenance window. */
  inMaintenance: boolean;
}

export interface NotificationDecision {
  /** The event to deliver, or null for nothing. At most one fires per check. */
  event: NotificationEvent | null;
  /** The value to persist as lastNotifiedStatus; undefined = leave untouched. */
  lastNotifiedStatus?: string;
  outcome: NotificationOutcome;
}

export function decideNotification(input: NotificationInput): NotificationDecision {
  const {
    previousStatus,
    lastNotifiedStatus,
    status,
    consecutiveDowns,
    alertDelay,
    slowThresholdMs,
    lastResponseMs,
    responseMs,
    inMaintenance,
  } = input;

  // "unknown" is the sentinel for "no notification has ever been sent" — it
  // keeps a first-check event alive through a window that started before it.
  const sentinel = lastNotifiedStatus ?? previousStatus ?? "unknown";
  // The divergence between notified and actual status is the whole point:
  // compare the transition against what was last NOTIFIED, not last seen.
  const transition = isTransition(lastNotifiedStatus ?? previousStatus, status);

  // 1. Alert delay: hold a down event until enough consecutive failures
  //    confirm it. Persist the sentinel so the pending event is re-evaluated
  //    on every later check — deferred, never lost.
  if (transition === "down" && alertDelay > 0 && consecutiveDowns <= alertDelay) {
    return { event: null, outcome: "held", lastNotifiedStatus: sentinel };
  }

  // 2. A real transition. Maintenance suppresses the webhook but remembers the
  //    divergence so it fires once the window ends.
  if (transition) {
    if (inMaintenance) {
      return { event: null, outcome: "suppressed", lastNotifiedStatus: sentinel };
    }
    return { event: transition, outcome: "fired", lastNotifiedStatus: status };
  }

  // 3. Latency alert: an up check over the threshold that wasn't slow before.
  //    Skipped when a transition (fired or suppressed) already spoke this
  //    check — the recovery/down message carries the response time. A missed
  //    slow alert during planned work is acceptable, unlike a missed down.
  if (slowThresholdMs != null && status === "up" && responseMs > slowThresholdMs) {
    const wasSlow =
      previousStatus === "up" && lastResponseMs != null && lastResponseMs > slowThresholdMs;
    if (!wasSlow) {
      if (inMaintenance) return { event: null, outcome: "slow-suppressed" };
      return { event: "slow", outcome: "slow" };
    }
  }

  return { event: null, outcome: "none" };
}
