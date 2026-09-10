import type { MetadataRoute } from "next";

/**
 * Web-app manifest — lets PING be installed to a phone's home screen /
 * a desktop as a standalone app. No service worker on purpose: an uptime
 * dashboard must never show stale offline data, so PING installs as a
 * network-first app and honestly fails when unreachable.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PING — Uptime for Render Free",
    short_name: "PING",
    description:
      "A lightweight, honest uptime monitor. Real HTTP checks, real history, keeps Render Free services awake.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b0d12",
    theme_color: "#0b0d12",
    categories: ["productivity", "utilities", "developer"],
    icons: [
      {
        src: "/icon-1024.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-1024.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
