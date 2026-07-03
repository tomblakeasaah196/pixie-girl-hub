/**
 * All-businesses view — CEO only (the ONE surface allowed to aggregate
 * across entities, canon §4.1). Combined headline KPIs, a side-by-side
 * business split, and one revenue trend with a line per business.
 */

import { Building2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import {
  type GlobalPayload,
  type GlobalBusinessRollup,
} from "@/lib/dashboards-api";
import { ChartCard, fmtTileValue } from "@/components/charts/chart-kit";
import { TrendChart, hasSeriesData } from "@/components/charts/charts";
import { KpiCard } from "./bits";

const deltaCell = (v: number | null) =>
  v === null || v === undefined ? (
    <span className="text-text-faint">—</span>
  ) : (
    <span className={v >= 0 ? "text-success" : "text-danger"}>
      {v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%
    </span>
  );

const COLUMNS: Column<GlobalBusinessRollup>[] = [
  {
    key: "display_name",
    header: "Business",
    render: (b) => <span className="font-medium">{b.display_name}</span>,
  },
  {
    key: "revenue",
    header: "Revenue",
    align: "right",
    render: (b) => (
      <span className="font-mono tabular-nums">{fmtTileValue(b.revenue, "money")}</span>
    ),
  },
  {
    key: "revenue_delta",
    header: "Δ Revenue",
    align: "right",
    render: (b) => deltaCell(b.revenue_delta_pct),
  },
  {
    key: "orders",
    header: "Orders",
    align: "right",
    render: (b) => <span className="tabular-nums">{b.orders.toLocaleString()}</span>,
  },
  {
    key: "aov",
    header: "AOV",
    align: "right",
    render: (b) => (
      <span className="font-mono tabular-nums">{fmtTileValue(b.aov, "money")}</span>
    ),
  },
  {
    key: "cash",
    header: "Cash Collected",
    align: "right",
    render: (b) => (
      <span className="font-mono tabular-nums">
        {fmtTileValue(b.cash_collected, "money")}
      </span>
    ),
  },
  {
    key: "new_customers",
    header: "New Customers",
    align: "right",
    render: (b) => <span className="tabular-nums">{b.new_customers.toLocaleString()}</span>,
  },
];

export function GlobalView({ payload }: { payload: GlobalPayload }) {
  const c = payload.combined;
  const kpis = [
    {
      key: "revenue",
      label: "Combined Revenue",
      format: "money" as const,
      value: c.revenue,
      previous: null,
      delta_pct: c.revenue_delta_pct,
    },
    {
      key: "orders",
      label: "Combined Orders",
      format: "int" as const,
      value: c.orders,
      previous: null,
      delta_pct: c.orders_delta_pct,
    },
    {
      key: "aov",
      label: "Avg Order Value",
      format: "money" as const,
      value: c.aov,
      previous: null,
      delta_pct: null,
    },
    {
      key: "cash",
      label: "Cash Collected",
      format: "money" as const,
      value: c.cash_collected,
      previous: null,
      delta_pct: null,
    },
    {
      key: "new_customers",
      label: "New Customers",
      format: "int" as const,
      value: c.new_customers,
      previous: null,
      delta_pct: null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <KpiCard key={k.key} kpi={k} />
        ))}
      </div>

      <ChartCard
        title="Revenue by Business"
        height={300}
        empty={!hasSeriesData(payload.revenue_trend.series)}
      >
        <TrendChart
          series={payload.revenue_trend.series}
          format="money"
          granularity={payload.period.granularity}
        />
      </ChartCard>

      <DataTable
        columns={COLUMNS}
        rows={payload.businesses}
        rowKey={(b) => b.brand}
        toolbar={<span className="micro">Side by Side</span>}
        empty={{
          icon: <Building2 className="w-6 h-6" />,
          title: "No businesses",
        }}
      />
    </div>
  );
}
