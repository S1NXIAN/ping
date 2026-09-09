/** Lightweight SVG response-time sparkline (no chart lib — keeps PING small). */
export function ResponseSparkline({
  values,
  height = 44,
  className = "",
}: {
  /** chronological ms values (up checks only); null entries create gaps */
  values: Array<number | null>;
  height?: number;
  className?: string;
}) {
  const pts = values.filter((v): v is number => v != null && !Number.isNaN(v));
  if (pts.length < 2) {
    return (
      <div
        className={`flex items-center text-xs text-muted-foreground ${className}`}
        style={{ height }}
      >
        Not enough response-time data yet
      </div>
    );
  }

  const W = 300;
  const H = height;
  const pad = 3;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = Math.max(1, max - min);
  const stepX = (W - pad * 2) / (pts.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);

  const path = pts.map((v, i) => `${i === 0 ? "M" : "L"} ${pad + i * stepX} ${y(v)}`).join(" ");
  const area = `${path} L ${pad + (pts.length - 1) * stepX} ${H - pad} L ${pad} ${H - pad} Z`;
  const lastX = pad + (pts.length - 1) * stepX;
  const lastY = y(pts[pts.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
      role="img"
      aria-label={`Response time sparkline, latest ${Math.round(pts[pts.length - 1])} ms`}
    >
      <defs>
        <linearGradient id="ping-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.28" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#ping-spark-fill)" />
      <path d={path} fill="none" stroke="#8b5cf6" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="#2dd4bf" />
    </svg>
  );
}
