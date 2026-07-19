import { useState } from "react";
import { Star } from "lucide-react";

/** Read-only star row. `value` may be fractional (e.g. 4.3) — each star fills
 *  proportionally via a clipped overlay rather than rounding to a whole star. */
export function StarRow({
  value,
  size = 16,
  className = "",
}: {
  value: number;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className}`}
      role="img"
      aria-label={`Rated ${Math.round(value * 10) / 10} out of 5`}
    >
      {Array.from({ length: 5 }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span
            key={i}
            aria-hidden="true"
            className="relative inline-block shrink-0"
            style={{ width: size, height: size }}
          >
            <Star size={size} className="absolute inset-0 text-border" />
            {fill > 0 ? (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <Star size={size} className="text-primary" fill="currentColor" />
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** Interactive 1-5 star picker for the "write a review" form. */
export function StarPicker({
  value,
  onChange,
  size = 28,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  return (
    <span
      className="inline-flex items-center gap-1"
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: 5 }).map((_, i) => {
        const n = i + 1;
        const active = n <= shown;
        return (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className="p-0.5 transition-transform hover:scale-110"
          >
            <Star
              size={size}
              className={active ? "text-primary" : "text-border"}
              fill={active ? "currentColor" : "none"}
            />
          </button>
        );
      })}
    </span>
  );
}
