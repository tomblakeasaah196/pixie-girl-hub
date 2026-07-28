import { useState } from "react";
import { Archive, RotateCcw, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Pill, MoneyText, Button } from "@/components/ui/primitives";
import { ConfirmDialog, ErrorState } from "@/components/ui/controls";
import { formatDate } from "@/lib/format";
import { useOrders, useRestoreOrder } from "./hooks";
import { useToastStore } from "@/components/notifications/NotificationToast";
import type { SalesOrder } from "./types";
import type { RestoreShortLine } from "./api";

/**
 * The Orders archive — cancelled orders, kept out of the working list and
 * reachable from the Archive button in the toolbar.
 *
 * Restoring is two-phase because cancelling released the order's stock hold: the
 * first call dry-runs and, if some lines can no longer be re-held, reports them
 * so the operator explicitly accepts bringing those lines back as pre-orders.
 * Orders whose deposit was forfeited to income on cancellation are refused by
 * the API outright — reversing that posting is a finance decision.
 */
export function OrdersArchiveModal({
  open,
  onClose,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const [page, setPage] = useState(1);
  const addToast = useToastStore((s) => s.add);
  const restore = useRestoreOrder();

  const fireToast = (title: string, body: string) =>
    addToast({
      notification_id: crypto.randomUUID(),
      user_id: "",
      business: null,
      type: "order",
      priority: "normal",
      title,
      body,
      reference_type: null,
      reference_id: null,
      action_url: null,
      is_read: false,
      read_at: null,
      created_at: new Date().toISOString(),
    });

  // Pending confirmation after a dry run reported short stock.
  const [pending, setPending] = useState<{
    order: SalesOrder;
    shortLines: RestoreShortLine[];
    message: string;
  } | null>(null);

  const { data, isLoading, isError, refetch } = useOrders({
    status: "cancelled",
    page,
    page_size: 25,
  });
  const orders = data?.data ?? [];
  const meta = data?.meta;

  const runRestore = async (order: SalesOrder, confirm: boolean) => {
    try {
      const res = await restore.mutateAsync({ id: order.order_id, confirm });
      if (res.requires_confirmation) {
        setPending({
          order,
          shortLines: res.short_lines ?? [],
          message: res.message ?? "Some items are no longer in stock.",
        });
        return;
      }
      setPending(null);
      fireToast(
        "Order restored",
        res.preorder_line_count
          ? `${order.order_number} is back as ${res.restored_to?.replace(/_/g, " ")} — ${res.preorder_line_count} item${res.preorder_line_count === 1 ? "" : "s"} as pre-order.`
          : `${order.order_number} is back as ${res.restored_to?.replace(/_/g, " ")}.`,
      );
      onRestored?.();
    } catch (err) {
      setPending(null);
      fireToast(
        "Couldn't restore",
        err instanceof Error ? err.message : "Please try again.",
      );
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="xl"
        title={
          <span className="flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Archived orders
            {meta ? (
              <span className="text-text-faint font-normal">({meta.total})</span>
            ) : null}
          </span>
        }
      >
        {isError ? (
          <ErrorState onRetry={refetch} />
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-[52px] rounded-[11px] bg-text-primary/[0.04] animate-pulse"
              />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="py-12 text-center">
            <Archive className="h-7 w-7 mx-auto mb-3 text-text-faint" />
            <div className="text-[13px] font-semibold">Nothing archived</div>
            <div className="text-[12px] text-text-faint mt-1">
              Cancelled orders show up here so the Orders list stays clean.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <div
                key={o.order_id}
                className="flex items-center gap-3 p-3 rounded-[11px] border border-line bg-text-primary/[0.02]"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">
                      {o.order_number}
                    </span>
                    <Pill tone="danger">Cancelled</Pill>
                  </div>
                  <div className="text-[11.5px] text-text-faint truncate mt-0.5">
                    {o.contact_name || "—"} ·{" "}
                    {o.cancelled_at
                      ? `cancelled ${formatDate(o.cancelled_at)}`
                      : formatDate(o.created_at)}
                    {o.cancellation_reason ? ` · ${o.cancellation_reason}` : ""}
                  </div>
                </div>
                <MoneyText ngn={Number(o.total_ngn)} className="text-[13px]" />
                <Button
                  variant="secondary"
                  onClick={() => runRestore(o, false)}
                  disabled={restore.isPending}
                  className="shrink-0"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}

        {meta && meta.total > meta.page_size && (
          <div className="flex items-center justify-between text-[12px] text-text-muted mt-3 px-1">
            <span>
              Showing {(meta.page - 1) * meta.page_size + 1}–
              {Math.min(meta.page * meta.page_size, meta.total)} of {meta.total}
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
      </Modal>

      {/* Short-stock warning: the operator decides whether a pre-order is
          acceptable rather than the restore silently downgrading the order. */}
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => pending && runRestore(pending.order, true)}
        title="Restore as pre-order?"
        confirmLabel="Restore anyway"
        tone="accent"
        busy={restore.isPending}
        message={
          pending ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{pending.message}</span>
              </div>
              <div className="rounded-[10px] border border-line divide-y divide-line/60">
                {pending.shortLines.map((l) => (
                  <div
                    key={l.line_id}
                    className="flex items-center justify-between px-3 py-2 text-[12px]"
                  >
                    <span className="truncate mr-3">{l.name || l.variant_id}</span>
                    <span className="text-text-faint whitespace-nowrap tabular-nums">
                      need {l.wanted} · {l.available} left
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-text-faint">
                {pending.order.order_number} will come back with{" "}
                {pending.shortLines.length === 1 ? "that item" : "those items"} as
                a pre-order. Everything still in stock is re-held immediately.
              </div>
            </div>
          ) : null
        }
      />
    </>
  );
}
