import { useState } from "react";
import { Truck, Search, CheckCircle } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { MoneyText, Button } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { useDeliveryPendingOrders, useSetOrderDeliveryFee } from "./hooks";
import { OrderDetail } from "./OrderDetail";
import type { SalesOrder } from "./types";
import { useToastStore } from "@/components/notifications/NotificationToast";

function SetFeeModal({
  order,
  onClose,
}: {
  order: SalesOrder | null;
  onClose: () => void;
}) {
  const [fee, setFee] = useState("");
  const { mutateAsync, isPending } = useSetOrderDeliveryFee();
  const toast = useToastStore();

  if (!order) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseFloat(fee);
    if (isNaN(num) || num < 0) return;
    const mkToast = (title: string, body: string, priority: "normal" | "high" = "normal") =>
      toast.add({
        notification_id: crypto.randomUUID(),
        user_id: "",
        business: null,
        type: "order",
        priority,
        title,
        body,
        reference_type: null,
        reference_id: null,
        action_url: null,
        is_read: false,
        read_at: null,
        created_at: new Date().toISOString(),
      });
    try {
      await mutateAsync({ id: order!.order_id, fee_ngn: num });
      mkToast("Delivery fee set", `₦${num.toLocaleString()} applied to ${order!.order_number}.`);
      onClose();
    } catch {
      mkToast("Failed", "Could not update the fee.", "high");
    }
  }

  return (
    <Modal open onClose={onClose} title={`Set delivery fee — ${order.order_number}`}>
      <form onSubmit={handleSubmit} className="space-y-5 p-1">
        <p className="text-[13px] text-text-muted leading-relaxed">
          This order's delivery fee could not be automatically priced. Enter the
          confirmed rate to bill the customer and clear the pending flag.
        </p>
        <div>
          <label className="block text-[12px] font-semibold text-text-muted mb-1.5">
            Delivery fee (₦)
          </label>
          <input
            type="number"
            min="0"
            step="100"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="e.g. 3500"
            autoFocus
            className="w-full h-[42px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[14px] outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-9 rounded-[9px] border border-line text-[13px] font-semibold hover:bg-text-primary/[0.05]"
          >
            Cancel
          </button>
          <Button
            type="submit"
            disabled={isPending || fee === "" || isNaN(parseFloat(fee))}
          >
            <CheckCircle className="w-4 h-4" />
            Confirm fee
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const columns: Column<SalesOrder>[] = [
  {
    key: "number",
    header: "Order #",
    width: "130px",
    render: (o) => (
      <span className="font-mono text-[13px] font-semibold">{o.order_number}</span>
    ),
  },
  {
    key: "contact",
    header: "Customer",
    render: (o) => (
      <span className="text-[13px]">{o.contact_name ?? "—"}</span>
    ),
  },
  {
    key: "channel",
    header: "Campaign",
    render: (o) => (
      <span className="text-[12px] text-text-muted">
        {o.utm_campaign ?? (o.sales_campaign_id ? "Sales Campaign" : "—")}
      </span>
    ),
  },
  {
    key: "goods",
    header: "Goods total",
    align: "right",
    render: (o) => (
      <MoneyText ngn={Number(o.subtotal_ngn) - Number(o.discount_amount_ngn)} />
    ),
  },
  {
    key: "logistics",
    header: "Logistics (billed)",
    align: "right",
    render: (o) => {
      const s = Number(o.shipping_fee_ngn);
      return s > 0 ? (
        <MoneyText ngn={s} />
      ) : (
        <span className="text-warn text-[12px] font-semibold">₦0 — pending</span>
      );
    },
  },
  {
    key: "total",
    header: "Order total",
    align: "right",
    render: (o) => <MoneyText ngn={Number(o.total_ngn)} />,
  },
  {
    key: "date",
    header: "Date",
    width: "130px",
    render: (o) => {
      const d = new Date(o.created_at);
      return (
        <span className="text-[12px] text-text-muted">
          <span className="block">{d.toLocaleDateString()}</span>
          <span className="block text-[11px] opacity-70">
            {d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
        </span>
      );
    },
  },
];

export function DeliveryPendingView() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feeOrder, setFeeOrder] = useState<SalesOrder | null>(null);

  const { data, isLoading, isError, refetch } = useDeliveryPendingOrders({
    page,
    page_size: 25,
  });

  const orders = data?.data ?? [];
  const meta = data?.meta;
  const filtered = search
    ? orders.filter(
        (o) =>
          o.order_number.toLowerCase().includes(search.toLowerCase()) ||
          (o.contact_name ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : orders;

  const tableColumns: Column<SalesOrder>[] = [
    ...columns,
    {
      key: "action",
      header: "",
      width: "90px",
      render: (o) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setFeeOrder(o);
          }}
          className="px-3 h-7 rounded-[7px] border border-accent/40 text-accent text-[12px] font-semibold hover:bg-accent/[0.08] transition-colors whitespace-nowrap"
        >
          Set fee
        </button>
      ),
    },
  ];

  return (
    <>
      <div className="rounded-[13px] border border-warn/30 bg-warn/[0.06] px-4 py-3 mb-4">
        <p className="text-[13px] text-warn font-semibold leading-snug">
          These orders have an unconfirmed delivery rate. Confirm the fee with
          the customer and set it here before dispatching — ₦0 means the
          logistics cost hasn't been recovered yet.
        </p>
      </div>

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          <DataTable
            columns={tableColumns}
            rows={filtered}
            rowKey={(o) => o.order_id}
            onRowClick={(o) => setSelectedId(o.order_id)}
            loading={isLoading}
            empty={{
              icon: <Truck className="w-8 h-8" />,
              title: "No pending delivery fees",
              message: "All orders have confirmed delivery rates.",
            }}
            toolbar={
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
                <input
                  placeholder="Filter orders…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="w-full h-[38px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
                />
              </div>
            }
          />

          {meta && meta.total > meta.page_size && (
            <div className="flex items-center justify-between text-[12px] text-text-muted mt-3 px-1">
              <span>
                Showing {(meta.page - 1) * meta.page_size + 1}–
                {Math.min(meta.page * meta.page_size, meta.total)} of{" "}
                {meta.total}
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
        </>
      )}

      <OrderDetail orderId={selectedId} onClose={() => setSelectedId(null)} />
      <SetFeeModal order={feeOrder} onClose={() => setFeeOrder(null)} />
    </>
  );
}
