/**
 * Drill-down drawer — level two of the dashboard's drill-down: a paginated
 * detail table filtered to the exact period the tile showed, with quick
 * status/channel filters where the dataset supports them, Excel export
 * (whole domain workbook, export-permitted roles only) and an "Open in
 * module" jump into the real screen.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronLeft, ChevronRight, FileSpreadsheet, Table2 } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/primitives";
import {
  useDomainDetail,
  downloadDomainExcel,
  type PeriodParams,
  type TableColumn,
} from "@/lib/dashboards-api";
import { fmtValue } from "@/components/charts/chart-kit";
import { MODULE_ROUTES } from "./bits";

const FILTERABLE: Record<string, ("status" | "sales_channel")[]> = {
  "sales.orders": ["status", "sales_channel"],
  "logistics.deliveries": ["status"],
};

const STATUS_OPTIONS: Record<string, string[]> = {
  "sales.orders": [
    "pending_payment",
    "paid",
    "awaiting_dispatch",
    "completed",
    "cancelled",
    "refunded",
  ],
  "logistics.deliveries": [
    "queued",
    "booked",
    "picked_up",
    "in_transit",
    "out_for_delivery",
    "attempted_failed",
    "delivered",
  ],
};

const CHANNELS = ["storefront", "instagram", "whatsapp", "pos", "wholesale", "public_form"];

function toDataColumns(columns: TableColumn[]): Column<Record<string, unknown>>[] {
  return columns.map((c) => ({
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

export function DetailDrawer({
  domain,
  table,
  period,
  canExport,
  onClose,
}: {
  domain: string;
  table: string | null;
  period: PeriodParams;
  canExport: boolean;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [exporting, setExporting] = useState(false);

  const filterKey = `${domain}.${table}`;
  const filters = FILTERABLE[filterKey] ?? [];
  const detail = useDomainDetail(table ? domain : null, table, {
    ...period,
    page,
    page_size: 25,
    status: status || undefined,
    sales_channel: channel || undefined,
  });

  const moduleRoute = MODULE_ROUTES[filterKey];
  const meta = detail.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.page_size)) : 1;

  const reset = () => {
    setPage(1);
    setStatus("");
    setChannel("");
  };

  return (
    <Drawer
      open={!!table}
      onClose={() => {
        reset();
        onClose();
      }}
      title={detail.data?.label ?? "Detail"}
      subtitle={
        detail.data
          ? `${detail.data.period.from.slice(0, 10)} → ${detail.data.period.to.slice(0, 10)} · ${meta?.total ?? 0} rows`
          : undefined
      }
      wide
      footer={
        <div className="flex items-center gap-2 flex-wrap">
          {canExport && (
            <Button
              variant="secondary"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await downloadDomainExcel(domain, period);
                } finally {
                  setExporting(false);
                }
              }}
              icon={<FileSpreadsheet className="w-4 h-4" />}
            >
              {exporting ? "Exporting…" : "Export Excel"}
            </Button>
          )}
          {moduleRoute && (
            <Link to={moduleRoute} className="ml-auto">
              <Button variant="ghost" icon={<ArrowUpRight className="w-4 h-4" />}>
                Open in module
              </Button>
            </Link>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        {filters.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {filters.includes("status") && (
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="glass hairline rounded-lg h-9 px-2 text-[12px] bg-transparent"
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                {(STATUS_OPTIONS[filterKey] ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            )}
            {filters.includes("sales_channel") && (
              <select
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value);
                  setPage(1);
                }}
                className="glass hairline rounded-lg h-9 px-2 text-[12px] bg-transparent"
                aria-label="Filter by channel"
              >
                <option value="">All channels</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <DataTable
          columns={detail.data ? toDataColumns(detail.data.columns) : []}
          rows={(detail.data?.data ?? []).map((r, i) => ({ ...r, __i: i }))}
          rowKey={(r) => String(r.__i)}
          loading={detail.isLoading}
          empty={{
            icon: <Table2 className="w-6 h-6" />,
            title: "Nothing in this period",
            message: "Try a wider period or clear the filters.",
          }}
        />

        {meta && meta.total > meta.page_size && (
          <div className="flex items-center justify-end gap-2 text-[12px] text-text-muted">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="p-2 disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            Page {meta.page} of {totalPages}
            <button
              disabled={!meta.has_more}
              onClick={() => setPage((p) => p + 1)}
              className="p-2 disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </Drawer>
  );
}
