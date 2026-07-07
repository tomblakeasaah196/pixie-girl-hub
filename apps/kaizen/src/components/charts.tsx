/**
 * Tiny dependency-free SVG charts for the ops console (no recharts needed).
 * Colours come from the ops theme via currentColor / Tailwind text-* on the
 * wrapper.
 */

export function Sparkline({
  points,
  width = 120,
  height = 32,
  className,
}: {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!points.length) {
    return <div className={className} style={{ width, height }} />;
  }
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const path = points
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${path} L${(points.length - 1) * step},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <path d={area} fill="currentColor" opacity={0.12} />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

/** A horizontal bar (0..1 fraction) used for slow-route latency comparison. */
export function Bar({
  fraction,
  className,
}: {
  fraction: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-700">
      <div
        className={className ?? "h-full bg-amber"}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
