/**
 * OrderDetailPage — the informative heart of an order. Everything about the
 * order in one full-page surface so nothing important lives behind a click:
 *   • Sticky action bar (top): back, order # + status + balance, contextual
 *     actions (pay link, invoice, receipt, deep-links to Studio + Logistics,
 *     cancel).
 *   • Fulfilment strip (Payment · Studio · Dispatch) — one glance status.
 *   • AI risk chip — signals derived from order + studio + delivery state
 *     (overdue wig, invoice not sent while paid, delivery attempt failed, …).
 *   • Items · Payments · Studio · Delivery cards.
 *   • Comms log — every customer-facing message (invoice send + reminders)
 *     with deliverability + open state.
 *   • Attachments — style-brief references from the Studio job + POD photos.
 *   • Customer history — LTV + last five orders, clickable.
 *   • Timeline (raw event stream) at the bottom.
 *
 * Route: /sales/orders/:orderId. Escape or the back button returns to
 * /sales?tab=orders&order=<id> so the list restores highlight + focus on the
 * source row.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  ArrowLeft,
  AlertTriangle,
  Paperclip,
  Mail,
  MessageCircle,
  Phone,
  Bell,
  Sparkles,
} from "lucide-react";
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
  useInvoiceReminders,
} from "./hooks";
import { generateReceipt } from "./api";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { saveFileFromUrl } from "@/lib/api";
import { ORDER_STATUS, SALES_CHANNELS, fulfilmentLabel } from "./constants";
import type { OrderPayment } from "./types";
import { useJobReferences } from "@/pages/service-jobs/hooks";

// ── Status → label maps (kept local so the drawer + page share nothing but
//    types; if we ever kill the drawer, this file already owns them). ────────
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
function channelIcon(ch: string) {
  if (ch === "email") return <Mail className="w-3.5 h-3.5" />;
  if (ch === "whatsapp") return <MessageCircle className="w-3.5 h-3.5" />;
  if (ch === "sms") return <Phone className="w-3.5 h-3.5" />;
  return <Bell className="w-3.5 h-3.5" />;
}

// ── Derived risk signals — computed from data already loaded, no new API ─────
interface RiskSignal {
  key: string;
  label: string;
  tone: Tone;
  action?: { label: string; to: string };
}
function computeRisks(args: {
  order: ReturnType<typeof useOrder>["data"];
  job: ReturnType<typeof useOrderServiceJob>["data"];
  delivery: ReturnType<typeof useOrderDelivery>["data"];
  invoice: ReturnType<typeof useOrderInvoice>["data"];
  needsStudio: boolean;
  needsDelivery: boolean;
}): RiskSignal[] {
  const { order, job, delivery, invoice, needsStudio, needsDelivery } = args;
  if (!order) return [];
  const now = Date.now();
  const risks: RiskSignal[] = [];
  const paidStates = new Set(["paid", "awaiting_dispatch", "completed"]);
  const orderPaid = paidStates.has(order.status);

  if (order.status === "cancellation_requested") {
    risks.push({
      key: "cancel-request",
      label: "Cancellation requested — needs review",
      tone: "danger",
    });
  }
  // Studio should have a job by now (auto-open runs on order.paid).
  if (needsStudio && orderPaid && !job) {
    risks.push({
      key: "no-studio-job",
      label: "Studio hasn't opened a job yet",
      tone: "warn",
    });
  }
  // Wig sitting in Studio past its SLA.
  if (job?.expected_completion_at && !JOB_TERMINAL.has(job.status)) {
    const due = new Date(job.expected_completion_at).getTime();
    if (due < now) {
      const daysLate = Math.floor((now - due) / 86_400_000);
      risks.push({
        key: "studio-sla",
        label:
          daysLate <= 0
            ? "Studio SLA due today"
            : `Studio SLA overdue by ${daysLate}d`,
        tone: "danger",
        action: {
          label: "Open Studio",
          to: `/service-jobs?tab=board&job=${job.job_id}`,
        },
      });
    }
  }
  if ((job?.rework_count ?? 0) > 0) {
    risks.push({
      key: "rework",
      label: `Reworked ×${job?.rework_count}`,
      tone: "warn",
    });
  }
  // Invoice raised but never sent to the customer.
  if (invoice && !invoice.sent_at) {
    risks.push({
      key: "invoice-not-sent",
      label: "Invoice not sent to customer",
      tone: "warn",
    });
  }
  // Delivery failure state.
  if (delivery?.status === "attempted_failed") {
    risks.push({
      key: "delivery-failed",
      label: "Last delivery attempt failed",
      tone: "danger",
      action: {
        label: "Open Logistics",
        to: `/logistics?delivery=${delivery.delivery_id}`,
      },
    });
  }
  if (
    delivery &&
    ["lost", "damaged", "returned_to_sender"].includes(delivery.status)
  ) {
    risks.push({
      key: "delivery-bad",
      label: `Delivery ${delivery.status.replace(/_/g, " ")}`,
      tone: "danger",
    });
  }
  // Paid dispatch order with no delivery booked in >24h.
  if (needsDelivery && orderPaid && !delivery) {
    const paidAge = order.updated_at
      ? now - new Date(order.updated_at).getTime()
      : 0;
    if (paidAge > 86_400_000) {
      risks.push({
        key: "no-delivery",
        label: "No delivery booked yet (paid >24h ago)",
        tone: "warn",
      });
    }
  }
  return risks;
}

export function OrderDetailPage() {
  const { orderId = null } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const toast = useToastStore();

  const { data: order, isLoading, isError, refetch } = useOrder(orderId);
  const { data: timeline } = useOrderTimeline(orderId);
  const { data: invoice } = useOrderInvoice(orderId);
  const { data: reminders = [] } = useInvoiceReminders(
    invoice?.invoice_id ?? null,
  );
  const { data: job } = useOrderServiceJob(orderId);
  const { data: delivery } = useOrderDelivery(orderId);
  const { data: references = [] } = useJobReferences(job?.job_id ?? null);
  const { data: contactHistory } = useContactRecentOrders(
    order?.contact_id ?? null,
    orderId,
  );
  const sendInvoice = useSendOrderInvoice(orderId);
  const createLink = useCreatePaymentLink(orderId ?? "");
  const cancelOrder = useCancelOrder();

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [showInvoiceSend, setShowInvoiceSend] = useState(false);
  const [invoiceSentVia, setInvoiceSentVia] = useState("email");

  // Return to the list, keeping the source row highlighted (?order=<id>).
  const goBack = () => {
    if (orderId) sessionStorage.setItem("sales-orders-last", orderId);
    navigate(`/sales?tab=orders&order=${orderId ?? ""}`);
  };
  // Escape → back. Also stamp last-opened before leaving via browser back.
  useEffect(() => {
    if (orderId) sessionStorage.setItem("sales-orders-last", orderId);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

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
      fireToast("Order Cancelled", "The order has been cancelled.");
      goBack();
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

  // ── Derived flags for the panels ─────────────────────────────
  const needsStudio = !!order?.lines?.some(
    (l) => l.line_kind === "styled" || l.line_kind === "service",
  );
  const needsDelivery = order?.order_type === "dispatch";
  const jobMeta = job ? JOB_STATUS[job.status] : null;
  const jobDone = job ? JOB_TERMINAL.has(job.status) : false;
  const deliveryMeta = delivery ? DELIVERY_STATUS[delivery.status] : null;
  const deliveryDone = delivery ? DELIVERY_TERMINAL.has(delivery.status) : false;
  const paidTone: Tone = ["draft", "pending_payment"].includes(
    order?.status ?? "",
  )
    ? "warn"
    : "success";
  const invoiceDelivery = invoice
    ? invoice.first_viewed_at
      ? { label: "Opened", tone: "success" as const }
      : invoice.sent_at
        ? { label: "Sent", tone: "info" as const }
        : { label: "Not sent", tone: "neutral" as const }
    : null;
  const statusMeta = order ? ORDER_STATUS[order.status] : null;
  const historyLtv = (contactHistory?.orders ?? []).reduce(
    (sum, o) => sum + Number(o.total_ngn || 0),
    0,
  );

  // Style-brief image references (Studio) — surface as thumbnails.
  const imageRefs = useMemo(
    () => references.filter((r) => r.ref_type === "image"),
    [references],
  );
  const otherRefs = useMemo(
    () => references.filter((r) => r.ref_type !== "image"),
    [references],
  );

  const risks = computeRisks({
    order,
    job,
    delivery,
    invoice,
    needsStudio,
    needsDelivery,
  });

  // ── Studio stage rail — the wig's journey through operations ─────────
  // Which rail position each status corresponds to (1-based).
  const STAGE_OF_STATUS: Record<string, number> = {
    pending: 1,
    assigned: 2,
    in_progress: 3,
    on_hold: 3,
    rework: 3,
    returned_for_qc: 4,
    qc_passed: 4,
    ready_for_dispatch: 5,
    handed_to_sales: 6,
    completed: 6,
  };
  interface StudioStage {
    key: string;
    label: string;
    when: string | null;
    state: "done" | "active" | "todo";
    warn?: boolean;
    sub?: string;
  }
  const studioStages = useMemo<StudioStage[]>(() => {
    if (!job || ["cancelled", "rejected"].includes(job.status)) return [];
    const at = STAGE_OF_STATUS[job.status] ?? 1;
    const terminal = job.status === "handed_to_sales" || job.status === "completed";
    const defs = [
      { key: "queued", label: "Queued", when: job.created_at ?? null },
      { key: "assigned", label: "Assigned", when: job.assigned_at },
      {
        key: "styling",
        label: job.status === "rework" ? "Styling (rework)" : "Styling",
        when: job.started_at,
        warn: job.status === "rework" || job.status === "on_hold",
        sub: job.status === "on_hold" ? "on hold" : undefined,
      },
      { key: "qc", label: "QC", when: job.qc_at ?? job.returned_at },
      { key: "ready", label: "Ready", when: job.ready_at },
      {
        key: "done",
        label: "Handed off",
        when: job.handed_at ?? job.completed_at,
      },
    ];
    return defs.map((d, i) => {
      const idx = i + 1;
      const state: StudioStage["state"] =
        idx < at || (idx === at && terminal)
          ? "done"
          : idx === at
            ? "active"
            : "todo";
      return { ...d, when: d.when ?? null, state };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  // SLA countdown chip — hidden once the wig is through operations.
  const slaChip = useMemo(() => {
    if (!job || JOB_TERMINAL.has(job.status)) return null;
    if (["cancelled", "rejected"].includes(job.status)) return null;
    const due = job.sla_due_at ?? job.expected_completion_at;
    if (!due) return null;
    const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
    if (days < 0)
      return { label: `Overdue ${-days}d`, tone: "danger" as const };
    if (days === 0) return { label: "Due today", tone: "warn" as const };
    return { label: `Due in ${days}d`, tone: "info" as const };
  }, [job]);

  // Comms log — merge invoice send + reminder rows into a single timeline.
  const commsEntries = useMemo(() => {
    const rows: Array<{
      key: string;
      when: string;
      channel: string;
      title: string;
      sub: string;
      tone: Tone;
    }> = [];
    if (invoice?.sent_at) {
      rows.push({
        key: `invoice-send-${invoice.invoice_id}`,
        when: invoice.sent_at,
        channel: invoice.sent_via ?? "email",
        title: `Invoice ${invoice.invoice_number} sent`,
        sub: invoice.first_viewed_at
          ? `Opened ${fmtDateTime(invoice.first_viewed_at)}`
          : "Awaiting open",
        tone: invoice.first_viewed_at ? "success" : "info",
      });
    }
    for (const r of reminders) {
      const when = r.sent_at ?? r.scheduled_for;
      const openedish = r.read_at || r.delivered_at;
      const label = r.reminder_type.replace(/_/g, " ");
      const status = r.sent_at
        ? openedish
          ? `Delivered ${fmtDateTime(openedish)}`
          : "Sent, awaiting delivery"
        : r.status === "failed"
          ? `Failed: ${r.failure_reason ?? "unknown"}`
          : `Scheduled ${fmtDateTime(r.scheduled_for)}`;
      rows.push({
        key: r.reminder_id,
        when,
        channel: r.channel,
        title: `Reminder — ${label} (${r.channel})`,
        sub: status,
        tone:
          r.status === "failed"
            ? "danger"
            : r.sent_at
              ? "success"
              : "info",
      });
    }
    return rows.sort(
      (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
    );
  }, [invoice, reminders]);

  return (
    <div className="space-y-5">
      {/* Sticky action bar — always visible on scroll, everything the user
          might want to do to the order lives here. */}
      <div className="sticky top-0 z-20 -mx-4 lg:-mx-6 px-4 lg:px-6 py-3 backdrop-blur-md bg-bg/80 border-b hairline">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={goBack}
          >
            Back
          </Button>
          <h1 className="font-display text-xl font-medium">
            {order?.order_number ?? (isLoading ? "…" : "Order")}
          </h1>
          {statusMeta && <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>}
          {order && Number(order.balance_due_ngn) > 0 && (
            <Pill tone="warn">
              Balance{" "}
              <MoneyText
                ngn={Number(order.balance_due_ngn)}
                className="ml-1"
              />
            </Pill>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {order && Number(order.balance_due_ngn) > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Link2 className="w-3.5 h-3.5" />}
                onClick={handlePayLink}
                disabled={createLink.isPending}
              >
                {createLink.isPending ? "…" : "Pay Link"}
              </Button>
            )}
            {invoice && !["void", "refunded"].includes(invoice.status) && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Send className="w-3.5 h-3.5" />}
                onClick={() => setShowInvoiceSend((v) => !v)}
              >
                {invoice.sent_at ? "Resend Invoice" : "Send Invoice"}
              </Button>
            )}
            {order?.status === "paid" && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Download className="w-3.5 h-3.5" />}
                onClick={handleReceipt}
                disabled={receiptLoading}
              >
                {receiptLoading ? "…" : "Receipt"}
              </Button>
            )}
            {(needsStudio || job) && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Scissors className="w-3.5 h-3.5" />}
                onClick={() =>
                  navigate(
                    job
                      ? `/service-jobs?tab=board&job=${job.job_id}`
                      : `/service-jobs?tab=board`,
                  )
                }
              >
                Studio
              </Button>
            )}
            {needsDelivery && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Truck className="w-3.5 h-3.5" />}
                onClick={() =>
                  navigate(
                    delivery
                      ? `/logistics?delivery=${delivery.delivery_id}`
                      : `/logistics`,
                  )
                }
              >
                Logistics
              </Button>
            )}
            {order &&
              order.status !== "cancelled" &&
              order.status !== "completed" && (
                <Button
                  variant="danger"
                  size="sm"
                  icon={<XCircle className="w-3.5 h-3.5" />}
                  onClick={() => setConfirmCancel(true)}
                >
                  Cancel
                </Button>
              )}
          </div>
        </div>
        {/* Inline invoice-send row — appears under the bar when armed. */}
        {showInvoiceSend && invoice && (
          <div className="flex items-center gap-2 pt-2">
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
        )}
      </div>

      {isLoading && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-xl bg-text-primary/[0.04] animate-pulse"
            />
          ))}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {order && (
        <>
          {/* Fulfilment strip. */}
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={paidTone}>
              {paidTone === "success" ? "Paid" : "Payment pending"}
            </Pill>
            {(needsStudio || job) && (
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

          {/* AI risk chip strip — one line, only when something's off. */}
          {risks.length > 0 && (
            <Card className="p-3 border border-warn/30 bg-warn/[0.05]">
              <div className="flex items-start gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-warn">
                  <Sparkles className="w-3.5 h-3.5" />
                  Attention
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {risks.map((r) => (
                    <span
                      key={r.key}
                      className="inline-flex items-center gap-1"
                    >
                      <Pill tone={r.tone}>
                        <AlertTriangle className="w-3 h-3 inline mr-1" />
                        {r.label}
                      </Pill>
                      {r.action && (
                        <button
                          type="button"
                          onClick={() => navigate(r.action!.to)}
                          className="text-[11px] text-accent hover:underline"
                        >
                          {r.action.label} →
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Invoice ribbon (kept for the header info + delivery state chip). */}
          {invoice && (
            <div className="p-3 rounded-[11px] bg-success/[0.06] border border-success/20">
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
                          opened{" "}
                          {new Date(
                            invoice.first_viewed_at,
                          ).toLocaleDateString()}
                        </span>
                      ) : invoice.sent_at ? (
                        <span className="ml-1 normal-case">
                          · sent{" "}
                          {new Date(invoice.sent_at).toLocaleDateString()}
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
            </div>
          )}

          {/* Two-column body on wide screens. Everything stacks on mobile. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left column — items, payments, studio, delivery, timeline */}
            <div className="lg:col-span-2 space-y-4">
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

              {/* Items */}
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
                          {(l.line_kind === "styled" ||
                            l.line_kind === "service") && (
                            <Pill tone="accent">
                              <Scissors className="w-3 h-3 inline mr-1" />
                              {l.line_kind}
                            </Pill>
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
                          −
                          <MoneyText ngn={Number(order.discount_amount_ngn)} />
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
                            <span className="text-text-muted">
                              Exchange rate
                            </span>
                            <span className="tabular-nums">
                              ₦
                              {Number(order.fx_rate_used).toLocaleString()} / $1
                            </span>
                          </div>
                          <div className="flex justify-between text-[14px] font-semibold">
                            <span>Charged in {order.display_currency}</span>
                            <span className="tabular-nums">
                              $
                              {Number(order.display_total ?? 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      )}
                  </div>
                </Card>
              )}

              {/* Payments */}
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

              {/* Stylist Studio — operations stage tracker. Shown whenever a
                  job exists (even if the order's lines predate line_kind
                  stamping) or the order clearly needs styling. */}
              {(needsStudio || job) && (
                <Card className="p-4 border border-accent/20">
                  <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <div className="micro flex items-center gap-1.5">
                      <Scissors className="w-3.5 h-3.5" />
                      Stylist Studio
                      {job && (
                        <span className="font-mono text-[11px] text-text-muted normal-case">
                          {job.job_number}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {job && slaChip && (
                        <Pill tone={slaChip.tone}>{slaChip.label}</Pill>
                      )}
                      {job && (job.rework_count ?? 0) > 0 && (
                        <Pill tone="warn">Rework ×{job.rework_count}</Pill>
                      )}
                      {job && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<ExternalLink className="w-3.5 h-3.5" />}
                          onClick={() =>
                            navigate(`/service-jobs?tab=board&job=${job.job_id}`)
                          }
                        >
                          Open Job {job.job_number}
                        </Button>
                      )}
                    </div>
                  </div>

                  {job ? (
                    ["cancelled", "rejected"].includes(job.status) ? (
                      <div className="mt-3 p-3 rounded-[10px] bg-danger/[0.07] border border-danger/25 text-[13px] text-danger">
                        This styling job was {job.status}. Open it in Studio to
                        see why or raise a fresh one.
                      </div>
                    ) : (
                      <>
                        {/* Stage rail — the wig's journey through operations.
                            Done stages fill in with their timestamp; the live
                            stage pulses; the rest wait dim. */}
                        <div className="mt-4 overflow-x-auto pb-1">
                          <div className="flex items-start min-w-[560px]">
                            {studioStages.map((s, i) => (
                              <div
                                key={s.key}
                                className="flex-1 flex flex-col items-center relative"
                              >
                                {/* connector line to the previous stage */}
                                {i > 0 && (
                                  <div
                                    className={`absolute top-[9px] right-1/2 w-full h-[2px] ${
                                      s.state !== "todo"
                                        ? "bg-accent/70"
                                        : "bg-line"
                                    }`}
                                  />
                                )}
                                <div
                                  className={`relative z-10 w-[18px] h-[18px] rounded-full border-2 grid place-items-center ${
                                    s.state === "done"
                                      ? "bg-accent border-accent"
                                      : s.state === "active"
                                        ? "bg-bg border-accent animate-pulse"
                                        : "bg-bg border-line"
                                  }`}
                                >
                                  {s.state === "done" && (
                                    <span className="text-[10px] leading-none text-white">
                                      ✓
                                    </span>
                                  )}
                                  {s.state === "active" && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                                  )}
                                </div>
                                <div
                                  className={`mt-1.5 text-[11px] font-semibold text-center px-1 ${
                                    s.state === "todo"
                                      ? "text-text-faint"
                                      : s.warn
                                        ? "text-warn"
                                        : "text-text-primary"
                                  }`}
                                >
                                  {s.label}
                                </div>
                                <div className="text-[10px] text-text-faint text-center px-1">
                                  {s.when ? fmtDate(s.when) : s.sub ?? ""}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Who / what / how much */}
                        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <div className="micro">Stylist</div>
                            <div className="text-[13px] mt-1 font-semibold">
                              {job.assigned_staff_name ??
                                (job.assigned_staff_user_id
                                  ? job.assigned_staff_user_id.slice(0, 8)
                                  : null) ?? (
                                  <span className="text-warn">Unassigned</span>
                                )}
                            </div>
                            {job.assigned_at && (
                              <div className="text-[10px] text-text-faint">
                                since {fmtDate(job.assigned_at)}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="micro">Piece</div>
                            <div className="text-[13px] mt-1 truncate">
                              {job.hair_description ?? "—"}
                            </div>
                          </div>
                          <div>
                            <div className="micro">Quality</div>
                            <div className="text-[13px] mt-1">
                              {job.quality_rating ? (
                                <span className="font-mono">
                                  {"★".repeat(job.quality_rating)}
                                  {"☆".repeat(5 - job.quality_rating)}
                                </span>
                              ) : (
                                "Not rated"
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="micro">Styling cost</div>
                            <div className="text-[13px] mt-1">
                              {job.agreed_cost_ngn ? (
                                <MoneyText ngn={Number(job.agreed_cost_ngn)} />
                              ) : (
                                "—"
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    )
                  ) : (
                    <div className="mt-3 text-[13px] text-text-faint">
                      No Studio job yet. It opens automatically once the deposit
                      or full payment clears — refresh in a moment, or open the{" "}
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => navigate("/service-jobs?tab=board")}
                      >
                        Job Board
                      </button>{" "}
                      to raise one by hand.
                    </div>
                  )}
                </Card>
              )}

              {/* Delivery card */}
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
                          navigate(
                            `/logistics?delivery=${delivery.delivery_id}`,
                          )
                        }
                      >
                        Open in Logistics
                      </Button>
                    )}
                  </div>
                  {delivery ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[13px] flex-wrap">
                        <span className="font-semibold">
                          {delivery.delivery_number}
                        </span>
                        {deliveryMeta && (
                          <Pill tone={deliveryMeta.tone}>
                            {deliveryMeta.label}
                          </Pill>
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

              {/* Timeline (raw event stream — the append-only truth) */}
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
            </div>

            {/* Right column — comms log, attachments, customer history */}
            <div className="space-y-4">
              {/* Comms log */}
              <Card className="p-4">
                <div className="micro flex items-center gap-1.5 mb-3">
                  <Bell className="w-3.5 h-3.5" />
                  Comms Log
                </div>
                {commsEntries.length === 0 ? (
                  <div className="text-[12px] text-text-faint">
                    No customer messages yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {commsEntries.map((e) => (
                      <div
                        key={e.key}
                        className="flex gap-2 text-[12px] p-2 rounded-lg bg-text-primary/[0.02]"
                      >
                        <div className="mt-0.5 text-text-muted">
                          {channelIcon(e.channel)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold truncate">
                              {e.title}
                            </span>
                            <Pill tone={e.tone}>{e.channel}</Pill>
                          </div>
                          <div className="text-text-faint">{e.sub}</div>
                          <div className="text-text-faint text-[10px]">
                            {new Date(e.when).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Attachments */}
              {(imageRefs.length > 0 || otherRefs.length > 0) && (
                <Card className="p-4">
                  <div className="micro flex items-center gap-1.5 mb-3">
                    <Paperclip className="w-3.5 h-3.5" />
                    Attachments
                  </div>
                  {imageRefs.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {imageRefs.map((r) => (
                        <a
                          key={r.reference_id}
                          href={r.url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="block aspect-square rounded-lg overflow-hidden bg-text-primary/[0.04] hover:opacity-90"
                        >
                          {r.url ? (
                            <img
                              src={r.url}
                              alt={r.body ?? "Style brief"}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full grid place-items-center text-text-faint text-[11px]">
                              image
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                  {otherRefs.length > 0 && (
                    <div className="space-y-1.5">
                      {otherRefs.map((r) => (
                        <a
                          key={r.reference_id}
                          href={r.url ?? "#"}
                          target={r.url ? "_blank" : undefined}
                          rel="noreferrer"
                          className="flex items-center gap-2 text-[12px] p-2 rounded-lg bg-text-primary/[0.02] hover:bg-text-primary/[0.04]"
                        >
                          <Paperclip className="w-3.5 h-3.5 text-text-faint" />
                          <span className="truncate">
                            {r.body ?? r.ref_type.replace(/_/g, " ")}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* Customer history */}
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
                            navigate(`/sales/orders/${o.order_id}`)
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
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={handleCancel}
        title="Cancel Order"
        message="Are you sure you want to cancel this order? This action cannot be undone."
        confirmLabel="Cancel Order"
        busy={cancelOrder.isPending}
      />
    </div>
  );
}
