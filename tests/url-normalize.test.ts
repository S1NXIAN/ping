// The add-monitor form normalizes and validates its URL with this helper.
// Internal hosts (localhost, LAN names, IPv6 loopback) are a supported use —
// the server's monitorUrlSchema allows them and the README documents them —
// so the client rule must match the server rule: scheme only, no host shape.
import { expect, test } from "bun:test";
import { normalizeUrl } from "@/lib/ping-client";

test("adds https:// when the scheme is missing", () => {
  expect(normalizeUrl("example.com")).toBe("https://example.com/");
});

test("keeps an explicit http(s) scheme", () => {
  expect(normalizeUrl("http://example.com/x")).toBe("http://example.com/x");
  expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
});

test("accepts internal hosts the server also accepts", () => {
  expect(normalizeUrl("http://localhost:3000/health")).toBe("http://localhost:3000/health");
  expect(normalizeUrl("http://grafana:3000/api/health")).toBe("http://grafana:3000/api/health");
  expect(normalizeUrl("http://192.168.1.10/")).toBe("http://192.168.1.10/");
  expect(normalizeUrl("http://[::1]/")).toBe("http://[::1]/");
  expect(normalizeUrl("http://myserver/health")).toBe("http://myserver/health");
});

test("rejects a non-http(s) scheme", () => {
  expect(normalizeUrl("ftp://example.com")).toBeNull();
  expect(normalizeUrl("file:///etc/passwd")).toBeNull();
});

test("rejects empty input", () => {
  expect(normalizeUrl("")).toBeNull();
  expect(normalizeUrl("   ")).toBeNull();
});

test("trims surrounding whitespace", () => {
  expect(normalizeUrl("  example.com  ")).toBe("https://example.com/");
});
