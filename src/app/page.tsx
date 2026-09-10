import type { Metadata } from "next";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { PingApp } from "@/components/ping/ping-app";

/**
 * Per-URL metadata: the public status link (`/?status=<token>`) gets a
 * dedicated title and a live OG card; every other URL gets the generic
 * PING card. og:image URLs are resolved absolutely from the request host
 * so social unfurls work on any deployment origin.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const token = typeof sp.status === "string" ? sp.status : "";

  // Resolve this deployment's origin for absolute og:image URLs.
  const h = await headers();
  const host = h.get("host");
  let origin: string | undefined;
  if (host) {
    const isLocal = host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("[::1");
    const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0];
    const proto = isLocal ? "http" : forwardedProto === "http" ? "http" : "https";
    origin = `${proto}://${host}`;
  }

  let valid = false;
  let statusTitle: string | null = null;
  if (token) {
    const settings = await db.settings.findUnique({
      where: { id: "main" },
      select: { statusToken: true, statusTitle: true },
    });
    valid =
      !!settings?.statusToken &&
      token.length === settings.statusToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(settings.statusToken));
    statusTitle = settings?.statusTitle ?? null;
  }

  if (valid) {
    const title = `${statusTitle ?? "Status"} — PING`;
    const description =
      "Live statuses, incidents and maintenance — from real HTTP checks, not invented statistics.";
    const image = `/api/public/og?token=${encodeURIComponent(token)}`;
    return {
      ...(origin ? { metadataBase: new URL(origin) } : {}),
      title,
      description,
      openGraph: {
        type: "website",
        title,
        description,
        images: [{ url: image, width: 1200, height: 630, alt: title }],
      },
      twitter: { card: "summary_large_image", title, description, images: [image] },
    };
  }

  const title = "PING — Uptime for Render Free";
  const description =
    "A lightweight, honest uptime monitor. PING periodically sends real HTTP requests to your sites, keeps Render Free services awake, and shows you what actually happened — no invented statistics.";
  const image = "/api/public/og";
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title,
    description,
    openGraph: {
      type: "website",
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: "PING — uptime for Render Free" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function Home() {
  return <PingApp />;
}
