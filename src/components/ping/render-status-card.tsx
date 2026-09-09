"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw, CheckCircle2, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, formatDateTime, timeAgo } from "@/lib/ping-client";
import type { RenderStatusResponse } from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { StatusDot } from "./status-dot";

const impactTone: Record<string, string> = {
  none: "text-up",
  minor: "text-warn",
  major: "text-down",
  critical: "text-down",
  unknown: "text-muted-foreground",
};

export function RenderStatusCard() {
  const [data, setData] = useState<RenderStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        const d = await api<RenderStatusResponse>(`/api/render-status${force ? "?force=1" : ""}`);
        setData(d);
      } catch {
        setData({
          ok: false,
          indicator: "unknown",
          description: "",
          incidents: [],
          pageUrl: "https://status.render.com",
          fetchedAt: new Date().toISOString(),
          error: "Request failed",
        });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          Render platform status
          <a
            href="https://status.render.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-teal"
            aria-label="Open status.render.com"
          >
            <ExternalLink className="size-3" />
          </a>
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={() => load(true)}
          disabled={loading}
          aria-label="Refresh Render status"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {data?.ok ? (
        <>
          <div className="mt-2.5 flex items-center gap-2">
            <StatusDot
              status={
                data.indicator === "none"
                  ? "up"
                  : data.indicator === "minor"
                    ? "checking"
                    : data.indicator === "unknown"
                      ? "pending"
                      : "down"
              }
              pulse={false}
            />
            <span
              className={cn(
                "text-sm font-medium",
                impactTone[data.indicator] ?? "text-muted-foreground",
              )}
            >
              {data.description || "Status unknown"}
            </span>
          </div>

          {data.incidents.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {data.incidents.map((inc, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden="true" />
                  <div className="min-w-0">
                    <a
                      href={inc.shortlink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate font-medium text-foreground/90 hover:text-teal"
                    >
                      {inc.name}
                    </a>
                    <span className="text-[11px] text-muted-foreground">
                      {inc.impact} impact · started {timeAgo(inc.startedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2.5 text-[10px] text-muted-foreground">
            Live from status.render.com · fetched {timeAgo(data.fetchedAt)}
          </p>
        </>
      ) : data ? (
        <div className="mt-2.5 flex items-start gap-2 text-xs text-muted-foreground">
          <MinusCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div>
            <p>Couldn’t reach Render’s status page right now.</p>
            <p className="mt-0.5 text-[10px]">
              {data.error ? `${data.error} · ` : ""}tried {formatDateTime(data.fetchedAt)} — PING
              won’t guess, so nothing is shown.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5" aria-hidden="true" /> Loading live status…
        </div>
      )}
    </div>
  );
}
