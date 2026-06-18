import { useMemo } from "react";
import { ArrowDownUp, Package, TrendingDown } from "lucide-react";
import { Card, KpiTile, MoneyText, Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { moneyCompact } from "@/lib/format";
import {
  useStockValuation,
  useStockLocations,
  useStockLevels,
  useStockAlerts,
  useStockMovements,
} from "./hooks";
import { MovementTypePill, SeverityPill, LocationTypePill } from "./parts";
import type { StockLocation, StockLevel, StockMovement, StockAlert } from "./types";

/* ── Location row shape (aggregated from levels) ── */
interface LocationRow {
  location_id: string;
  display_name: string;
  location_type: string;
  skus_tracked: number;
  on_hand: number;
  reserved: number;
  available: number;
  value_ngn: number;
}

/* ── KPI skeleton ── */
function KpiSkeleton() {
  return (
    <div className="glass rounded-[var(--radius)] shadow-glass p-[17px_18px] border-l-[3px] border-l-accent/30">
      <Skeleton className="w-24 mb-3" />
      <Skeleton className="w-32" style={{ height: 28 }} />
    </div>
  );
}

/* ── Component ── */
export default function OverviewTab() {
  const valuation = useStockValuation();
  const locations = useStockLocations();
  const levels = useStockLevels({ page: 1, page_size: 100 });
  const alerts = useStockAlerts({ status: "open", page: 1, page_size: 5 });
  const movements = useStockMovements({ page: 1, page_size: 10 });

  /* Aggregate levels per location */
  const locationRows = useMemo<LocationRow[]>(() => {
    if (!locations.data || !levels.data) return [];
    const map = new Map<string, { on_hand: number; reserved: number; available: number; skus: Set<string> }>();
    for (const lvl of levels.data as StockLevel[]) {
      let agg = map.get(lvl.location_id);
      if (!agg) {
        agg = { on_hand: 0, reserved: 0, available: 0, skus: new Set() };
        map.set(lvl.location_id, agg);
      }
      agg.on_hand += lvl.on_hand;
      agg.reserved += lvl.reserved;
      agg.available += lvl.available;
      agg.skus.add(lvl.variant_id);
    }

    const valuationLines = valuation.data?.lines ?? [];
    const valueByLoc = new Map<string, number>();
    for (const vl of valuationLines) {
      valueByLoc.set(vl.location_id, (valueByLoc.get(vl.location_id) ?? 0) + Number(vl.value_ngn));
    }

    return (locations.data as StockLocation[]).map((loc) => {
      const agg = map.get(loc.location_id);
      return {
        location_id: loc.location_id,
        display_name: loc.display_name,
        location_type: loc.location_type,
        skus_tracked: agg?.skus.size ?? 0,
        on_hand: agg?.on_hand ?? 0,
        reserved: agg?.reserved ?? 0,
        available: agg?.available ?? 0,
        value_ngn: valueByLoc.get(loc.location_id) ?? 0,
      };
    });
  }, [locations.data, levels.data, valuation.data]);

  /* Error state — any critical query failed */
  const criticalError = valuation.error || locations.error;
  if (criticalError) {
    return (
      <ErrorState
        message={(criticalError as Error).message}
        onRetry={() => {
          valuation.refetch();
          locations.refetch();
          levels.refetch();
        }}
      />
    );
  }

  /* Loading state */
  const isLoading = valuation.isLoading || locations.isLoading || levels.isLoading;

  /* KPI values */
  const summary = valuation.data?.summary;
  const totalSKUs = summary?.total_units ?? 0;
  const totalValue = Number(summary?.total_value_ngn ?? 0);
  const belowReorder = alerts.data?.meta?.total ?? 0;

  /* ── Location breakdown columns ── */
  const locationColumns: Column<LocationRow>[] = [
    { key: "name", header: "Location", render: (r) => <span className="font-semibold text-[13px]">{r.display_name}</span> },
    { key: "type", header: "Type", render: (r) => <LocationTypePill type={r.location_type} /> },
    { key: "skus", header: "SKUs Tracked", align: "right", render: (r) => <span className="tabular-nums">{r.skus_tracked}</span> },
    { key: "on_hand", header: "On Hand", align: "right", render: (r) => <span className="tabular-nums">{r.on_hand.toLocaleString()}</span> },
    { key: "reserved", header: "Reserved", align: "right", render: (r) => <span className="tabular-nums">{r.reserved.toLocaleString()}</span> },
    { key: "available", header: "Available", align: "right", render: (r) => <span className="tabular-nums">{r.available.toLocaleString()}</span> },
    {
      key: "value",
      header: "Value",
      align: "right",
      render: (r) => <MoneyText ngn={r.value_ngn} />,
    },
  ];

  /* ── Movement mini-table columns ── */
  const movementColumns: Column<StockMovement>[] = [
    { key: "number", header: "#", width: "110px", render: (r) => <span className="font-mono text-[12px] text-text-muted">{r.movement_number}</span> },
    { key: "type", header: "Type", render: (r) => <MovementTypePill type={r.movement_type} /> },
    { key: "qty", header: "Qty", align: "right", render: (r) => <span className="tabular-nums font-semibold">{r.quantity > 0 ? `+${r.quantity}` : r.quantity}</span> },
    {
      key: "cost",
      header: "Unit Cost",
      align: "right",
      render: (r) =>
        r.unit_cost_ngn ? <MoneyText ngn={Number(r.unit_cost_ngn)} className="text-[13px]" /> : <span className="text-text-faint">--</span>,
    },
    {
      key: "date",
      header: "Date",
      align: "right",
      render: (r) => (
        <span className="text-[12px] text-text-muted tabular-nums">
          {new Date(r.performed_at).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "2-digit" })}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* ── Row 1: KPI tiles ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {isLoading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiTile
              label="Total SKUs on hand"
              value={totalSKUs.toLocaleString()}
              tone="accent"
            />
            <KpiTile
              label="Total inventory value"
              value={moneyCompact(totalValue, "NGN")}
              tone="accent"
            />
            <KpiTile
              label="SKUs below reorder point"
              value={belowReorder.toLocaleString()}
              tone={belowReorder > 0 ? "warn" : "accent"}
            />
          </>
        )}
      </div>

      {/* ── Row 2: Location breakdown ── */}
      <DataTable
        columns={locationColumns}
        rows={locationRows}
        rowKey={(r) => r.location_id}
        loading={isLoading}
        toolbar={
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-text-muted" />
            <span className="text-[13px] font-semibold">Location Breakdown</span>
          </div>
        }
      />

      {/* ── Row 3: Low-stock alert strip ── */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown className="w-4 h-4 text-warn" />
          <span className="text-[13px] font-semibold">Low-Stock Alerts</span>
          {alerts.data?.meta && (
            <span className="text-[11px] tabular-nums text-text-faint ml-auto">
              {alerts.data.meta.total} open
            </span>
          )}
        </div>

        {alerts.isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-3 rounded-xl bg-text-primary/[0.03] border border-line">
                <Skeleton className="w-3/4 mb-2" />
                <Skeleton className="w-1/2" />
              </div>
            ))}
          </div>
        )}

        {alerts.data && alerts.data.data.length === 0 && (
          <p className="text-[13px] text-text-muted py-4 text-center">No active stock alerts</p>
        )}

        {alerts.data && alerts.data.data.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {alerts.data.data.map((alert: StockAlert) => (
              <div
                key={alert.alert_id}
                className="p-3 rounded-xl bg-text-primary/[0.03] border border-line flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between">
                  <SeverityPill severity={alert.severity} />
                  <span className="text-[10px] text-text-faint tabular-nums">
                    {alert.projected_days_left != null
                      ? `${alert.projected_days_left}d left`
                      : "--"}
                  </span>
                </div>
                <span className="text-[12px] text-text-primary font-semibold truncate">
                  {alert.variant_id.slice(0, 8)}...
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-text-muted">Available</span>
                  <span
                    className={`text-[13px] font-semibold tabular-nums ${
                      alert.on_hand_at_detection === 0 ? "text-danger" : "text-text-primary"
                    }`}
                  >
                    {alert.on_hand_at_detection}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-text-muted">Reorder pt</span>
                  <span className="text-[12px] tabular-nums text-text-faint">
                    {alert.reorder_point}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Row 4: Recent movements ── */}
      <DataTable
        columns={movementColumns}
        rows={(movements.data?.data as StockMovement[]) ?? []}
        rowKey={(r) => r.movement_id}
        loading={movements.isLoading}
        toolbar={
          <div className="flex items-center gap-2">
            <ArrowDownUp className="w-4 h-4 text-text-muted" />
            <span className="text-[13px] font-semibold">Recent Movements</span>
          </div>
        }
      />
    </div>
  );
}
