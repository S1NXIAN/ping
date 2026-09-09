import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "PING — Uptime for Render Free",
  description:
    "A lightweight, honest uptime monitor. PING periodically sends real HTTP requests to your sites, keeps Render Free services awake, and shows you what actually happened — no invented statistics.",
  applicationName: "PING",
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className="antialiased bg-background text-foreground"
        style={{
          ["--font-ping-sans" as string]:
            "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          ["--font-ping-mono" as string]:
            "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
        }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
