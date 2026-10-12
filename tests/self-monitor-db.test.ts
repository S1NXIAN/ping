// The Self-monitor's database part: idempotent creation from an origin.
// Worked examples from real rows, in the style of the incidents tests.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";
import { ensureSelfMonitor, SELF_MONITOR_INTERVAL_SEC } from "@/lib/self-monitor";

beforeEach(async () => {
  await resetDb();
});

test("ensuring creates one monitor checking the health endpoint every 3 minutes", async () => {
  await ensureSelfMonitor("https://ping.example.com");
  const monitors = await db.monitor.findMany();
  expect(monitors.length).toBe(1);
  expect(monitors[0].url).toBe("https://ping.example.com/api/health");
  expect(monitors[0].intervalSec).toBe(SELF_MONITOR_INTERVAL_SEC);
  expect(monitors[0].isSelfMonitor).toBe(true);
});

test("calling ensure twice yields one monitor", async () => {
  await ensureSelfMonitor("https://ping.example.com");
  await ensureSelfMonitor("https://ping.example.com");
  expect(await db.monitor.count()).toBe(1);
});

test("a blank origin creates nothing", async () => {
  await ensureSelfMonitor("");
  await ensureSelfMonitor(null);
  expect(await db.monitor.count()).toBe(0);
});

test("an existing self-monitor is left alone (its URL is not rewritten)", async () => {
  await ensureSelfMonitor("https://first.example.com");
  await ensureSelfMonitor("https://second.example.com");
  const monitors = await db.monitor.findMany();
  expect(monitors.length).toBe(1);
  expect(monitors[0].url).toBe("https://first.example.com/api/health");
});

test("the self-monitor is an ordinary monitor: it can be deleted", async () => {
  await ensureSelfMonitor("https://ping.example.com");
  const m = await db.monitor.findFirstOrThrow({ where: { isSelfMonitor: true } });
  await db.monitor.delete({ where: { id: m.id } });
  expect(await db.monitor.count()).toBe(0);
});
