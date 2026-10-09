import { afterEach, describe, expect, mock, test } from "bun:test";
import { buildWebhookPayload, deliverWebhook, isPrivateWebhookUrl } from "@/lib/webhooks";

const monitor = { id: "m1", name: "API", url: "https://api.example.com", account: null };
const payload = buildWebhookPayload("down", monitor, null);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("deliverWebhook — SSRF defense", () => {
  test("refuses to follow a redirect (no blind hop to an internal host)", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      // A public endpoint that answers with a redirect to the metadata service.
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    }) as unknown as typeof fetch;

    const result = await deliverWebhook("https://public.example.com/hook", payload);

    // The redirect must NOT be followed: it is reported as a failed delivery.
    expect(result.ok).toBe(false);
    // …and the mechanism that prevents following is the manual redirect mode.
    expect(calls[0]?.init.redirect).toBe("manual");
  });

  test("a 2xx is still a successful delivery", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const result = await deliverWebhook("https://public.example.com/hook", payload);
    expect(result.ok).toBe(true);
  });

  test("a private URL is refused without any request", async () => {
    let called = false;
    globalThis.fetch = mock(async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const result = await deliverWebhook("http://169.254.169.254/latest/meta-data/", payload);
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("isPrivateWebhookUrl", () => {
  const privateUrls = [
    "http://localhost/hook",
    "http://127.0.0.1/hook",
    "http://10.1.2.3/hook",
    "http://192.168.0.1/hook",
    "http://172.16.5.5/hook",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/",
    "http://[::1]/hook",
    "http://internal-host/hook",
  ];
  const publicUrls = [
    "https://hooks.slack.com/services/x",
    "https://discord.com/api/webhooks/1/abc",
    "https://example.com/hook",
    "http://1.2.3.4/hook",
  ];
  for (const u of privateUrls) test(`blocks ${u}`, () => expect(isPrivateWebhookUrl(u)).toBe(true));
  for (const u of publicUrls) test(`allows ${u}`, () => expect(isPrivateWebhookUrl(u)).toBe(false));
});
