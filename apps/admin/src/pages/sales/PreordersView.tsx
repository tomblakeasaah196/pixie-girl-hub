import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill, MoneyText, Button } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { ErrorState } from "@/components/ui/controls";
import { useOrders } from "./hooks";
import { PreorderHistoryModal } from "./PreorderHistoryModal";
import { ORDER_STATUS } from "./constants";
import type { SalesOrder, OrderStatus } from "./types";

/** Days from today until a YYYY-MM-DD date (negative = overdue). */
function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

const columns: Column<SalesOrder>[] = [
  {
    key: "ready_by",
    header: "Ship by",
    width: "150px",
    render: (o) => {
      const days = daysUntil(o.preorder_ready_by);
      if (!o.preorder_ready_by || days === null)
        return <span className="text-[12px] text-text-faint">—</span>;
      const tone = days < 0 ? "danger" : days <= 7 ? "warn" : "neutral";
      const rel =
        days < 0
          ? `${Math.abs(days)}d overdue`
          : days === 0
            ? "today"
            : `in ${days}d`;
      return (
        <span className="inline-flex flex-col">
          <span className="text-[12.5px] font-medium">
            {formatDate(o.preorder_ready_by)}
          </span>
          <Pill tone={tone}>{rel}</Pill>
        </span>
      );
    },
  },
  {
    key: "number",
    header: "Order #",
    width: "130px",
    render: (o) => (
      <span className="font-mono text-[13px] font-semibold">
        {o.order_number}
      </span>
    ),
  },
  {
    key: "contact",
    header: "Customer",
    render: (o) => <span className="text-[13px]">{o.contact_name ?? "—"}</span>,
  },
  {
    key: "window",
    header: "Window",
    width: "120px",
    render: (o) => {
      const min = o.preorder_min_weeks;
      const max = o.preorder_max_weeks;
      const label =
        min && max && min !== max
          ? `${min}–${max} wks`
          : max || min
            ? `${max || min} wks`
            : "—";
      return <span className="text-[12px] text-text-muted">{label}</span>;
    },
  },
  {
    key: "status",
    header: "Status",
    render: (o) => {
      const s = ORDER_STATUS[o.status as OrderStatus];
      return s ? <Pill tone={s.tone}>{s.label}</Pill> : <Pill>{o.status}</Pill>;
    },
  },
  {
    key: "total",
    header: "Total",
    align: "right",
    render: (o) => (
      <span className="tabular-nums font-medium">
        <MoneyText ngn={Number(o.total_ngn)} />
      </span>
    ),
  },
];

/** Sales → Pre-orders: made-to-order orders, soonest production deadline first,
 *  so ops can see what to produce/procure and by when (000086). */
export function PreordersView() {
  const navigate = useNavigate();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useOrders({
    preorder: true,
    page_size: 50,
  });
  const orders = data?.data ?? [];

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  return (
    <>
      <DataTable
        columns={columns}
        rows={orders}
        rowKey={(o) => o.order_id}
        onRowClick={(o) => navigate(`/sales/orders/${o.order_id}`)}
        loading={isLoading}
        empty={{
          icon: <CalendarClock className="w-8 h-8" />,
          title: "No pre-orders",
          message:
            "When an out-of-stock item is ordered, it shows here with its production deadline.",
        }}
        toolbar={
          <div className="flex-1 flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setHistoryOpen(true)}
              title="Pre-orders fulfilled by arriving stock, and a manual backfill"
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Fulfilled pre-orders
            </Button>
          </div>
        }
      />
      <PreorderHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </>
  );
}
