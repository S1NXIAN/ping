"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api, formatMs } from "@/lib/ping-client";
import type { HistoryPoint, HistoryRange, MonitorHistoryResponse } from "@/lib/ping-types";
import { cn } from "@/lib/utils";

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

const VIOLET = "#8b5cf6";
const TEAL = "#2dd4bf";

/** "Nice" y-axis maximum: rounds up so gridlines land on clean numbers. */
function niceMax(v: number): number {
  if (v <= 0) return 100;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = v / base;
  const nice = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10;
  return nice * base;
}

function timeLabel(t: number, range: HistoryRange, edge = false): string {
  const d = new Date(t);
  if (range === "7d") {
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  }
  // 24h spans midnight — stamp the date on the window edges so “6:20 AM"
  // can't be misread as a different day.
  if (range === "24h" && edge) {
    return (
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    );
  }
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Response-time chart with a real time axis, hover tooltip, down markers and
 * the slow-threshold line. Data comes from /api/monitors/[id]/history — real
 * checks only, bucket-averaged when dense (flagged honestly in the caption).
 */
export function HistoryChart({
  monitorId,
  monitorName,
  slowThresholdMs,
  refreshKey,
}: {
  monitorId: string;
  monitorName: string;
  slowThresholdMs: number | null;
  /** Bump to silently refetch (sheet live-refresh). */
  refreshKey: number;
}) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const [data, setData] = useState<MonitorHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<number | null>(null); // point index
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      try {
        const d = await api<MonitorHistoryResponse>(
          `/api/monitors/${monitorId}/history?range=${range}`,
        );
        setData(d);
        setHover(null);
      } catch {
        // Keep the last good data; the sheet shows its own error toasts.
      } finally {
        setLoading(false);
      }
    },
    [monitorId, range],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  // Sheet live-refresh: fetch silently with the CURRENT range (a ref avoids
  // re-running this effect when `load`'s identity changes with the range).
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (refreshKey > 0) loadRef.current(true);
  }, [refreshKey]);

  const points = data?.points ?? [];
  const upPoints = useMemo(
    () => points.filter((p) => p.ms != null) as (HistoryPoint & { ms: number })[],
    [points],
  );

  // ---- SVG geometry -------------------------------------------------------
  const W = 640;
  const H = 190;
  const padL = 44;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const t0 = data ? new Date(data.from).getTime() : 0;
  const t1 = data ? new Date(data.to).getTime() : 1;
  const tSpan = Math.max(1, t1 - t0);
  const xOf = (t: number) => padL + ((t - t0) / tSpan) * plotW;

  const yMax = useMemo(() => {
    const maxMs = upPoints.length ? Math.max(...upPoints.map((p) => p.ms)) : 0;
    const base = slowThresholdMs != null ? Math.max(maxMs, slowThresholdMs * 1.15) : maxMs;
    return niceMax(base * 1.08);
  }, [upPoints, slowThresholdMs]);
  const yOf = (ms: number) => padT + (1 - ms / yMax) * plotH;

  // Split the line into segments at big gaps (> 3× median spacing) so paused
  // periods read as gaps instead of long fake slopes.
  const segments = useMemo(() => {
    if (upPoints.length < 2) return [] as string[][];
    const gaps: number[] = [];
    for (let i = 1; i < upPoints.length; i++) gaps.push(upPoints[i].t - upPoints[i - 1].t);
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const cut = Math.max(median * 3, 30_000);
    const segs: string[][] = [];
    let cur: string[] = [];
    for (let i = 0; i < upPoints.length; i++) {
      const p = upPoints[i];
      const x = xOf(p.t).toFixed(1);
      const y = yOf(p.ms).toFixed(1);
      if (i === 0) cur.push(`M ${x} ${y}`);
      else if (upPoints[i].t - upPoints[i - 1].t > cut) {
        segs.push(cur);
        cur = [`M ${x} ${y}`];
      } else cur.push(`L ${x} ${y}`);
    }
    if (cur.length) segs.push(cur);
    return segs;
  }, [upPoints, tSpan, yMax]);

  const areaPath = useMemo(() => {
    const first = segments.find((s) => s.length > 1) ?? [];
    if (first.length < 2) return "";
    const line = first.join(" ");
    const m = /M ([\d.]+) ([\d.]+)/.exec(line);
    const lastXY = /L ([\d.]+) ([\d.]+)/g;
    let lx = padL;
    let ly = padT + plotH;
    let m2: RegExpExecArray | null;
    while ((m2 = lastXY.exec(line))) {
      lx = parseFloat(m2[1]);
      ly = parseFloat(m2[2]);
    }
    const sx = m ? parseFloat(m[1]) : padL;
    const sy = m ? parseFloat(m[2]) : padT + plotH;
    return `${line} L ${lx.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${sx.toFixed(1)} ${(
      padT + plotH
    ).toFixed(1)} L ${sx.toFixed(1)} ${sy.toFixed(1)} Z`;
  }, [segments]);

  const hoverPoint = hover != null ? points[hover] : null;

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!points.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = t0 + ((px - padL) / plotW) * tSpan;
    // Nearest point in time (clamp to plot area).
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].t - t);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover(best);
  }

  const empty = !loading && points.length === 0;

  return (
    <div className="rounded-lg border bg-card/60 p-2">
      {/* Header: range selector + CSV download */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1.5">
        <div
          className="inline-flex rounded-md border bg-muted/40 p-0.5"
          role="group"
          aria-label="Chart time range"
        >
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={range === r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                "rounded-[4px] px-2 py-0.5 text-[11px] font-medium transition-colors",
                range === r.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <a
          href={`/api/monitors/${monitorId}/history?format=csv`}
          download
          className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-teal/40 hover:text-teal"
          title="Download all recorded checks as CSV (30-day retention)"
        >
          <Download className="size-3" aria-hidden="true" /> CSV
        </a>
      </div>

      {loading && !data ? (
        <div className="flex h-[190px] items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading history…
        </div>
      ) : empty ? (
        <div className="flex h-[190px] items-center justify-center text-xs text-muted-foreground">
          No checks recorded in this window yet.
        </div>
      ) : (
        <div ref={wrapRef} className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-none select-none"
            style={{ height: 190 }}
            role="img"
            aria-label={`Response time chart for ${monitorName}, last ${range}`}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="ping-history-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={VIOLET} stopOpacity="0.22" />
                <stop offset="1" stopColor={VIOLET} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Horizontal gridlines + y labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const ms = yMax * (1 - f);
              const y = padT + f * plotH;
              return (
                <g key={f}>
                  <line
                    x1={padL}
                    x2={W - padR}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-muted-foreground/40"
                    strokeWidth="1"
                    strokeDasharray={f === 1 ? undefined : "3 4"}
                  />
                  <text
                    x={padL - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-foreground/60"
                    style={{ fontSize: 9 }}
                  >
                    {formatMs(ms)}
                  </text>
                </g>
              );
            })}

            {/* Time axis labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const t = t0 + tSpan * f;
              const x = padL + plotW * f;
              return (
                <text
                  key={f}
                  x={x}
                  y={H - 6}
                  textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
                  className="fill-foreground/60"
                  style={{ fontSize: 9 }}
                >
                  {timeLabel(t, range, f === 0 || f === 1)}
                </text>
              );
            })}

            {/* Slow threshold line */}
            {slowThresholdMs != null && slowThresholdMs <= yMax && (
              <g>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={yOf(slowThresholdMs)}
                  y2={yOf(slowThresholdMs)}
                  stroke="#f59e0b"
                  strokeWidth="1"
                  strokeDasharray="6 4"
                  opacity="0.8"
                />
                <text
                  x={W - padR - 4}
                  y={yOf(slowThresholdMs) - 4}
                  textAnchor="end"
                  fill="#f59e0b"
                  style={{ fontSize: 9, fontWeight: 600 }}
                >
                  slow {slowThresholdMs} ms
                </text>
              </g>
            )}

            {/* Response-time area + line */}
            {areaPath && <path d={areaPath} fill="url(#ping-history-fill)" />}
            {segments.map((seg, i) =>
              seg.length > 1 ? (
                <path
                  key={i}
                  d={seg.join(" ")}
                  fill="none"
                  stroke={VIOLET}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}

            {/* Per-point markers when the window is sparse enough to read */}
            {upPoints.length <= 80 &&
              upPoints.map((p, i) => (
                <circle key={`p${i}`} cx={xOf(p.t)} cy={yOf(p.ms)} r="1.6" fill={VIOLET} opacity="0.75" />
              ))}

            {/* Down checks: rose ticks at the chart floor */}
            {points.map((p, i) =>
              p.s === "down" ? (
                <line
                  key={`d${i}`}
                  x1={xOf(p.t) - 1}
                  x2={xOf(p.t) + 1}
                  y1={padT + plotH - 7}
                  y2={padT + plotH}
                  stroke="#f43f5e"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}

            {/* Latest up point: teal dot */}
            {upPoints.length > 0 && (
              <circle
                cx={xOf(upPoints[upPoints.length - 1].t)}
                cy={yOf(upPoints[upPoints.length - 1].ms)}
                r="2.6"
                fill={TEAL}
              />
            )}

            {/* Hover guide */}
            {hoverPoint && (
              <g>
                <line
                  x1={xOf(hoverPoint.t)}
                  x2={xOf(hoverPoint.t)}
                  y1={padT}
                  y2={padT + plotH}
                  stroke="currentColor"
                  className="text-muted-foreground/50"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                {hoverPoint.ms != null && (
                  <circle
                    cx={xOf(hoverPoint.t)}
                    cy={yOf(hoverPoint.ms)}
                    r="3.4"
                    fill={hoverPoint.s === "down" ? "#f43f5e" : VIOLET}
                    stroke="var(--background)"
                    strokeWidth="1.5"
                  />
                )}
              </g>
            )}
          </svg>

          {/* Hover tooltip */}
          {hoverPoint && (
            <div
              className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1.5 text-[11px] leading-snug shadow-md"
              style={{
                left: `${Math.min(Math.max((xOf(hoverPoint.t) / W) * 100, 8), 92)}%`,
                top: 6,
                transform: "translateX(-50%)",
              }}
            >
              <div className="font-medium text-foreground">
                {new Date(hoverPoint.t).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-block size-1.5 rounded-full",
                    hoverPoint.s === "down" ? "bg-down" : "bg-up",
                  )}
                />
                {hoverPoint.s === "down" ? "down" : "up"} ·{" "}
                <span className="tabular-nums text-foreground">
                  {hoverPoint.s === "down" ? "no response" : formatMs(hoverPoint.ms)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="px-1 pt-1 text-[10px] text-muted-foreground">
        {data
          ? data.points.length > 0
            ? `${data.checks.toLocaleString()} real checks in this window${
                data.downsampled ? " · averaged into buckets for readability" : ""
              } · gaps mean no checks were recorded`
            : ""
          : ""}
        {slowThresholdMs != null && data?.points.length ? (
          <>
            {" · "}
            <span className="text-warn">slow threshold {slowThresholdMs} ms</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
