// One shared monitor-URL rule for create, edit and import. Import once
// accepted anything (e.g. "file:///etc/passwd") while create did not.
// Internal hosts (localhost, LAN) are allowed by design — see the README
// trust model — so only the scheme is enforced.
import { expect, test } from "bun:test";
import { intervalSecSchema, monitorUrlSchema, methodKeywordError } from "@/lib/validation";

const ok = [
  "https://example.com",
  "http://a.b/c",
  "https://1.2.3.4:8080/x",
  "http://localhost:3000/health",
  "http://grafana:3000/api/health",
  "http://192.168.1.10/",
  "http://[::1]/",
];
const bad = ["file:///etc/passwd", "not a url", "ftp://x.com", "javascript:alert(1)"];

for (const v of ok) test(`accepts ${v}`, () => expect(monitorUrlSchema.safeParse(v).success).toBe(true));
for (const v of bad) test(`rejects ${v}`, () => expect(monitorUrlSchema.safeParse(v).success).toBe(false));

test("trims surrounding whitespace", () => {
  expect(monitorUrlSchema.parse("  https://example.com  ")).toBe("https://example.com");
});

test("intervalSecSchema accepts only whole minutes in the 3–15 range", () => {
  expect(intervalSecSchema.safeParse(180).success).toBe(true);
  expect(intervalSecSchema.safeParse(900).success).toBe(true);
  expect(intervalSecSchema.safeParse(179).success).toBe(false);
  expect(intervalSecSchema.safeParse(901).success).toBe(false);
  // Whole minutes only: the card renders `intervalSec / 60` directly.
  expect(intervalSecSchema.safeParse(181).success).toBe(false);
});

// HEAD returns no body, so a keyword can never match and the monitor would
// report a permanent false down. Enforced at create, patch and import, so the
// rule is stated rather than silently coerced in the checker.
test("methodKeywordError rejects HEAD with a keyword", () => {
  expect(methodKeywordError({ method: "HEAD", keyword: "welcome" })).toMatch(/body/i);
});

test("methodKeywordError accepts GET with a keyword, and HEAD without one", () => {
  expect(methodKeywordError({ method: "GET", keyword: "welcome" })).toBeNull();
  expect(methodKeywordError({ method: "HEAD", keyword: null })).toBeNull();
  expect(methodKeywordError({ method: "HEAD", keyword: "" })).toBeNull();
});
