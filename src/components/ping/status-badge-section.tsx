"use client";

import { useMemo, useState } from "react";
import { Rss, ShieldCheck, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { copyText } from "@/lib/ping-client";
import type { StatusPageMonitorOption } from "@/lib/ping-types";

/**
 * "Embeds" block inside the admin status-page section: a live preview of
 * the shields.io-style status badge, copyable URL / Markdown / HTML
 * snippets, and the RSS feed link. All share the status-page token.
 */
export function StatusBadgeSection({
  token,
  monitors,
}: {
  token: string;
  monitors: StatusPageMonitorOption[];
}) {
  const { toast } = useToast();
  const [monitorId, setMonitorId] = useState<string>("all");

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const monitor = useMemo(
    () => monitors.find((m) => m.id === monitorId) ?? null,
    [monitors, monitorId],
  );

  const badgeUrl = useMemo(
    () =>
      `${origin}/api/public/badge?token=${token}` +
      (monitor ? `&monitor=${encodeURIComponent(monitor.name)}` : "") +
      (monitor ? `&label=${encodeURIComponent(monitor.name)}` : ""),
    [origin, token, monitor],
  );
  const feedUrl = `${origin}/api/public/feed?token=${token}`;
  const markdown = `![status](${badgeUrl})`;
  const html = `<img src="${badgeUrl}" alt="status badge" height="20">`;

  async function copy(text: string, what: string) {
    const ok = await copyText(text);
    toast({
      description: ok ? `${what} copied to clipboard` : "Copy failed — select it manually",
    });
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/90">
          Embed in a README
        </h3>
        {monitors.length > 1 && (
          <div className="ml-auto">
            <Select value={monitorId} onValueChange={setMonitorId}>
              <SelectTrigger
                aria-label="Badge scope"
                title="Show all monitors in one badge, or pick one monitor"
                className="h-8 w-[164px] text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All monitors
                </SelectItem>
                {monitors.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A shields.io-style SVG that mirrors the {monitor ? "monitor" : "whole status page"} live —
        green operational, amber degraded, red down, plus an RSS feed of incidents and maintenance.
      </p>

      {/* live preview — reads exactly what a README would render */}
      <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5">
        <img
          src={badgeUrl}
          alt="Live status badge preview"
          height={20}
          className="h-5 w-auto max-w-full"
        />
        <span className="ml-auto text-[10px] text-muted-foreground/70">live · cached 60 s</span>
      </div>

      <SnippetRow
        label="Markdown"
        value={markdown}
        onCopy={() => copy(markdown, "Markdown snippet")}
      />
      <SnippetRow label="URL" value={badgeUrl} onCopy={() => copy(badgeUrl, "Badge URL")} />
      <SnippetRow label="HTML" value={html} onCopy={() => copy(html, "HTML snippet")} />

      <div className="flex items-center gap-2 border-t pt-2.5">
        <Label className="flex w-16 shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <Rss className="size-3 text-warn" aria-hidden="true" />
          Feed
        </Label>
        <code className="min-w-0 flex-1 truncate text-[11px] text-foreground/85">{feedUrl}</code>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => copy(feedUrl, "RSS feed URL")}
          aria-label="Copy RSS feed URL"
          title="RSS 2.0 — incidents and maintenance, subscribable in any reader"
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function SnippetRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] text-foreground/85">
        {value}
      </code>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onCopy}
        aria-label={`Copy ${label.toLowerCase()} snippet`}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}
