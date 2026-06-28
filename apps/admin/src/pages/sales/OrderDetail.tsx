import { useState } from "react";
import { Link2, XCircle, FileText, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Drawer } from "@/components/ui/Drawer";
import { Card, Pill, MoneyText, Button } from "@/components/ui/primitives";
import { ErrorState, ConfirmDialog } from "@/components/ui/controls";
import { FormGrid } from "@/components/ui/Form";
import {
  useOrder,
  useOrderTimeline,
  useCreatePaymentLink,
  useCancelOrder,
  useOrderInvoice,
} from "./hooks";
import { generateReceipt } from "./api";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { saveFileFromUrl } from "@/lib/api";
import { ORDER_STATUS, SALES_CHANNELS } from "./constants";
import type { OrderPayment } from "./types";

export function OrderDetail({
  orderId,
  onClose,
}: {
  orderId: string | null;
  onClose: () => void;
}) {
  const { data: order, isLoading, isError, refetch } = useOrder(orderId);
  const { data: timeline } = useOrderTimeline(orderId);
  const { data: invoice } = useOrderInvoice(orderId);
  const createLink = useCreatePaymentLink(orderId ?? "");
  const cancelOrder = useCancelOrder();
  const navigate = useNavigate();

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const toast = useToastStore();
  const fireToast = (
    title: string,
    body: string,
    type = "order",
    priority: "normal" | "high" = "normal",
  ) => {
    toast.add({
      notification_id: crypto.randomUUID(),
      user_id: "",
      business: null,
      type,
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
  };

  const handlePayLink = async () => {
    if (!orderId || !order) return;
    try {
      const res = await createLink.mutateAsync({
        amount_ngn: Number(order.balance_due_ngn),
        // Settle in the currency the order was sold in. Omitting this billed a
        // USD order in Naira, letting Nomba reconvert at its own rate (the buyer
        // saw $708.25 instead of the quoted $764). NGN orders pass undefined.
        ...(order.display_currency && order.display_currency !== "NGN"
          ? { currency: order.display_currency }
          : {}),
      });
      await navigator.clipboard.writeText(res.checkout_url);
      fireToast("Link Copied", "Payment link copied to clipboard.");
    } catch {
      fireToast(
        "Link Failed",
        "Failed to generate payment link.",
        "payment",
        "high",
      );
    }
  };

  const handleCancel = async () => {
    if (!orderId) return;
    try {
      await cancelOrder.mutateAsync(orderId);
      setConfirmCancel(false);
      onClose();
      fireToast("Order Cancelled", "The order has been cancelled.");
    } catch {
      fireToast("Cancel Failed", "Failed to cancel order.", "order", "high");
    }
  };

  const handleReceipt = async () => {
    if (!orderId) return;
    setReceiptLoading(true);
    try {
      const res = await generateReceipt(orderId);
      await saveFileFromUrl(res.url, `${order?.order_number ?? "receipt"}.pdf`);
    } catch (err) {
      fireToast(
        "Receipt Failed",
        err instanceof Error ? err.message : "Failed to generate receipt.",
        "order",
        "high",
      );
    } finally {
      setReceiptLoading(false);
    }
  };

  const statusMeta = order ? ORDER_STATUS[order.status] : null;

  return (
    <>
      <Drawer
        open={!!orderId}
        onClose={onClose}
        title={order?.order_number ?? "Order"}
        subtitle={
          statusMeta && <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>
        }
        wide
      >
        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-12 rounded-xl bg-text-primary/[0.04] animate-pulse"
              />
            ))}
          </div>
        )}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {order && (
          <div className="space-y-5">
            {/* Balance ribbon */}
            {Number(order.balance_due_ngn) > 0 && (
              <div className="flex items-center justify-between p-4 rounded-[12px] bg-warn/[0.08] border border-warn/20">
                <div>
                  <div className="text-[11px] uppercase font-bold text-warn tracking-wide">
                    Balance Due
                  </div>
                  <MoneyText
                    ngn={Number(order.balance_due_ngn)}
                    className="text-[22px] text-warn"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Link2 className="w-3.5 h-3.5" />}
                  onClick={handlePayLink}
                  disabled={createLink.isPending}
                >
                  {createLink.isPending ? "Generating…" : "Send Pay Link"}
                </Button>
              </div>
            )}

            {/* Invoice link */}
            {invoice && (
              <div className="flex items-center justify-between p-3 rounded-[11px] bg-success/[0.06] border border-success/20">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-success" />
                  <div>
                    <div className="text-[13px] font-semibold">
                      Invoice {invoice.invoice_number}
                    </div>
                    <div className="text-[11px] text-text-faint capitalize">
                      {invoice.status}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    navigate(
                      `/invoicing?tab=invoices&invoice=${invoice.invoice_id}`,
                    )
                  }
                >
                  View Invoice
                </Button>
              </div>
            )}

            {/* Order info */}
            <Card className="p-4">
              <FormGrid>
                <div>
                  <div className="micro">Customer</div>
                  <div className="text-[14px] font-semibold mt-1">
                    {order.contact_name ?? order.contact_id.slice(0, 8)}
                  </div>
                  {(order.contact_phone || order.contact_email) && (
                    <div className="mt-1 space-y-0.5">
                      {order.contact_phone && (
                        <a
                          href={`tel:${order.contact_phone}`}
                          className="block text-[12px] text-text-muted hover:text-accent"
                        >
                          {order.contact_phone}
                        </a>
                      )}
                      {order.contact_email && (
                        <a
                          href={`mailto:${order.contact_email}`}
                          className="block text-[12px] text-text-muted hover:text-accent truncate"
                        >
                          {order.contact_email}
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <div className="micro">Channel</div>
                  <div className="text-[13px] mt-1">
                    {order.sales_campaign_id
                      ? `Sales Campaign${order.utm_campaign ? ` · ${order.utm_campaign}` : ""}`
                      : (SALES_CHANNELS.find(
                          (c) => c.value === order.sales_channel,
                        )?.label ?? order.sales_channel)}
                  </div>
                </div>
                <div>
                  <div className="micro">Created</div>
                  <div className="text-[13px] mt-1">
                    {new Date(order.created_at).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="micro">Fulfilment</div>
                  <div className="text-[13px] mt-1 capitalize">
                    {order.order_type?.replace(/_/g, " ")}
                  </div>
                </div>
                <div>
                  <div className="micro">Paid in</div>
                  <div className="text-[13px] mt-1">
                    {order.display_currency && order.display_currency !== "NGN"
                      ? `${order.display_currency} · ₦${Number(order.fx_rate_used).toLocaleString()}/$`
                      : "Naira (₦)"}
                  </div>
                </div>
              </FormGrid>
            </Card>

            {/* Lines */}
            {order.lines && order.lines.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Items</div>
                <div className="space-y-2">
                  {order.lines.map((l) => (
                    <div
                      key={l.line_id}
                      className="flex items-center justify-between text-[13px]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">
                          {l.product_name_snapshot}
                        </div>
                        {l.variant_label_snapshot && (
                          <div className="text-[11px] text-text-faint">
                            {l.variant_label_snapshot}
                          </div>
                        )}
                      </div>
                      <div className="text-text-muted mx-3 text-right shrink-0">
                        <div>×{l.quantity}</div>
                        <div className="text-[10px] text-text-faint">
                          @ {Number(l.unit_price_ngn).toLocaleString()}
                        </div>
                      </div>
                      <MoneyText ngn={Number(l.line_total_ngn)} />
                    </div>
                  ))}
                  <div className="h-px bg-line my-2" />
                  <div className="flex justify-between text-[13px]">
                    <span className="text-text-muted">Subtotal</span>
                    <MoneyText ngn={Number(order.subtotal_ngn)} />
                  </div>
                  {Number(order.discount_amount_ngn) > 0 && (
                    <div className="flex justify-between text-[13px]">
                      <span className="text-text-muted">Discount</span>
                      <span className="text-success">
                        −<MoneyText ngn={Number(order.discount_amount_ngn)} />
                      </span>
                    </div>
                  )}
                  {Number(order.tax_amount_ngn) > 0 && (
                    <div className="flex justify-between text-[13px]">
                      <span className="text-text-muted">Tax</span>
                      <MoneyText ngn={Number(order.tax_amount_ngn)} />
                    </div>
                  )}
                  {Number(order.shipping_fee_ngn) > 0 && (
                    <div className="flex justify-between text-[13px]">
                      <span className="text-text-muted">Shipping</span>
                      <MoneyText ngn={Number(order.shipping_fee_ngn)} />
                    </div>
                  )}
                  <div className="flex justify-between text-[15px] font-semibold pt-1">
                    <span>Total (₦)</span>
                    <MoneyText ngn={Number(order.total_ngn)} />
                  </div>
                  {order.display_currency &&
                    order.display_currency !== "NGN" && (
                      <div className="mt-2 pt-2 border-t border-line space-y-1.5">
                        <div className="flex justify-between text-[13px]">
                          <span className="text-text-muted">Exchange rate</span>
                          <span className="tabular-nums">
                            ₦{Number(order.fx_rate_used).toLocaleString()} / $1
                          </span>
                        </div>
                        <div className="flex justify-between text-[14px] font-semibold">
                          <span>Charged in {order.display_currency}</span>
                          <span className="tabular-nums">
                            ${Number(order.display_total ?? 0).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    )}
                </div>
              </Card>
            )}

            {/* Payments ledger */}
            {order.payments && order.payments.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Payments</div>
                <div className="space-y-2">
                  {order.payments.map((p: OrderPayment) => (
                    <div
                      key={p.payment_id}
                      className="flex items-center justify-between text-[13px] p-2 rounded-lg bg-text-primary/[0.02]"
                    >
                      <div>
                        <div className="font-semibold">{p.payment_number}</div>
                        <div className="text-[11px] text-text-faint capitalize">
                          {p.method.replace(/_/g, " ")}
                        </div>
                      </div>
                      <div className="text-right">
                        <MoneyText ngn={Number(p.amount_ngn)} />
                        <div className="text-[10px] text-text-faint">
                          {new Date(p.captured_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Timeline */}
            {timeline && timeline.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Timeline</div>
                <div className="space-y-3">
                  {timeline.map((ev) => (
                    <div key={ev.event_id} className="flex gap-3 text-[12px]">
                      <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-accent shrink-0" />
                      <div>
                        <div className="font-semibold">{ev.label}</div>
                        <div className="text-text-faint">
                          {new Date(ev.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Actions */}
            <div className="flex gap-2 flex-wrap">
              {order.status === "paid" && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download className="w-3.5 h-3.5" />}
                  onClick={handleReceipt}
                  disabled={receiptLoading}
                >
                  {receiptLoading ? "Generating…" : "Download Receipt"}
                </Button>
              )}
              {order.status !== "cancelled" && order.status !== "completed" && (
                <Button
                  variant="danger"
                  size="sm"
                  icon={<XCircle className="w-3.5 h-3.5" />}
                  onClick={() => setConfirmCancel(true)}
                >
                  Cancel Order
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={handleCancel}
        title="Cancel Order"
        message="Are you sure you want to cancel this order? This action cannot be undone."
        confirmLabel="Cancel Order"
        busy={cancelOrder.isPending}
      />
    </>
  );
}
