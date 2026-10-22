"use client";

import { useMemo } from "react";
import { formatMs } from "@/lib/ping-client";
import type { MonitorDTO } from "@/lib/ping-types";

const VB_W = 1000;
const VB_H = 100;
const TRACE_TOP = 56;
const TRACE_BOTTOM = 93;
const MAX_TRACE_POINTS = 160;
const DAY_MS = 24 * 60 * 60 * 1000;

interface TracePoint {
  t: number;
  ms: number | null;
  down: boolean;
}

interface TraceModel {
  paths: string[];
  upTicks: { x: number; y: number }[];
  downXs: number[];
  aria: string;
}

/**
 * The stat strip's live layer: one response-time trace across every scoped
 * monitor, drawn from the same recent checks the cards already hold. Real
 * samples only — down checks become rose ticks, and gaps split the line
 * instead of inventing a slope.
 */
export function StatTrace({ monitors }: { monitors: MonitorDTO[] }) {
  const model = useMemo<TraceModel | null>(() => {
    const points: TracePoint[] = [];
    for (const monitor of monitors) {
      for (const check of monitor.recentChecks) {
        const t = new Date(check.checkedAt).getTime();
        if (!Number.isFinite(t)) continue;
        points.push({ t, ms: check.responseMs, down: check.status === "down" });
      }
    }
    if (points.length === 0) return null;

    // Keep the trace to the same 24h story the cards tell, measured back from
    // the newest sample so server and client render an identical window.
    points.sort((a, b) => a.t - b.t);
    const newest = points[points.length - 1].t;
    const recent = points
      .filter((p) => p.t >= newest - DAY_MS)
      .slice(-MAX_TRACE_POINTS);
    if (recent.length === 0) return null;

    const first = recent[0].t;
    const last = recent[recent.length - 1].t;
    const timePad = Math.max(60_000, (last - first) * 0.02);
    const t0 = first - timePad;
    const t1 = last + timePad;
    const xOf = (t: number) => 6 + ((t - t0) / (t1 - t0)) * (VB_W - 12);

    const up = recent.filter(
      (p): p is TracePoint & { ms: number } => !p.down && p.ms != null,
    );
    const values = up.map((p) => p.ms);
    const rawMin = values.length ? Math.min(...values) : 0;
    const rawMax = values.length ? Math.max(...values) : 1;
    const valuePad = Math.max(1, (rawMax - rawMin) * 0.2);
    const lo = Math.max(0, rawMin - valuePad);
    const hi = rawMax + valuePad;
    // Log response time keeps a 100–900 ms fleet from collapsing into a flat
    // line at the floor; the trace is a shape, not a calibrated axis.
    const logLo = Math.log1p(lo);
    const logHi = Math.log1p(hi);
    const yOf = (ms: number) =>
      TRACE_BOTTOM - ((Math.log1p(ms) - logLo) / (logHi - logLo)) * (TRACE_BOTTOM - TRACE_TOP);

    // A real quiet stretch should read as a gap, not as one long invented
    // line. The floor is generous because one sparse monitor's 10-minute
    // rhythm must not shred the merged fleet trace; the cap stops a long
    // pause from being bridged as if checks had happened.
    let gapCut = 15 * 60_000;
    if (up.length > 2) {
      const gaps: number[] = [];
      for (let i = 1; i < up.length; i++) gaps.push(up[i].t - up[i - 1].t);
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      gapCut = Math.min(60 * 60_000, Math.max(15 * 60_000, median * 4));
    }

    const paths: string[] = [];
    let current: string[] = [];
    for (let i = 0; i < up.length; i++) {
      const point = up[i];
      const x = xOf(point.t).toFixed(1);
      const y = yOf(point.ms).toFixed(1);
      if (i === 0) {
        current = [`M ${x} ${y}`];
        continue;
      }
      if (point.t - up[i - 1].t > gapCut) {
        if (current.length > 1) paths.push(current.join(" "));
        current = [`M ${x} ${y}`];
      } else {
        current.push(`L ${x} ${y}`);
      }
    }
    if (current.length > 1) paths.push(current.join(" "));

    // Isolated real samples (a monitor that checks far less often than the
    // fleet) still deserve a mark instead of disappearing with the line.
    const upTicks: { x: number; y: number }[] = [];
    for (let i = 0; i < up.length; i++) {
      const prevGap = i === 0 ? Infinity : up[i].t - up[i - 1].t;
      const nextGap = i === up.length - 1 ? Infinity : up[i + 1].t - up[i].t;
      if (prevGap > gapCut && nextGap > gapCut) {
        upTicks.push({ x: xOf(up[i].t), y: yOf(up[i].ms) });
      }
    }

    const downXs = recent.filter((p) => p.down).map((p) => xOf(p.t));
    const downCount = downXs.length;
    const latest = up.length ? up[up.length - 1] : null;
    const aria =
      `Response-time trace of ${recent.length} recent checks` +
      (downCount > 0 ? `, ${downCount} failed` : "") +
      (latest ? `, latest ${formatMs(latest.ms)}` : "") +
      ". Line breaks mean no checks were recorded.";

    return { paths, upTicks, downXs, aria };
  }, [monitors]);

  if (!model) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
        role="img"
        aria-label={model.aria}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={VB_W * f}
            x2={VB_W * f}
            y1={TRACE_TOP}
            y2={TRACE_BOTTOM}
            stroke="currentColor"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className="text-muted-foreground/10"
          />
        ))}
        {model.paths.map((d, i) => (
          <path
            key={i}
            d={d}
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity="0.55"
            className="ping-trace-draw text-teal"
            style={{ animationDelay: `${Math.min(i * 70, 420)}ms` }}
          />
        ))}
        {model.upTicks.map((tick, i) => (
          <line
            key={`t${i}`}
            x1={tick.x}
            x2={tick.x}
            y1={tick.y - 2}
            y2={tick.y + 2}
            stroke="currentColor"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            opacity="0.4"
            className="text-teal"
          />
        ))}
        {model.downXs.map((x, i) => (
          <line
            key={i}
            x1={x}
            x2={x}
            y1={TRACE_BOTTOM}
            y2={TRACE_BOTTOM - 12}
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            opacity="0.6"
            className="text-down"
          />
        ))}
      </svg>
      <div aria-hidden="true" className="ping-scan absolute inset-y-0 left-0 w-full">
        <div className="absolute inset-y-0 left-0 w-px bg-primary/[0.12]" />
      </div>
    </div>
  );
}
