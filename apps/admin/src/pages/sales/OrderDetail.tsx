import { useState } from "react";
import {
  Link2,
  XCircle,
  FileText,
  Download,
  Send,
  Eye,
  Scissors,
  Truck,
  User,
  ExternalLink,
  Package,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Drawer } from "@/components/ui/Drawer";
import { Card, Pill, MoneyText, Button } from "@/components/ui/primitives";
import { ErrorState, ConfirmDialog, Select } from "@/components/ui/controls";
import { FormGrid } from "@/components/ui/Form";
import {
  useOrder,
  useOrderTimeline,
  useCreatePaymentLink,
  useCancelOrder,
  useOrderInvoice,
  useSendOrderInvoice,
  useOrderServiceJob,
  useOrderDelivery,
  useContactRecentOrders,
} from "./hooks";
import { generateReceipt } from "./api";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { toastReport } from "@/lib/error-report";
import { saveFileFromUrl } from "@/lib/api";
import { ORDER_STATUS, SALES_CHANNELS, fulfilmentLabel } from "./constants";
import type { OrderPayment } from "./types";

// ── Studio job status → friendly label + tone ────────────────
type Tone = "success" | "warn" | "danger" | "info" | "accent" | "neutral";
const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Awaiting stylist", tone: "warn" },
  assigned: { label: "Assigned", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  on_hold: { label: "On hold", tone: "warn" },
  returned_for_qc: { label: "Awaiting QC", tone: "warn" },
  qc_passed: { label: "QC passed", tone: "success" },
  rework: { label: "Rework", tone: "warn" },
  ready_for_dispatch: { label: "Ready to ship", tone: "success" },
  handed_to_sales: { label: "Handed to Sales", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

// ── Delivery status → friendly label + tone ──────────────────
const DELIVERY_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "warn" },
  booked: { label: "Booked", tone: "info" },
  picked_up: { label: "Picked up", tone: "info" },
  in_transit: { label: "In transit", tone: "info" },
  arrived_destination_city: { label: "Arrived city", tone: "info" },
  out_for_delivery: { label: "Out for delivery", tone: "info" },
  attempted_failed: { label: "Attempt failed", tone: "danger" },
  delivered: { label: "Delivered", tone: "success" },
  returned_to_sender: { label: "Returned", tone: "danger" },
  lost: { label: "Lost", tone: "danger" },
  damaged: { label: "Damaged", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const JOB_TERMINAL = new Set([
  "completed",
  "handed_to_sales",
  "ready_for_dispatch",
]);
const DELIVERY_TERMINAL = new Set(["delivered"]);

function fmtDate(iso?: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : null;
}
function fmtDateTime(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString() : null;
}

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
  const { data: job } = useOrderServiceJob(orderId);
  const { data: delivery } = useOrderDelivery(orderId);
  const { data: contactHistory } = useContactRecentOrders(
    order?.contact_id ?? null,
    orderId,
  );
  const sendInvoice = useSendOrderInvoice(orderId);
  const createLink = useCreatePaymentLink(orderId ?? "");
  const cancelOrder = useCancelOrder();
  const navigate = useNavigate();

  // Whether this order should have a Studio job. If it doesn't need styling
  // (plain wig sale) we don't dangle a "Not routed" scare in front of the user.
  const needsStudio = !!order?.lines?.some(
    (l) => l.line_kind === "styled" || l.line_kind === "service",
  );
  const needsDelivery = order?.order_type === "dispatch";

  // Fulfilment strip chips (Studio · Dispatch · Delivery).
  const jobMeta = job ? JOB_STATUS[job.status] : null;
  const jobDone = job ? JOB_TERMINAL.has(job.status) : false;
  const deliveryMeta = delivery ? DELIVERY_STATUS[delivery.status] : null;
  const deliveryDone = delivery ? DELIVERY_TERMINAL.has(delivery.status) : false;
  const paidTone: Tone = ["draft", "pending_payment"].includes(order?.status ?? "")
    ? "warn"
    : "success";

  // Contact history totals — lifetime NGN for the strip.
  const historyLtv = (contactHistory?.orders ?? []).reduce(
    (sum, o) => sum + Number(o.total_ngn || 0),
    0,
  );

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [showInvoiceSend, setShowInvoiceSend] = useState(false);
  const [invoiceSentVia, setInvoiceSentVia] = useState("email");
  const toast = useToastStore();
  const fireToast = (
    title: string,
    body: string,
    type = "order",
    priority: "normal" | "high" = "normal",
  ) => {
    if (priority === "high") {
      toastReport("Sales → Order", title, body || "Something went wrong.");
      return;
    }
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

  const handleSendInvoice = async () => {
    if (!invoice) return;
    try {
      await sendInvoice.mutateAsync({
        invoiceId: invoice.invoice_id,
        sent_via: invoiceSentVia,
      });
      setShowInvoiceSend(false);
      fireToast(
        "Invoice Sent",
        `Sent to the customer via ${invoiceSentVia.replace(/_/g, " ")}.`,
      );
    } catch (err) {
      fireToast(
        "Send Failed",
        err instanceof Error ? err.message : "Failed to send the invoice.",
        "order",
        "high",
      );
    }
  };

  // Delivery status for the order's invoice: Opened beats Sent beats Not sent.
  const invoiceDelivery = invoice
    ? invoice.first_viewed_at
      ? { label: "Opened", tone: "success" as const }
      : invoice.sent_at
        ? { label: "Sent", tone: "info" as const }
        : { label: "Not sent", tone: "neutral" as const }
    : null;

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

            {/* Fulfilment strip — Payment · Studio · Dispatch at a glance. Only
                shows the lanes this order actually needs (walk-in / digital
                orders skip the delivery lane; plain wig sales skip Studio). */}
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={paidTone}>
                {paidTone === "success" ? "Paid" : "Payment pending"}
              </Pill>
              {needsStudio && (
                <Pill tone={jobMeta?.tone ?? (jobDone ? "success" : "neutral")}>
                  <Scissors className="w-3 h-3 inline mr-1" />
                  Studio: {jobMeta?.label ?? "Not opened yet"}
                </Pill>
              )}
              {needsDelivery && (
                <Pill
                  tone={
                    deliveryMeta?.tone ?? (deliveryDone ? "success" : "neutral")
                  }
                >
                  <Truck className="w-3 h-3 inline mr-1" />
                  Delivery: {deliveryMeta?.label ?? "Not booked yet"}
                </Pill>
              )}
            </div>

            {/* Invoice link + delivery status */}
            {invoice && (
              <div className="p-3 rounded-[11px] bg-success/[0.06] border border-success/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-success shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold flex items-center gap-2">
                        Invoice {invoice.invoice_number}
                        {invoiceDelivery && (
                          <Pill tone={invoiceDelivery.tone}>
                            {invoiceDelivery.label}
                          </Pill>
                        )}
                      </div>
                      <div className="text-[11px] text-text-faint capitalize">
                        {invoice.status}
                        {invoice.first_viewed_at ? (
                          <span className="inline-flex items-center gap-1 ml-1 text-success normal-case">
                            <Eye className="w-3 h-3" />
                            opened {new Date(invoice.first_viewed_at).toLocaleDateString()}
                          </span>
                        ) : invoice.sent_at ? (
                          <span className="ml-1 normal-case">
                            · sent {new Date(invoice.sent_at).toLocaleDateString()}
                          </span>
                        ) : null}
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
                {/* Send / resend the invoice straight from the order. */}
                {!["void", "refunded"].includes(invoice.status) && (
                  showInvoiceSend ? (
                    <div className="flex items-center gap-2">
                      <Select
                        value={invoiceSentVia}
                        onChange={setInvoiceSentVia}
                        options={[
                          { value: "email", label: "Email" },
                          { value: "whatsapp", label: "WhatsApp" },
                          { value: "sms", label: "SMS" },
                        ]}
                        className="w-[130px]"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Send className="w-3.5 h-3.5" />}
                        onClick={handleSendInvoice}
                        disabled={sendInvoice.isPending}
                      >
                        {sendInvoice.isPending ? "Sending…" : "Confirm"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowInvoiceSend(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Send className="w-3.5 h-3.5" />}
                      onClick={() => setShowInvoiceSend(true)}
                    >
                      {invoice.sent_at ? "Resend Invoice" : "Send Invoice"}
                    </Button>
                  )
                )}
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
                  <div className="text-[13px] mt-1">
                    {fulfilmentLabel(order.order_type)}
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

            {/* Studio job — surface everything Sales cares about without
                round-tripping to Stylist Studio. Hidden when the order is a
                plain wig sale with no styling work. */}
            {needsStudio && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="micro flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5" />
                    Stylist Studio
                  </div>
                  {job && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ExternalLink className="w-3.5 h-3.5" />}
                      onClick={() =>
                        navigate(`/service-jobs?tab=board&job=${job.job_id}`)
                      }
                    >
                      Open in Studio
                    </Button>
                  )}
                </div>
                {job ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold">{job.job_number}</span>
                      {jobMeta && <Pill tone={jobMeta.tone}>{jobMeta.label}</Pill>}
                      {(job.rework_count ?? 0) > 0 && (
                        <Pill tone="warn">Rework ×{job.rework_count}</Pill>
                      )}
                    </div>
                    <FormGrid>
                      <div>
                        <div className="micro">Stylist</div>
                        <div className="text-[13px] mt-1">
                          {job.assigned_staff_user_id
                            ? job.assigned_staff_user_id.slice(0, 8)
                            : "Unassigned"}
                        </div>
                      </div>
                      <div>
                        <div className="micro">Started</div>
                        <div className="text-[13px] mt-1">
                          {fmtDateTime(job.started_at) ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="micro">Expected</div>
                        <div className="text-[13px] mt-1">
                          {fmtDate(job.expected_completion_at) ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="micro">Completed</div>
                        <div className="text-[13px] mt-1">
                          {fmtDateTime(job.completed_at) ?? "—"}
                        </div>
                      </div>
                    </FormGrid>
                  </div>
                ) : (
                  <div className="text-[13px] text-text-faint">
                    No Studio job yet. It opens automatically once the deposit
                    or full payment clears — refresh in a moment.
                  </div>
                )}
              </Card>
            )}

            {/* Delivery — where the wig is between Ops and the customer.
                Hidden for walk-in / digital orders that don't ship. */}
            {needsDelivery && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="micro flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5" />
                    Delivery
                  </div>
                  {delivery && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ExternalLink className="w-3.5 h-3.5" />}
                      onClick={() =>
                        navigate(`/logistics?delivery=${delivery.delivery_id}`)
                      }
                    >
                      Open in Logistics
                    </Button>
                  )}
                </div>
                {delivery ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold">
                        {delivery.delivery_number}
                      </span>
                      {deliveryMeta && (
                        <Pill tone={deliveryMeta.tone}>{deliveryMeta.label}</Pill>
                      )}
                      {delivery.is_pay_on_delivery && (
                        <Pill tone="warn">Pay on delivery</Pill>
                      )}
                    </div>
                    <FormGrid>
                      <div>
                        <div className="micro">Recipient</div>
                        <div className="text-[13px] mt-1">
                          {delivery.recipient_name ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="micro">Tracking</div>
                        <div className="text-[13px] mt-1">
                          {delivery.courier_tracking_ref ? (
                            delivery.courier_tracking_url ? (
                              <a
                                href={delivery.courier_tracking_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent hover:underline inline-flex items-center gap-1"
                              >
                                {delivery.courier_tracking_ref}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              delivery.courier_tracking_ref
                            )
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="micro">Scheduled</div>
                        <div className="text-[13px] mt-1">
                          {fmtDate(delivery.scheduled_for) ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="micro">Delivered</div>
                        <div className="text-[13px] mt-1">
                          {fmtDateTime(delivery.delivered_at) ??
                            (delivery.first_attempted_at
                              ? `attempt ${fmtDate(delivery.first_attempted_at)}`
                              : "—")}
                        </div>
                      </div>
                    </FormGrid>
                  </div>
                ) : (
                  <div className="text-[13px] text-text-faint">
                    No delivery booked yet. Sales hands the finished wig to
                    Logistics once Studio marks it ready to ship.
                  </div>
                )}
              </Card>
            )}

            {/* Customer history — quick take on this contact. Total orders +
                lifetime value + the last 5 orders, each opening in a fresh
                drawer so the trail is one click away. */}
            {contactHistory && contactHistory.orders.length > 0 && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="micro flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    Customer History
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigate(`/crm?contact=${order.contact_id}`)
                    }
                  >
                    Open Profile
                  </Button>
                </div>
                <FormGrid>
                  <div>
                    <div className="micro">Total orders</div>
                    <div className="text-[15px] font-semibold mt-1">
                      {contactHistory.total}
                    </div>
                  </div>
                  <div>
                    <div className="micro">Lifetime value</div>
                    <MoneyText
                      ngn={historyLtv}
                      className="text-[15px] mt-1 block"
                    />
                  </div>
                </FormGrid>
                <div className="h-px bg-line my-3" />
                <div className="space-y-1.5">
                  {contactHistory.orders.map((o) => {
                    const s = ORDER_STATUS[o.status];
                    return (
                      <button
                        key={o.order_id}
                        type="button"
                        className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-text-primary/[0.03] text-left text-[12px]"
                        onClick={() =>
                          navigate(`/sales?tab=orders&order=${o.order_id}`)
                        }
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Package className="w-3 h-3 text-text-faint shrink-0" />
                          <span className="font-semibold truncate">
                            {o.order_number}
                          </span>
                          {s && <Pill tone={s.tone}>{s.label}</Pill>}
                        </div>
                        <div className="text-right shrink-0">
                          <MoneyText ngn={Number(o.total_ngn)} />
                          <div className="text-[10px] text-text-faint">
                            {new Date(o.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </button>
                    );
                  })}
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
                          {new Date(ev.occurred_at).toLocaleString()}
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
