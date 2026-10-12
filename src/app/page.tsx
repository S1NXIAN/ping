import type { Metadata } from "next";
import { PingApp } from "@/components/ping/ping-app";

const title = "PING — honest uptime monitoring";
const description =
  "A lightweight, honest uptime monitor. PING periodically sends real HTTP requests to your sites, keeps Render Free services awake, and shows you what actually happened — no invented statistics.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { type: "website", title, description },
  twitter: { card: "summary", title, description },
};

export default function Home() {
  return <PingApp />;
}
