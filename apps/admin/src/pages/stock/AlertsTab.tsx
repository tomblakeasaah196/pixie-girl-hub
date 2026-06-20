import { useState, useMemo } from "react";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ErrorState, Select } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useStockAlerts, useStockMutations } from "./hooks";
import type { StockAlert } from "./types";
import { SeverityPill, StatusPill, Pagination } from "./parts";

/* ─── Constants ─── */

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "dismissed", label: "Dismissed" },
  { value: "resolved", label: "Resolved" },
];

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const PAGE_SIZE = 20;

/* ─── Main Component ─── */

export default function AlertsTab() {
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const alertsQ = useStockAlerts({
    status: statusFilter || undefined,
    page,
    page_size: PAGE_SIZE,
  });

  const mutations = useStockMutations();

  /* sort by severity then detected_at desc */
  const sortedAlerts = useMemo(() => {
    const data = alertsQ.data?.data ?? [];
    return [...data].sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 99;
      const sb = SEVERITY_ORDER[b.severity] ?? 99;
      if (sa !== sb) return sa - sb;
      return (
        new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
      );
    });
  }, [alertsQ.data]);

  const meta = alertsQ.data?.meta;

  /* ─── Columns ─── */

  const columns: Column<StockAlert>[] = [
    {
      key: "variant_id",
      header: "Product",
      render: (r) => (
        <span className="font-mono text-[13px] text-text-primary">
          {r.variant_id.slice(0, 12)}...
        </span>
      ),
    },
    {
      key: "location_id",
      header: "Location",
      render: (r) => (
        <span className="text-[13px] text-text-secondary">
          {r.location_id ? r.location_id.slice(0, 12) + "..." : "All"}
        </span>
      ),
    },
    {
      key: "available",
      header: "Available",
      align: "right",
      render: (r) => (
        <span
          className={`tabular-nums text-[13px] font-semibold ${
            r.on_hand_at_detection === 0 ? "text-danger" : "text-text-primary"
          }`}
        >
          {r.on_hand_at_detection}
        </span>
      ),
    },
    {
      key: "reorder_point",
      header: "Reorder Point",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-[13px] text-text-muted">
          {r.reorder_point}
        </span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      render: (r) => <SeverityPill severity={r.severity} />,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill status={r.status} />,
    },
    {
      key: "detected_at",
      header: "Detected",
      render: (r) => (
        <span className="text-[12px] text-text-faint tabular-nums">
          {new Date(r.detected_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => <AlertActions alert={r} mutations={mutations} />,
    },
  ];

  /* ─── Render ─── */

  if (alertsQ.isError) {
    return (
      <ErrorState
        message="Failed to load stock alerts."
        onRetry={() => alertsQ.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_OPTIONS}
        />
      </div>

      {/* ── Table ── */}
      <DataTable
        columns={columns}
        rows={sortedAlerts}
        rowKey={(r) => r.alert_id}
        loading={alertsQ.isLoading}
        empty={{
          icon: <CheckCircle className="w-10 h-10 text-success" />,
          title: "All stock levels are healthy.",
        }}
      />
      {meta && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={meta.total}
          onChange={setPage}
        />
      )}
    </div>
  );
}

/* ─── Alert Row Actions ─── */

function AlertActions({
  alert,
  mutations,
}: {
  alert: StockAlert;
  mutations: ReturnType<typeof useStockMutations>;
}) {
  if (alert.status === "resolved" || alert.status === "dismissed") {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5 justify-end">
      {alert.status === "open" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => mutations.acknowledgeAlert.mutate(alert.alert_id)}
          disabled={mutations.acknowledgeAlert.isPending}
        >
          Acknowledge
        </Button>
      )}
      {alert.status === "acknowledged" && (
        <Button
          variant="primary"
          size="sm"
          onClick={() => mutations.resolveAlert.mutate(alert.alert_id)}
          disabled={mutations.resolveAlert.isPending}
        >
          Resolve
        </Button>
      )}
    </div>
  );
}
