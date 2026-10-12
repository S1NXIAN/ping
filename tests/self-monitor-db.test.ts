// The Self-monitor's database part: idempotent creation from an origin.
// Worked examples from real rows, in the style of the incidents tests.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";
import {
  captureSelfMonitorOrigin,
  disableSelfMonitor,
  ensureSelfMonitor,
  ensureSelfMonitorOnBoot,
  SELF_MONITOR_INTERVAL_SEC,
} from "@/lib/self-monitor";

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

test("a deleted self-monitor is not resurrected once disabled", async () => {
  await db.settings.create({ data: { id: "main", passwordHash: "h", passwordSalt: "s" } });
  await ensureSelfMonitor("https://ping.example.com");
  const m = await db.monitor.findFirstOrThrow({ where: { isSelfMonitor: true } });
  await db.monitor.delete({ where: { id: m.id } });
  await disableSelfMonitor();
  // A later boot or request must not recreate it.
  await ensureSelfMonitor("https://ping.example.com");
  expect(await db.monitor.count()).toBe(0);
});

test("boot skips a fresh install, leaving the origin to the setup request", async () => {
  // No Settings row yet, and the env var is set — the env var must NOT win.
  const prev = process.env.RENDER_EXTERNAL_URL;
  process.env.RENDER_EXTERNAL_URL = "https://env.example.com";
  try {
    await ensureSelfMonitorOnBoot();
    expect(await db.monitor.count()).toBe(0);
  } finally {
    if (prev === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = prev;
  }
});

test("boot on an existing install creates from the external-URL env var", async () => {
  await db.settings.create({ data: { id: "main", passwordHash: "h", passwordSalt: "s" } });
  const prev = process.env.RENDER_EXTERNAL_URL;
  process.env.RENDER_EXTERNAL_URL = "https://env.example.com";
  try {
    await ensureSelfMonitorOnBoot();
    const m = await db.monitor.findFirstOrThrow({ where: { isSelfMonitor: true } });
    expect(m.url).toBe("https://env.example.com/api/health");
  } finally {
    if (prev === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = prev;
  }
});

test("the lazy path is shared through globalThis, not module state", async () => {
  // Next compiles this module into two chunks (instrumentation + routes); the
  // arm must live on globalThis or the route never sees it. Simulate the boot
  // arm here, then capture from a request origin.
  await db.settings.create({ data: { id: "main", passwordHash: "h", passwordSalt: "s" } });
  const g = globalThis as unknown as { __pingSelfMonitor?: { lazyCaptureArmed: boolean } };
  delete g.__pingSelfMonitor;
  const prev = process.env.RENDER_EXTERNAL_URL;
  delete process.env.RENDER_EXTERNAL_URL;
  try {
    await ensureSelfMonitorOnBoot(); // arms lazy capture on globalThis
    expect((g as { __pingSelfMonitor?: { lazyCaptureArmed: boolean } }).__pingSelfMonitor?.lazyCaptureArmed).toBe(true);
    await captureSelfMonitorOrigin("https://lazy.example.com");
    const m = await db.monitor.findFirstOrThrow({ where: { isSelfMonitor: true } });
    expect(m.url).toBe("https://lazy.example.com/api/health");
    expect((g as { __pingSelfMonitor?: { lazyCaptureArmed: boolean } }).__pingSelfMonitor?.lazyCaptureArmed).toBe(false);
  } finally {
    delete g.__pingSelfMonitor;
    if (prev !== undefined) process.env.RENDER_EXTERNAL_URL = prev;
  }
});

test("a concurrent create is swallowed by the deterministic id", async () => {
  // Both calls race the same id; exactly one monitor survives.
  await Promise.all([
    ensureSelfMonitor("https://a.example.com"),
    ensureSelfMonitor("https://b.example.com"),
  ]);
  expect(await db.monitor.count()).toBe(1);
});
