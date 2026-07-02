/**
 * Generic domain dashboard renderer — data-driven from the backend payload.
 * KPI grid (deltas vs previous period) → chart grid (type-mapped to the
 * chart kit) → top-N tables. Every tile can be hidden per user (customize
 * mode writes /dashboards/preferences); charts and tables drill into the
 * DetailDrawer.
 */

import { Eye, EyeOff, Table2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Skeleton } from "@/components/ui/primitives";
import {
  tileKey,
  type DomainChart,
  type DomainPayload,
  type DomainTable,
} from "@/lib/dashboards-api";
import { ChartCard, fmtValue } from "@/components/charts/chart-kit";
import {
  BarsChart,
  ComboChart,
  DonutChart,
  FunnelSteps,
  TrendChart,
  hasSeriesData,
} from "@/components/charts/charts";
import { KpiCard } from "./bits";

const MONEY_CHARTS = new Set([
  "revenue_trend",
  "channel_breakdown",
  "top_products",
  "payment_methods",
  "income_vs_expenses",
  "ar_ageing",
  "expenses_by_category",
  "ad_spend_trend",
  "campaign_performance",
  "top_moving_value",
  "commissions_by_staff",
  "payroll_trend",
]);

function chartFormat(chart: DomainChart): "money" | "int" | "num" {
  if (MONEY_CHARTS.has(chart.key)) return "money";
  return chart.type === "funnel" || chart.type === "donut" ? "int" : "num";
}

function chartIsEmpty(chart: DomainChart): boolean {
  if (chart.series) return !hasSeriesData(chart.series);
  if (chart.slices) return chart.slices.every((s) => !s.value);
  if (chart.steps) return chart.steps.every((s) => !s.value);
  return true;
}

function ChartBody({ chart, granularity }: { chart: DomainChart; granularity?: string }) {
  const format = chartFormat(chart);
  switch (chart.type) {
    case "line":
      return <TrendChart series={chart.series ?? []} format={format} granularity={granularity} />;
    case "bar_line":
      return <ComboChart series={chart.series ?? []} format={format} granularity={granularity} />;
    case "bar":
      return (
        <BarsChart
          slices={chart.slices}
          series={chart.series}
          format={format}
          granularity={granularity}
        />
      );
    case "donut":
      return <DonutChart slices={chart.slices ?? []} format={format} />;
    case "funnel":
      return <FunnelSteps steps={chart.steps ?? []} />;
    default:
      return null;
  }
}

function HideToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="text-text-faint hover:text-text-primary p-1"
      title={hidden ? "Show tile" : "Hide tile"}
    >
      {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
    </button>
  );
}

function toColumns(table: DomainTable): Column<Record<string, unknown>>[] {
  return table.columns.map((c) => ({
    key: c.key,
    header: c.label,
    align: ["money", "int", "num", "pct", "hours"].includes(c.format) ? "right" : "left",
    render: (row) => (
      <span className={c.format === "money" ? "font-mono tabular-nums" : undefined}>
        {fmtValue(row[c.key], c.format)}
      </span>
    ),
  }));
}

export function DomainSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-[var(--radius)]" />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Skeleton className="h-[320px] rounded-[var(--radius)]" />
        <Skeleton className="h-[320px] rounded-[var(--radius)]" />
      </div>
    </div>
  );
}

export function DomainView({
  payload,
  hiddenTiles,
  customizing,
  onToggleTile,
  onDrill,
}: {
  payload: DomainPayload;
  hiddenTiles: Set<string>;
  customizing: boolean;
  onToggleTile: (key: string) => void;
  onDrill: (detailKey: string) => void;
}) {
  const d = payload.domain;
  const isHidden = (kind: "kpi" | "chart" | "table", key: string) =>
    hiddenTiles.has(tileKey(d, kind, key));

  const kpis = payload.kpis.filter((k) => customizing || !isHidden("kpi", k.key));
  const charts = payload.charts.filter((c) => customizing || !isHidden("chart", c.key));
  const tables = payload.tables.filter((t) => customizing || !isHidden("table", t.key));

  return (
    <div className="space-y-4">
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {kpis.map((k) => (
            <KpiCard
              key={k.key}
              kpi={k}
              hidden={isHidden("kpi", k.key)}
              customizing={customizing}
              onToggleHide={() => onToggleTile(tileKey(d, "kpi", k.key))}
            />
          ))}
        </div>
      )}

      {charts.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-4">
          {charts.map((chart) => (
            <div
              key={chart.key}
              className={cn(customizing && isHidden("chart", chart.key) && "opacity-35")}
            >
              <ChartCard
                title={chart.label}
                height={chart.type === "funnel" ? 220 : 260}
                empty={chartIsEmpty(chart)}
                actions={
                  customizing ? (
                    <HideToggle
                      hidden={isHidden("chart", chart.key)}
                      onToggle={() => onToggleTile(tileKey(d, "chart", chart.key))}
                    />
                  ) : undefined
                }
              >
                <ChartBody chart={chart} granularity={payload.period.granularity} />
              </ChartCard>
            </div>
          ))}
        </div>
      )}

      {tables.map((table) => (
        <div
          key={table.key}
          className={cn(customizing && isHidden("table", table.key) && "opacity-35")}
        >
          <DataTable
            columns={toColumns(table)}
            rows={table.rows.map((r, i) => ({ ...r, __i: i }))}
            rowKey={(r) => String(r.__i)}
            onRowClick={
              table.detail_key && !customizing ? () => onDrill(table.detail_key!) : undefined
            }
            toolbar={
              <div className="flex items-center justify-between w-full gap-2">
                <span className="micro">{table.label}</span>
                <span className="flex items-center gap-2">
                  {table.detail_key && !customizing && (
                    <button
                      onClick={() => onDrill(table.detail_key!)}
                      className="text-[11px] text-text-muted hover:text-text-primary underline underline-offset-2"
                    >
                      View all
                    </button>
                  )}
                  {customizing && (
                    <HideToggle
                      hidden={isHidden("table", table.key)}
                      onToggle={() => onToggleTile(tileKey(d, "table", table.key))}
                    />
                  )}
                </span>
              </div>
            }
            empty={{
              icon: <Table2 className="w-6 h-6" />,
              title: "Nothing here yet",
              message: "No rows for this period.",
            }}
          />
        </div>
      ))}
    </div>
  );
}
