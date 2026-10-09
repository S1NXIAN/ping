// One shared monitor-URL rule for create, edit and import. Import once
// accepted anything (e.g. "file:///etc/passwd") while create did not.
// Internal hosts (localhost, LAN) are allowed by design — see the README
// trust model — so only the scheme is enforced.
import { expect, test } from "bun:test";
import { monitorUrlSchema } from "@/lib/validation";

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
