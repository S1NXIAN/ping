// The notification decision, pinned at its interface. Pure and synchronous —
// no fetch, no DB — so every branch of the delay/slow interaction is
// table-testable. These are the behaviours the old inline block made
// reachable only through a mocked fetch and real rows.
import { expect, test } from "bun:test";
import { decideNotification, type NotificationInput } from "@/lib/notifications";

/** A down check with no prior state — the simplest case. */
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
