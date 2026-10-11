// The notification decision, pinned at its interface. Pure and synchronous —
// no fetch, no DB — so every branch of the delay/maintenance/slow interaction
// is table-testable. These are the behaviours the old inline block made
// reachable only through a mocked fetch and real rows.
import { expect, test } from "bun:test";
import { decideNotification, type NotificationInput } from "@/lib/notifications";

/** A down check with no prior state and no suppression — the simplest case. */
function input(overrides: Partial<NotificationInput> = {}): NotificationInput {
  return {
    previousStatus: null,
    lastNotifiedStatus: null,
    status: "down",
    consecutiveDowns: 1,
    alertDelay: 0,
    slowThresholdMs: null,
    lastResponseMs: null,
    responseMs: 100,
    inMaintenance: false,
    ...overrides,
  };
}

test("alertDelay 0 fires a down event on the first failure", () => {
  const d = decideNotification(input({ status: "down", consecutiveDowns: 1, alertDelay: 0 }));
  expect(d.event).toBe("down");
  expect(d.outcome).toBe("fired");
  expect(d.lastNotifiedStatus).toBe("down");
});

test("alertDelay 2 holds the down event while confirmations are short", () => {
  const d = decideNotification(input({ status: "down", consecutiveDowns: 1, alertDelay: 2 }));
  expect(d.event).toBe(null);
  expect(d.outcome).toBe("held");
  // The sentinel is written so the pending event survives to the next check.
  expect(d.lastNotifiedStatus).toBe("unknown");
});

test("alertDelay 2 fires once the confirmations are met", () => {
  const d = decideNotification(input({ status: "down", consecutiveDowns: 3, alertDelay: 2 }));
  expect(d.event).toBe("down");
  expect(d.outcome).toBe("fired");
});

test("a down during maintenance is suppressed and remembers the divergence", () => {
  const d = decideNotification(input({ status: "down", inMaintenance: true }));
  expect(d.event).toBe(null);
  expect(d.outcome).toBe("suppressed");
  expect(d.lastNotifiedStatus).toBe("unknown");
});

test("a suppressed down is deferred, never lost: it fires once the window ends", () => {
  const during = decideNotification(
    input({ previousStatus: null, lastNotifiedStatus: null, status: "down", inMaintenance: true }),
  );
  expect(during.outcome).toBe("suppressed");
  expect(during.lastNotifiedStatus).toBe("unknown");
  // Next check, still down, window over — lastNotifiedStatus carries the divergence.
  const after = decideNotification(
    input({
      previousStatus: "down",
      lastNotifiedStatus: during.lastNotifiedStatus ?? null,
      status: "down",
      consecutiveDowns: 2,
      inMaintenance: false,
    }),
  );
  expect(after.event).toBe("down");
  expect(after.outcome).toBe("fired");
});

test("a down-to-up recovery fires an up event", () => {
  const d = decideNotification(
    input({ previousStatus: "down", lastNotifiedStatus: "down", status: "up", consecutiveDowns: 0 }),
  );
  expect(d.event).toBe("up");
  expect(d.outcome).toBe("fired");
  expect(d.lastNotifiedStatus).toBe("up");
});

test("a first-ever up raises nothing and writes nothing", () => {
  const d = decideNotification(
    input({ previousStatus: null, lastNotifiedStatus: null, status: "up", consecutiveDowns: 0 }),
  );
  expect(d.event).toBe(null);
  expect(d.outcome).toBe("none");
  expect(d.lastNotifiedStatus).toBeUndefined();
});

test("a slow up-check above the threshold fires a slow event", () => {
  const d = decideNotification(
    input({
      previousStatus: "up",
      lastNotifiedStatus: "up",
      status: "up",
      consecutiveDowns: 0,
      slowThresholdMs: 500,
      lastResponseMs: 100,
      responseMs: 800,
    }),
  );
  expect(d.event).toBe("slow");
  expect(d.outcome).toBe("slow");
  // A slow event never touches lastNotifiedStatus.
  expect(d.lastNotifiedStatus).toBeUndefined();
});

test("a slow check is skipped when a transition fired this check", () => {
  const d = decideNotification(
    input({
      previousStatus: "down",
      lastNotifiedStatus: "down",
      status: "up",
      consecutiveDowns: 0,
      slowThresholdMs: 500,
      lastResponseMs: null,
      responseMs: 800,
    }),
  );
  expect(d.event).toBe("up");
  expect(d.outcome).toBe("fired");
});

test("a slow check is skipped when a transition was suppressed this check", () => {
  // The suppressed event still counts as "a transition happened", so slow is
  // blocked — a recovery/down message is the more important one.
  const d = decideNotification(
    input({
      previousStatus: "down",
      lastNotifiedStatus: "down",
      status: "up",
      consecutiveDowns: 0,
      slowThresholdMs: 500,
      lastResponseMs: null,
      responseMs: 800,
      inMaintenance: true,
    }),
  );
  expect(d.event).toBe(null);
  expect(d.outcome).toBe("suppressed");
});

test("a slow up-check during maintenance is suppressed without writing the sentinel", () => {
  const d = decideNotification(
    input({
      previousStatus: "up",
      lastNotifiedStatus: "up",
      status: "up",
      consecutiveDowns: 0,
      slowThresholdMs: 500,
      lastResponseMs: 100,
      responseMs: 800,
      inMaintenance: true,
    }),
  );
  expect(d.event).toBe(null);
  expect(d.outcome).toBe("slow-suppressed");
  expect(d.lastNotifiedStatus).toBeUndefined();
});

test("a still-slow up-check does not re-fire the slow event", () => {
  const d = decideNotification(
    input({
      previousStatus: "up",
      lastNotifiedStatus: "up",
      status: "up",
      consecutiveDowns: 0,
      slowThresholdMs: 500,
      lastResponseMs: 800,
      responseMs: 900,
    }),
  );
  expect(d.event).toBe(null);
  expect(d.outcome).toBe("none");
});

test("a plain up-to-up check with no threshold does nothing", () => {
  const d = decideNotification(
    input({ previousStatus: "up", lastNotifiedStatus: "up", status: "up", consecutiveDowns: 0 }),
  );
  expect(d.event).toBe(null);
  expect(d.outcome).toBe("none");
  expect(d.lastNotifiedStatus).toBeUndefined();
});

test("the suppression sentinel resolves lastNotified ?? previousStatus ?? unknown", () => {
  // lastNotifiedStatus wins when present…
  expect(
    decideNotification(
      input({ previousStatus: "up", lastNotifiedStatus: "up", status: "down", inMaintenance: true }),
    ).lastNotifiedStatus,
  ).toBe("up");
  // …else previousStatus…
  expect(
    decideNotification(
      input({ previousStatus: "up", lastNotifiedStatus: null, status: "down", inMaintenance: true }),
    ).lastNotifiedStatus,
  ).toBe("up");
  // …else the "unknown" sentinel (no notification has ever been sent).
  expect(
    decideNotification(
      input({ previousStatus: null, lastNotifiedStatus: null, status: "down", inMaintenance: true }),
    ).lastNotifiedStatus,
  ).toBe("unknown");
});
