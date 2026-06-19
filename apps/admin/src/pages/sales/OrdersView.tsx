import { useState } from "react";
import { ShoppingBag, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill, MoneyText } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useOrders } from "./hooks";
import { ORDER_STATUS, ORDER_STATUS_OPTIONS, SALES_CHANNELS } from "./constants";
import { OrderDetail } from "./OrderDetail";
import type { SalesOrder, OrderStatus } from "./types";

const columns: Column<SalesOrder>[] = [
  {
    key: "number",
    header: "Order #",
    width: "130px",
    render: (o) => <span className="font-mono text-[13px] font-semibold">{o.order_number}</span>,
  },
  {
    key: "contact",
    header: "Customer",
    render: (o) => <span className="text-[13px]">{o.contact_name ?? o.contact_id.slice(0, 8)}</span>,
  },
  {
    key: "channel",
    header: "Channel",
    render: (o) => (
      <span className="text-[12px] text-text-muted">
        {SALES_CHANNELS.find((c) => c.value === o.sales_channel)?.label ?? o.sales_channel}
      </span>
    ),
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
    render: (o) => <MoneyText ngn={Number(o.total_ngn)} />,
  },
  {
    key: "balance",
    header: "Balance",
    align: "right",
    render: (o) => {
      const bal = Number(o.balance_due_ngn);
      return bal > 0 ? <MoneyText ngn={bal} className="text-warn" /> : <span className="text-[12px] text-success">Paid</span>;
    },
  },
  {
    key: "date",
    header: "Date",
    width: "110px",
    render: (o) => <span className="text-[12px] text-text-muted">{new Date(o.created_at).toLocaleDateString()}</span>,
  },
];

export function OrdersView() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useOrders({
    status: status || undefined,
    search: search || undefined,
    page,
    page_size: 25,
  });

  const orders = data?.data ?? [];
  const meta = data?.meta;

  return (
    <>
      <DataTable
        columns={columns}
        rows={orders}
        rowKey={(o) => o.order_id}
        onRowClick={(o) => setSelectedId(o.order_id)}
        loading={isLoading}
        empty={{
          icon: <ShoppingBag className="w-8 h-8" />,
          title: "No orders yet",
          message: "Orders from Quick Sale and other channels will appear here.",
        }}
        toolbar={
          <>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
              <input
                placeholder="Search orders…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full h-[38px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
            </div>
            <Select
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={ORDER_STATUS_OPTIONS as { value: string; label: string }[]}
              className="w-[180px]"
            />
          </>
        }
      />

      {meta && meta.total > meta.page_size && (
        <div className="flex items-center justify-between text-[12px] text-text-muted mt-3 px-1">
          <span>
            Showing {(meta.page - 1) * meta.page_size + 1}–{Math.min(meta.page * meta.page_size, meta.total)} of {meta.total}
          </span>
          <div className="flex gap-1">
            <button
              disabled={meta.page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 h-8 rounded-[9px] border border-line text-[12px] font-semibold disabled:opacity-40 hover:bg-text-primary/[0.05]"
            >
              Prev
            </button>
            <button
              disabled={!meta.has_more}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 h-8 rounded-[9px] border border-line text-[12px] font-semibold disabled:opacity-40 hover:bg-text-primary/[0.05]"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <OrderDetail orderId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  );
}
