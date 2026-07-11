/** Circular progress indicator using accent tokens. Theme-aware (currentColor
 *  track, accent arc). Used on the goal cards + detail header. */

export function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  showLabel = true,
}: {
  value: number;
  size?: number;
  stroke?: number;
  showLabel?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${pct}% complete`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(var(--text)/0.12)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(var(--accent))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset .4s ease" }}
        />
      </svg>
      {showLabel && (
        <span
          className="absolute inset-0 grid place-items-center font-mono font-semibold text-text-primary"
          style={{ fontSize: size * 0.26 }}
        >
          {pct}
        </span>
      )}
    </div>
  );
}
