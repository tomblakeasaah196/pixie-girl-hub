/**
 * The dashboard chart set — five forms, each mapped from the backend chart
 * payload (`series` | `slices` | `steps`) by `type`:
 *
 *   line     → TrendChart      (multi-line; "previous" series = neutral context)
 *   bar_line → ComboChart      (bars + line overlay, SAME unit, ONE axis)
 *   bar      → BarsChart       (nominal top-N: horizontal, single hue slot-1;
 *                               2-series payloads group vertically)
 *   donut    → DonutChart      (part-to-whole, ≤5 slices + neutral "Other")
 *   funnel   → FunnelSteps     (ordinal single-hue ramp + step conversion %)
 *
 * Marks per the dataviz spec: 2px lines, 4px rounded data-ends anchored to
 * the baseline, 2px surface gaps between fills, solid hairline grid, hover
 * tooltip on everything, legend for ≥2 series.
 */

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSeries, ChartSlice, TileFormat } from "@/lib/dashboards-api";
import {
  AXIS_PROPS,
  GlassTooltip,
  LegendRow,
  axisCount,
  axisMoney,
  fmtBucket,
  fmtValue,
  seriesColor,
  useChartPalette,
  useReducedMotion,
} from "./chart-kit";

/** Pivot [{key,points:[{x,y}]}] into recharts rows [{x, k1, k2}] by index. */
function pivotSeries(series: ChartSeries[]): Record<string, unknown>[] {
  const longest = series.reduce(
    (max, s) => Math.max(max, s.points.length),
    0,
  );
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < longest; i += 1) {
    const row: Record<string, unknown> = {
      x: series[0]?.points[i]?.x ?? series.find((s) => s.points[i])?.points[i]?.x ?? "",
    };
    for (const s of series) {
      const p = s.points[i];
      if (p) row[s.key] = p.y;
    }
    rows.push(row);
  }
  return rows;
}

const hasSeriesData = (series: ChartSeries[] = []) =>
  series.some((s) => s.points.some((p) => p.y !== 0));

interface SeriesChartProps {
  series: ChartSeries[];
  format?: TileFormat;
  granularity?: string;
}

export function TrendChart({ series, format = "money", granularity }: SeriesChartProps) {
  const palette = useChartPalette();
  const reduced = useReducedMotion();
  const rows = pivotSeries(series);
  // Slots follow the non-context series order; "previous" wears the neutral.
  let slot = 0;
  const colored = series.map((s) => ({
    ...s,
    color: s.key === "previous" ? palette.other : seriesColor(palette, slot++),
  }));
  return (
    <>
      <ResponsiveContainer width="100%" height="88%">
        <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.grid} vertical={false} />
          <XAxis
            {...AXIS_PROPS}
            dataKey="x"
            tick={{ fill: palette.tick }}
            tickFormatter={(v: string) => fmtBucket(v, granularity)}
            minTickGap={28}
          />
          <YAxis
            {...AXIS_PROPS}
            width={52}
            tick={{ fill: palette.tick }}
            tickFormatter={format === "money" ? axisMoney : axisCount}
          />
          <Tooltip
            cursor={{ stroke: palette.grid, strokeWidth: 1 }}
            content={
              <GlassTooltip
                format={format}
                labelFormatter={(l) => fmtBucket(l, granularity)}
              />
            }
          />
          {colored.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: palette.surface, strokeWidth: 2 }}
              isAnimationActive={!reduced}
              animationDuration={500}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <LegendRow items={colored.map((s) => ({ label: s.label, color: s.color }))} />
    </>
  );
}

export function ComboChart({ series, format = "money", granularity }: SeriesChartProps) {
  const palette = useChartPalette();
  const reduced = useReducedMotion();
  const rows = pivotSeries(series);
  const [first, second] = series;
  const colors = [seriesColor(palette, 0), seriesColor(palette, 1)];
  return (
    <>
      <ResponsiveContainer width="100%" height="88%">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={palette.grid} vertical={false} />
          <XAxis
            {...AXIS_PROPS}
            dataKey="x"
            tick={{ fill: palette.tick }}
            tickFormatter={(v: string) => fmtBucket(v, granularity)}
            minTickGap={28}
          />
          <YAxis
            {...AXIS_PROPS}
            width={52}
            tick={{ fill: palette.tick }}
            tickFormatter={format === "money" ? axisMoney : axisCount}
          />
          <Tooltip
            cursor={{ fill: palette.grid }}
            content={
              <GlassTooltip
                format={format}
                labelFormatter={(l) => fmtBucket(l, granularity)}
              />
            }
          />
          {first && (
            <Bar
              dataKey={first.key}
              name={first.label}
              fill={colors[0]}
              radius={[4, 4, 0, 0]}
              maxBarSize={22}
              isAnimationActive={!reduced}
              animationDuration={500}
            />
          )}
          {second && (
            <Line
              dataKey={second.key}
              name={second.label}
              stroke={colors[1]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: palette.surface, strokeWidth: 2 }}
              isAnimationActive={!reduced}
              animationDuration={500}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <LegendRow
        items={series.slice(0, 2).map((s, i) => ({ label: s.label, color: colors[i] }))}
      />
    </>
  );
}

/**
 * Nominal top-N (slices): horizontal bars, ONE hue for every bar — length
 * carries the value, color stays identity-free (anti-pattern: value ramps on
 * nominal categories). 2-series payloads (e.g. payroll gross/net) group
 * vertically with slots 1/2.
 */
export function BarsChart({
  slices,
  series,
  format = "num",
  granularity,
}: {
  slices?: ChartSlice[];
  series?: ChartSeries[];
  format?: TileFormat;
  granularity?: string;
}) {
  const palette = useChartPalette();
  const reduced = useReducedMotion();

  if (series?.length) {
    const rows = pivotSeries(series);
    const colors = series.map((_, i) => seriesColor(palette, i));
    return (
      <>
        <ResponsiveContainer width="100%" height="88%">
          <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis
              {...AXIS_PROPS}
              dataKey="x"
              tick={{ fill: palette.tick }}
              tickFormatter={(v: string) => fmtBucket(v, granularity)}
              minTickGap={20}
            />
            <YAxis
              {...AXIS_PROPS}
              width={52}
              tick={{ fill: palette.tick }}
              tickFormatter={format === "money" ? axisMoney : axisCount}
            />
            <Tooltip cursor={{ fill: palette.grid }} content={<GlassTooltip format={format} />} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={colors[i]}
                radius={[4, 4, 0, 0]}
                maxBarSize={18}
                isAnimationActive={!reduced}
                animationDuration={500}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        <LegendRow items={series.map((s, i) => ({ label: s.label, color: colors[i] }))} />
      </>
    );
  }

  const rows = (slices ?? []).slice(0, 10);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={rows}
        layout="vertical"
        margin={{ top: 2, right: 12, bottom: 0, left: 8 }}
      >
        <CartesianGrid stroke={palette.grid} horizontal={false} />
        <XAxis
          {...AXIS_PROPS}
          type="number"
          tick={{ fill: palette.tick }}
          tickFormatter={format === "money" ? axisMoney : axisCount}
        />
        <YAxis
          {...AXIS_PROPS}
          type="category"
          dataKey="label"
          width={118}
          tick={{ fill: palette.tick }}
          tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
        />
        <Tooltip cursor={{ fill: palette.grid }} content={<GlassTooltip format={format} />} />
        <Bar
          dataKey="value"
          name="Value"
          fill={seriesColor(palette, 0)}
          radius={[0, 4, 4, 0]}
          maxBarSize={16}
          isAnimationActive={!reduced}
          animationDuration={500}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Part-to-whole at a glance: top 5 slices + neutral "Other", 2px surface gaps. */
export function DonutChart({
  slices,
  format = "num",
  centerLabel,
}: {
  slices: ChartSlice[];
  format?: TileFormat;
  centerLabel?: string;
}) {
  const palette = useChartPalette();
  const reduced = useReducedMotion();
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, 5);
  const tail = sorted.slice(5);
  const data = tail.length
    ? [...head, { label: "Other", value: tail.reduce((s, x) => s + x.value, 0) }]
    : head;
  const total = data.reduce((s, x) => s + x.value, 0);
  const colorFor = (i: number, label: string) =>
    label === "Other" ? palette.other : seriesColor(palette, i);

  return (
    <div className="h-full flex items-center gap-3 min-w-0">
      <div className="relative h-full aspect-square shrink-0 max-w-[55%]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<GlassTooltip format={format} />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1}
              stroke={palette.surface}
              strokeWidth={2}
              isAnimationActive={!reduced}
              animationDuration={500}
            >
              {data.map((d, i) => (
                <Cell key={d.label} fill={colorFor(i, d.label)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-display text-lg font-medium tabular-nums">
            {fmtValue(total, format === "money" ? "money" : "int")}
          </span>
          {centerLabel && <span className="micro">{centerLabel}</span>}
        </div>
      </div>
      <ul className="flex-1 min-w-0 space-y-1.5 text-[12px]">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: colorFor(i, d.label) }}
            />
            <span className="truncate text-text-muted">{d.label}</span>
            <span className="ml-auto font-mono tabular-nums text-[11px] pl-2">
              {fmtValue(d.value, format)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ordered stages, one-hue ordinal ramp, per-step share of the first stage. */
export function FunnelSteps({
  steps,
  format = "int",
}: {
  steps: { label: string; value: number }[];
  format?: TileFormat;
}) {
  const palette = useChartPalette();
  const first = steps[0]?.value || 0;
  const rampFor = (i: number) => {
    if (steps.length <= 1) return palette.ramp[palette.ramp.length - 1];
    const idx = Math.round((i / (steps.length - 1)) * (palette.ramp.length - 1));
    return palette.ramp[idx];
  };
  return (
    <div className="h-full flex flex-col justify-center gap-2.5">
      {steps.map((s, i) => {
        const pct = first ? Math.round((s.value / first) * 100) : 0;
        return (
          <div key={s.label} className="min-w-0" title={`${s.label}: ${fmtValue(s.value, format)}`}>
            <div className="flex items-baseline justify-between gap-2 text-[11px] mb-1">
              <span className="text-text-muted truncate">{s.label}</span>
              <span className="font-mono tabular-nums shrink-0">
                {fmtValue(s.value, format)}
                <span className="text-text-faint pl-1.5">{pct}%</span>
              </span>
            </div>
            <div className="h-3 rounded-[4px] bg-text-primary/[0.05] overflow-hidden">
              <div
                className="h-full rounded-[4px] transition-[width] duration-500"
                style={{ width: `${Math.max(pct, s.value > 0 ? 2 : 0)}%`, background: rampFor(i) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { hasSeriesData };
