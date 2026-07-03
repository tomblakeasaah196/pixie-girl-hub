/**
 * Chart kit — the shared layer under every dashboard chart (canon §5: one
 * charting lib behind one primitive set).
 *
 * Colors come from the validated --chart-* tokens (see index.css; dataviz
 * six-checks). Identity is assigned by series ORDER in fixed slots — never
 * cycled, never re-ranked on filter. "Previous period" and "Other" wear the
 * neutral, not a slot. Marks are thin, grid/axes are recessive hairlines,
 * and every chart ships a hover tooltip.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { money, moneyCompact } from "@/lib/format";
import type { TileFormat } from "@/lib/dashboards-api";

export interface ChartPalette {
  slots: string[];
  other: string;
  ramp: string[];
  grid: string;
  tick: string;
  surface: string;
}

function readPalette(): ChartPalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const trip = (name: string, alpha: number) =>
    `rgb(${v(name)} / ${alpha})`.replace(/\s+/g, " ");
  return {
    slots: ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"].map(v),
    other: v("--chart-other"),
    ramp: [
      "--chart-ramp-1",
      "--chart-ramp-2",
      "--chart-ramp-3",
      "--chart-ramp-4",
      "--chart-ramp-5",
    ].map(v),
    grid: trip("--border-c", 0.07),
    tick: trip("--text-faint", 0.9),
    surface: `rgb(${v("--panel")})`,
  };
}

/** Reads the chart tokens and re-reads when the theme flips. */
export function useChartPalette(): ChartPalette {
  const [palette, setPalette] = useState<ChartPalette>(() => readPalette());
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(readPalette()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return palette;
}

export function useReducedMotion(): boolean {
  return useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
}

/**
 * "Previous period" is context, not a competing series (emphasis form):
 * it always wears the neutral, whatever its slot position.
 */
export function seriesColor(
  palette: ChartPalette,
  index: number,
  key?: string,
): string {
  if (key === "previous") return palette.other;
  return palette.slots[index % palette.slots.length];
}

// ── Value formatting ───────────────────────────────────────

export function fmtValue(value: unknown, format: TileFormat | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "money": {
      const n = Number(value);
      return Number.isFinite(n) ? money(n) : String(value);
    }
    case "int":
    case "num": {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString() : String(value);
    }
    case "pct":
      return `${value}%`;
    case "hours":
      return `${value}h`;
    case "date":
      return String(value).slice(0, 10);
    case "datetime": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime())
        ? String(value)
        : d.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
    }
    case "bool":
      return value === true ? "Yes" : value === false ? "No" : String(value);
    default:
      return String(value);
  }
}

/** Compact tile value: money folds to ₦1.2M once it stops fitting a tile. */
export function fmtTileValue(value: unknown, format: TileFormat): string {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "money") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.abs(n) >= 1_000_000 ? moneyCompact(n) : money(n);
  }
  return fmtValue(value, format);
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "2026-06-01" → "Jun 1" (or "Jun" at month granularity). */
export function fmtBucket(x: string, granularity?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x);
  if (!m) return x;
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  return granularity === "month" ? `${month} ${m[1].slice(2)}` : `${month} ${Number(m[3])}`;
}

export const axisMoney = (v: number) => moneyCompact(v);
export const axisCount = (v: number) => (Math.abs(v) >= 1000 ? moneyCompact(v).replace("₦", "") : String(v));

// ── Glass tooltip (recharts content prop) ──────────────────

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

export function GlassTooltip({
  active,
  payload,
  label,
  format,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  format?: TileFormat;
  labelFormatter?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const heading = labelFormatter ? labelFormatter(String(label ?? "")) : String(label ?? "");
  return (
    <div className="glass rounded-xl shadow-glass px-3.5 py-2.5 text-[12px] border hairline">
      {heading && <div className="micro mb-1.5">{heading}</div>}
      <div className="space-y-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: entry.color }}
            />
            <span className="text-text-muted">{entry.name}</span>
            <span className="ml-auto font-mono tabular-nums pl-3">
              {fmtValue(entry.value, format ?? "num")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Legend row — identity via marker + text tokens (never colored text). */
export function LegendRow({
  items,
}: {
  items: { label: string; color: string }[];
}) {
  if (items.length < 2) return null;
  return (
    <div className="flex items-center gap-4 flex-wrap px-1 pt-2">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Chart card frame: title row (+customize slot), fixed plot height, empty state. */
export function ChartCard({
  title,
  height = 260,
  empty,
  actions,
  children,
  footer,
}: {
  title: string;
  height?: number;
  empty?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="glass rounded-[var(--radius)] shadow-glass p-4 md:p-5 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="micro">{title}</h3>
        {actions}
      </div>
      {empty ? (
        <div
          className="flex items-center justify-center text-text-faint text-[12px]"
          style={{ height }}
        >
          No data for this period
        </div>
      ) : (
        <div style={{ height }} className="min-w-0">
          {children}
        </div>
      )}
      {footer}
    </div>
  );
}

export const AXIS_PROPS = {
  axisLine: false as const,
  tickLine: false as const,
  fontSize: 11,
};
