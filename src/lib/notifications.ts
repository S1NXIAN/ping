// The notification decision, extracted from runCheckInner so the
// delay/slow interaction is pure and synchronous — testable
// without fetch or a database.
//
// The contract it preserves: downtime is always recorded (the caller's job);
// only the notification is deferred. `lastNotifiedStatus` diverges from
// `lastStatus` while an alert delay is still confirming, so a service that
// went down during one still raises "down" on the first check after it ends.
// Deferred, never lost.
import { isTransition } from "./webhooks";

export type NotificationEvent = "down" | "up" | "slow";

/** Why the decision came out the way it did — drives the caller's logging. */
export type NotificationOutcome = "fired" | "slow" | "held" | "none";

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
  } = input;

  // "unknown" is the sentinel for "no notification has ever been sent".
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

  // 2. A real transition.
  if (transition) {
    return { event: transition, outcome: "fired", lastNotifiedStatus: status };
  }

  // 3. Latency alert: an up check over the threshold that wasn't slow before.
  //    Skipped when a transition already spoke this check — the
  //    recovery/down message carries the response time.
  if (slowThresholdMs != null && status === "up" && responseMs > slowThresholdMs) {
    const wasSlow =
      previousStatus === "up" && lastResponseMs != null && lastResponseMs > slowThresholdMs;
    if (!wasSlow) {
      return { event: "slow", outcome: "slow" };
    }
  }

  return { event: null, outcome: "none" };
}
