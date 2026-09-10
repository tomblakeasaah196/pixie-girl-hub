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
  CreditCard,
  Clock,
  UserCheck,
  ShieldAlert,
  PencilLine,
  History,
  RotateCcw,
} from "lucide-react";
import { Card, Pill, MoneyText, Button } from "@/components/ui/primitives";
import {
  ErrorState,
  ConfirmDialog,
  Select,
  NumberField,
} from "@/components/ui/controls";
import { FormGrid, Field, TextInput } from "@/components/ui/Form";
import { ApplyCouponPanel } from "./ApplyCouponPanel";
import { useAuthStore } from "@/stores/auth";
import {
  useOrder,
  useOrderTimeline,
  useCreatePaymentLink,
  useAddPayment,
  usePaymentSettings,
  useCancelOrder,
  useRestoreOrder,
  useSetOrderStatus,
  useOrderInvoice,
  useSendOrderInvoice,
  useOrderServiceJob,
  useOrderDelivery,
  useContactRecentOrders,
  useInvoiceReminders,
  useStatusAutomations,
  useOrderAmendments,
} from "./hooks";
import { generateReceipt } from "./api";
import type { OrderServiceJob, RestoreShortLine } from "./api";
import { ChangeOrderModal } from "./ChangeOrderModal";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { toastReport } from "@/lib/error-report";
import { saveFileFromUrl } from "@/lib/api";
import { formatDate, formatDateTime, money } from "@/lib/format";
import {
  ORDER_STATUS,
  MANUAL_MOVE_STATUSES,
  statusMoveImpact,
  messagingChannelLabel,
  SALES_CHANNELS,
  fulfilmentLabel,
  orderPaymentMeta,
  cancellationReasonLabel,
  MANUAL_CANCELLATION_REASONS,
} from "./constants";
import type { OrderPayment, OrderStatus, SalesOrder } from "./types";
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

const fmtDate = (iso?: string | null) => (iso ? formatDate(iso) : null);
const fmtDateTime = (iso?: string | null) => (iso ? formatDateTime(iso) : null);
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
  job: OrderServiceJob | null;
  delivery: ReturnType<typeof useOrderDelivery>["data"];
  invoice: ReturnType<typeof useOrderInvoice>["data"];
  needsStudio: boolean;
  needsDelivery: boolean;
}): RiskSignal[] {
  const { order, job, delivery, invoice, needsStudio, needsDelivery } = args;
  if (!order) return [];
  const now = Date.now();
  const risks: RiskSignal[] = [];
  const paidStates = new Set([
    "paid",
    "assigned",
    "order_ready",
    "dispatched",
    "completed",
  ]);
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
          to:
            `/service-jobs?tab=board&job=${job.job_id}` +
            `&fromOrder=${order.order_id}` +
            `&fromOrderNo=${encodeURIComponent(order.order_number)}`,
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
  const { data: studio } = useOrderServiceJob(orderId);
  const job = studio?.job ?? null;
  // Studio progress across ALL the order's hairs. A three-product order opens
  // three jobs and stays unready until the last one lands.
  const studioProgress = studio?.progress ?? null;
  const { data: delivery } = useOrderDelivery(orderId);
  const { data: references = [] } = useJobReferences(job?.job_id ?? null);
  const { data: contactHistory } = useContactRecentOrders(
    order?.contact_id ?? null,
    orderId,
  );
  const sendInvoice = useSendOrderInvoice(orderId);
  const cancelOrder = useCancelOrder();
  const restoreOrder = useRestoreOrder();
  const setStatus = useSetOrderStatus();
  // Live on/off state of the stage messages, for the status-move impact modal.
  const { data: statusAutomations, isLoading: automationsLoading } =
    useStatusAutomations(!!orderId);
  const { data: paymentSettings } = usePaymentSettings();
  const { data: amendments = [] } = useOrderAmendments(orderId);

  const [confirmCancel, setConfirmCancel] = useState(false);
  // Why this order is being cancelled. Staff pick a preset (or "other" and
  // type); an order that can't say why it died is what sent everyone digging
  // through the stock ledger, so the dialog won't commit without one.
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonText, setCancelReasonText] = useState("");
  // Reinstate (un-cancel) — two-phase, like the archive drawer: the first call
  // dry-runs and reports lines that can no longer be re-held from stock.
  const [reinstateShort, setReinstateShort] = useState<{
    lines: RestoreShortLine[];
    message: string;
  } | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [showInvoiceSend, setShowInvoiceSend] = useState(false);
  const [invoiceSentVia, setInvoiceSentVia] = useState("email");
  const [payLinkOpen, setPayLinkOpen] = useState(false);

  // Inline payment acceptance — staff record the money right here on the order
  // instead of hopping to the invoice. The recorder + timestamp are stamped
  // server-side and stay on the ledger below for good. Recording here also
  // settles the order's invoice in the same commit, so both screens agree.
  const canEditSales = useAuthStore((s) => s.can)("sales", "edit");
  const manualAllowed =
    paymentSettings?.allow_staff_recorded_manual_payments === true;
  const addPayment = useAddPayment(orderId ?? "");
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payBankRef, setPayBankRef] = useState("");
  const [payBankName, setPayBankName] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payError, setPayError] = useState<string | null>(null);

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

  // Record money the customer has already sent. Only the staff-recorded bank
  // transfer path is open to manual entry (gateway payments arrive by webhook),
  // so the bank's transaction reference is mandatory — it's what Accounting
  // reconciles against the bank-statement import.
  const handleRecordPayment = async () => {
    if (!orderId || !order) return;
    setPayError(null);
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError("Enter the amount received.");
      return;
    }
    if (!payBankRef.trim() || !payBankName.trim()) {
      setPayError("The bank reference and bank name are both required.");
      return;
    }
    try {
      await addPayment.mutateAsync({
        method: "bank_transfer",
        amount_ngn: amount,
        provider: "manual",
        payment_path: "staff_recorded",
        manual_bank_transaction_id: payBankRef.trim(),
        manual_bank_name: payBankName.trim(),
        notes: payNotes.trim() || undefined,
        client_idempotency_key: `manual:${orderId}:${payBankRef.trim()}`,
      });
      setShowPayForm(false);
      setPayAmount("");
      setPayBankRef("");
      setPayBankName("");
      setPayNotes("");
      fireToast(
        "Payment Recorded",
        `${money(amount)} accepted on ${order.order_number} — logged under your name, and the invoice is updated too.`,
        "payment",
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't record the payment.";
      setPayError(msg);
      fireToast("Payment Not Recorded", msg, "payment", "high");
    }
  };

  // The dropdown only arms the move; the actual write happens after the
  // impact-confirmation modal below.
  const handleConfirmMove = async () => {
    const status = pendingStatus;
    if (!orderId || !status) return;
    try {
      await setStatus.mutateAsync({ id: orderId, status });
      const label =
        ORDER_STATUS[status as keyof typeof ORDER_STATUS]?.label ?? status;
      fireToast("Status Updated", `Order moved to ${label}.`);
    } catch {
      fireToast(
        "Update Failed",
        "Couldn't move this order's status — is it paid yet?",
        "order",
        "high",
      );
    } finally {
      setPendingStatus(null);
    }
  };

  // The reason actually sent: the preset code, or what they typed under Other.
  const resolvedCancelReason =
    cancelReason === "other" ? cancelReasonText.trim() : cancelReason;

  const handleCancel = async () => {
    if (!orderId || !resolvedCancelReason) return;
    try {
      await cancelOrder.mutateAsync({
        id: orderId,
        reason: resolvedCancelReason,
      });
      setConfirmCancel(false);
      setCancelReason("");
      setCancelReasonText("");
      fireToast("Order Cancelled", "The order has been cancelled.");
      goBack();
    } catch {
      fireToast("Cancel Failed", "Failed to cancel order.", "order", "high");
    }
  };

  // Un-cancel. `confirm` is the operator's explicit yes after the dry run
  // reported lines that can't be re-held — those come back as pre-orders.
  const handleReinstate = async (confirm: boolean) => {
    if (!orderId) return;
    try {
      const res = await restoreOrder.mutateAsync({ id: orderId, confirm });
      if (res.requires_confirmation) {
        setReinstateShort({
          lines: res.short_lines ?? [],
          message: res.message ?? "Some items are no longer in stock.",
        });
        return;
      }
      setReinstateShort(null);
      fireToast(
        "Order reinstated",
        res.preorder_line_count
          ? `Back as ${res.restored_to?.replace(/_/g, " ")} — ${res.preorder_line_count} item${res.preorder_line_count === 1 ? "" : "s"} as pre-order.`
          : `Back as ${res.restored_to?.replace(/_/g, " ")}.`,
      );
    } catch (err) {
      setReinstateShort(null);
      fireToast(
        "Couldn't reinstate",
        err instanceof Error ? err.message : "Please try again.",
        "order",
        "high",
      );
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
  // An order can be repaired right up until the job is marked completed (owner
  // rule). Cancelled/refunded/failed orders are closed, and an order with a
  // cancellation awaiting a decision has money under review — the backend
  // refuses all four, so the button simply isn't offered for them.
  const canAmend =
    !!order &&
    ![
      "completed",
      "cancelled",
      "refunded",
      "failed",
      "cancellation_requested",
    ].includes(order.status);
  const needsStudio = !!order?.lines?.some(
    (l) => l.line_kind === "styled" || l.line_kind === "service",
  );
  const needsDelivery = order?.order_type === "dispatch";
  // Deep-links into Stylist Studio carry a return reference so Studio can show a
  // "Back to order" button that lands back on THIS detail page. (Studio's own
  // floating Back pill only goes to the Command Center, so without this the user
  // has no way back to the order they came from.)
  const studioFrom =
    `&fromOrder=${orderId ?? ""}` +
    (order?.order_number
      ? `&fromOrderNo=${encodeURIComponent(order.order_number)}`
      : "");
  const jobMeta = job ? JOB_STATUS[job.status] : null;
  const jobDone = job ? JOB_TERMINAL.has(job.status) : false;
  const deliveryMeta = delivery ? DELIVERY_STATUS[delivery.status] : null;
  const deliveryDone = delivery
    ? DELIVERY_TERMINAL.has(delivery.status)
    : false;
  // Payment state comes from the money (total / paid / balance), never from
  // `order.status` — that column stops tracking payment the moment fulfilment
  // starts, so reading it here labelled partially-paid, cancelled and refunded
  // orders alike as "Paid". See orderPaymentMeta.
  const payMeta = orderPaymentMeta(order);
  const invoiceDelivery = invoice
    ? invoice.first_viewed_at
      ? { label: "Opened", tone: "success" as const }
      : invoice.sent_at
        ? { label: "Sent", tone: "info" as const }
        : { label: "Not sent", tone: "neutral" as const }
    : null;
  const statusMeta = order ? ORDER_STATUS[order.status] : null;
  const balanceDue = Number(order?.balance_due_ngn ?? 0);
  const historyLtv = (contactHistory?.orders ?? []).reduce(
    (sum, o) => sum + Number(o.total_ngn || 0),
    0,
  );

  // Pre-order (000086): production window label from the order's snapshot.
  const preorderWindow = (() => {
    if (!order?.is_preorder) return null;
    const min = order.preorder_min_weeks ?? null;
    const max = order.preorder_max_weeks ?? null;
    if (min && max && min !== max) return `${min}–${max} weeks`;
    const w = max || min;
    return w ? `${w} week${w === 1 ? "" : "s"}` : null;
  })();

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
    const terminal =
      job.status === "handed_to_sales" || job.status === "completed";
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
        tone: r.status === "failed" ? "danger" : r.sent_at ? "success" : "info",
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
              <MoneyText ngn={Number(order.balance_due_ngn)} className="ml-1" />
            </Pill>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {/* Accepting money is the primary action on an unpaid order, so it
                leads the bar. It arms the form down in the Payments card —
                one place money is ever entered. */}
            {order &&
              Number(order.balance_due_ngn) > 0 &&
              canEditSales &&
              manualAllowed && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<CreditCard className="w-3.5 h-3.5" />}
                  onClick={() => {
                    setPayError(null);
                    setPayAmount(String(order.balance_due_ngn));
                    setShowPayForm(true);
                    document
                      .getElementById("order-payments")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  Record Payment
                </Button>
              )}
            {order && Number(order.balance_due_ngn) > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Link2 className="w-3.5 h-3.5" />}
                onClick={() => setPayLinkOpen(true)}
              >
                Pay Link
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
                      ? `/service-jobs?tab=board&job=${job.job_id}${studioFrom}`
                      : `/service-jobs?tab=board${studioFrom}`,
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
            {/* Manual fulfilment-stage move — staff can nudge a paid order
                forward themselves (e.g. mark a walk-in Completed). Payment +
                cancel states are automatic, so they're not offered here. */}
            {order &&
              [
                "partially_paid",
                "paid",
                "assigned",
                "order_ready",
                "dispatched",
              ].includes(order.status) && (
                <Select
                  value=""
                  onChange={(v) => v && setPendingStatus(v)}
                  disabled={setStatus.isPending}
                  className="w-[150px]"
                  options={[
                    { value: "", label: "Move to…" },
                    ...MANUAL_MOVE_STATUSES.map((s) => ({
                      value: s,
                      label: ORDER_STATUS[s].label,
                    })),
                  ]}
                />
              )}
            {/* Change Order — the repair path for an order recorded against
                the wrong product. Available right up until the job is marked
                completed (owner rule); the backend refuses beyond that, and
                warns about anything consequential before it commits. */}
            {order && canAmend && canEditSales && (
              <Button
                variant="secondary"
                size="sm"
                icon={<PencilLine className="w-3.5 h-3.5" />}
                onClick={() => setChangeOpen(true)}
              >
                Change Order
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
            {/* Reinstate — un-cancel from the order itself, rather than making
                staff find it again in the Archive drawer. Same two-phase
                restore the archive uses: it re-holds the stock the cancel
                released and puts the order back where it was. An order whose
                deposit was forfeited is refused by the API. */}
            {order && order.status === "cancelled" && canEditSales && (
              <Button
                variant="primary"
                size="sm"
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                onClick={() => handleReinstate(false)}
                disabled={restoreOrder.isPending}
              >
                {restoreOrder.isPending ? "Reinstating…" : "Reinstate"}
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
            <Pill tone={payMeta.tone}>{payMeta.label}</Pill>
            {order.payment_plan === "instalment" && (
              <Pill tone="accent">
                <CreditCard className="w-3 h-3 inline mr-1" />
                {paymentSettings?.plan_display_name || "Flexi Pay"}
              </Pill>
            )}
            {order.is_preorder && (
              <Pill tone="accent">
                <Clock className="w-3 h-3 inline mr-1" />
                Pre-order
              </Pill>
            )}
            {amendments.length > 0 && (
              <Pill tone="info">
                <History className="w-3 h-3 inline mr-1" />
                Changed ×{amendments.length}
              </Pill>
            )}
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

          {/* Why this order is cancelled. The auto-cancel sweeps (abandoned
              checkout, layaway abandonment, duplicate resolver) record a
              reason; a manual cancel records only the date. Without this the
              order simply reads CANCELLED and no screen can say what happened. */}
          {order.status === "cancelled" && (
            <div className="flex items-start gap-2 p-3 rounded-[11px] bg-danger/[0.06] border border-danger/20">
              <XCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="text-[12.5px]">
                <span className="font-semibold">Cancelled</span>
                {order.cancelled_at
                  ? ` on ${formatDateTime(order.cancelled_at)}`
                  : ""}
                {cancellationReasonLabel(order.cancellation_reason) ? (
                  <span className="text-text-muted">
                    {" — "}
                    {cancellationReasonLabel(order.cancellation_reason)}.
                  </span>
                ) : (
                  <span className="text-text-muted">
                    {" — no reason recorded (cancelled by hand)."}
                  </span>
                )}
              </div>
            </div>
          )}

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

          {/* Pre-order deadline + production window (000086). The order
              carries a made-to-order line; ship-by is placement + the max
              production weeks, snapshotted at checkout. */}
          {order.is_preorder && (
            <div className="flex items-start gap-2 p-3 rounded-[11px] bg-accent/[0.06] border border-accent/20">
              <Clock className="w-4 h-4 text-accent-glow shrink-0 mt-0.5" />
              <div className="text-[12.5px]">
                <span className="font-semibold">Pre-order</span>
                {" — made to order."}
                {preorderWindow ? ` Ships in about ${preorderWindow}.` : ""}
                {order.preorder_ready_by ? (
                  <span className="text-text-muted">
                    {" "}
                    Ready by {formatDate(order.preorder_ready_by)}.
                  </span>
                ) : null}
              </div>
            </div>
          )}

          {/* Invoice ribbon (kept for the header info + delivery state chip). */}
          {invoice && (
            <div className="p-3 rounded-[11px] bg-success/[0.06] border border-success/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-success shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold flex items-center gap-2">
                      {/* The number itself is the link — the same shape the
                          invoice uses to point back at this order. */}
                      <button
                        type="button"
                        className="hover:text-accent hover:underline"
                        onClick={() =>
                          navigate(
                            `/invoicing?tab=invoices&invoice=${invoice.invoice_id}`,
                          )
                        }
                      >
                        Invoice {invoice.invoice_number}
                      </button>
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
                          opened {formatDate(invoice.first_viewed_at)}
                        </span>
                      ) : invoice.sent_at ? (
                        <span className="ml-1 normal-case">
                          · sent {formatDate(invoice.sent_at)}
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
                      {formatDateTime(order.created_at)}
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
                      {order.display_currency &&
                      order.display_currency !== "NGN"
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
                              ₦{Number(order.fx_rate_used).toLocaleString()} /
                              $1
                            </span>
                          </div>
                          <div className="flex justify-between text-[14px] font-semibold">
                            <span>Charged in {order.display_currency}</span>
                            <span className="tabular-nums">
                              $
                              {Number(
                                order.display_total ?? 0,
                              ).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      )}
                  </div>
                </Card>
              )}

              {/* Change history — every amendment, what moved, and what it did
                  downstream. Sits directly under Items because the first
                  question anyone asks about a changed order is "changed from
                  what, and by whom?". */}
              {amendments.length > 0 && (
                <Card className="p-4">
                  <div className="micro mb-3 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    Change history
                  </div>
                  <div className="space-y-3">
                    {amendments.map((a) => {
                      const diff = Number(a.difference_ngn);
                      const who =
                        a.amended_by_display_name || a.amended_by_name || "System";
                      const eff = a.effects ?? {};
                      const notes: string[] = [];
                      if (eff.gl?.posted) notes.push("Books adjusted");
                      if (eff.invoice?.invoice_number)
                        notes.push(`Invoice ${eff.invoice.invoice_number} revised`);
                      if (eff.stock?.returned?.length)
                        notes.push(
                          `${eff.stock.returned.reduce((s, r) => s + r.quantity, 0)} back to stock`,
                        );
                      if (eff.stock?.preorder?.length)
                        notes.push("Some items on pre-order");
                      if (eff.studio?.cancelled_job_ids?.length)
                        notes.push(
                          `${eff.studio.cancelled_job_ids.length} studio job(s) cancelled`,
                        );
                      if (eff.logistics?.resynced) notes.push("Delivery updated");
                      if (a.customer_notified) notes.push("Customer notified");
                      return (
                        <div
                          key={a.amendment_id}
                          className="rounded-[11px] border border-line bg-text-primary/[0.02] p-3"
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                            <div className="text-[13px] font-semibold">
                              Change #{a.amendment_number}
                            </div>
                            <div className="flex items-center gap-2">
                              {diff !== 0 && (
                                <Pill tone={diff > 0 ? "warn" : "success"}>
                                  {diff > 0 ? "+" : "−"}
                                  {money(Math.abs(diff))}
                                </Pill>
                              )}
                              <span className="text-[11px] text-text-faint">
                                {formatDateTime(a.created_at)} · {who}
                              </span>
                            </div>
                          </div>
                          <ul className="space-y-1 text-[12.5px]">
                            {a.line_changes.map((c, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <Pill
                                  tone={
                                    c.action === "added"
                                      ? "success"
                                      : c.action === "removed"
                                        ? "danger"
                                        : "info"
                                  }
                                >
                                  {c.action}
                                </Pill>
                                <span className="min-w-0">
                                  {c.name}
                                  {c.action === "quantity" && (
                                    <span className="text-text-muted">
                                      {" "}
                                      ({c.from} → {c.to})
                                    </span>
                                  )}
                                  {c.action === "price" && (
                                    <span className="text-text-muted">
                                      {" "}
                                      ({money(c.from ?? 0)} → {money(c.to ?? 0)})
                                    </span>
                                  )}
                                </span>
                              </li>
                            ))}
                            {a.delivery_after && (
                              <li className="flex items-start gap-2">
                                <Pill tone="info">delivery</Pill>
                                <span>Delivery details updated.</span>
                              </li>
                            )}
                          </ul>
                          <div className="mt-2 text-[12px] text-text-muted">
                            <span className="text-text-faint">Total </span>
                            {money(Number(a.total_before_ngn))} →{" "}
                            <span className="font-semibold text-text-primary">
                              {money(Number(a.total_after_ngn))}
                            </span>
                          </div>
                          <div className="mt-1 text-[12px] italic text-text-muted">
                            &ldquo;{a.reason}&rdquo;
                          </div>
                          {notes.length > 0 && (
                            <div className="mt-2 text-[11px] text-text-faint">
                              {notes.join(" · ")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* Payments — the money card. Always present (unless the order
                  was cancelled) so an unpaid order shows the balance and the
                  way to accept money, instead of the card vanishing and
                  leaving staff hunting. Every row is a permanent acceptance
                  record: who took the money and the moment they did. */}
              {order.status !== "cancelled" && (
                <div id="order-payments">
                  <Card className="p-4">
                    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                      <div className="micro flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5" />
                        Payments
                      </div>
                      {balanceDue > 0 && canEditSales && manualAllowed && (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<CreditCard className="w-3.5 h-3.5" />}
                          onClick={() => {
                            setPayError(null);
                            setPayAmount(String(order.balance_due_ngn));
                            setShowPayForm((v) => !v);
                          }}
                        >
                          Record Payment
                        </Button>
                      )}
                    </div>

                    {/* Balance summary — paid against total, always visible. */}
                    <div
                      className={`flex items-center justify-between gap-3 p-3 rounded-[11px] mb-3 ${
                        balanceDue > 0
                          ? "bg-warn/[0.08] border border-warn/20"
                          : "bg-success/[0.06] border border-success/20"
                      }`}
                    >
                      <div>
                        <div
                          className={`text-[11px] uppercase font-bold tracking-wide ${
                            balanceDue > 0 ? "text-warn" : "text-success"
                          }`}
                        >
                          {balanceDue > 0 ? "Balance Due" : "Settled in full"}
                        </div>
                        <MoneyText
                          ngn={
                            balanceDue > 0
                              ? balanceDue
                              : Number(order.total_ngn)
                          }
                          className={`text-[22px] ${
                            balanceDue > 0 ? "text-warn" : "text-success"
                          }`}
                        />
                      </div>
                      <div className="text-[11px] text-text-muted text-right">
                        Paid {money(Number(order.amount_paid_ngn))} of{" "}
                        {money(Number(order.total_ngn))}
                      </div>
                    </div>

                    {/* Discount code — sits with Record Payment because
                      that is where the missed discount surfaces: she is
                      settling up and mentions the voucher nobody applied.
                      Capped at the balance, so it can close the order but
                      never push it into credit. */}
                    {canEditSales && (
                      <ApplyCouponPanel
                        orderId={orderId!}
                        appliedCode={order.coupon_code}
                        disabled={balanceDue <= 0}
                        onApplied={(res) =>
                          fireToast(
                            "Discount Applied",
                            `${res.quote.coupon_code} took ${money(
                              Number(res.quote.discount_ngn),
                            )} off ${order.order_number}${
                              res.quote.settles_order
                                ? " — that clears the balance, so the order is settled."
                                : `. ${money(
                                    Number(res.quote.balance_after_ngn),
                                  )} still due.`
                            }`,
                            "payment",
                          )
                        }
                        onError={(msg) =>
                          fireToast("Discount Not Applied", msg, "payment", "high")
                        }
                      />
                    )}

                    {/* Record payment — inline, so accepting money never means
                      opening the invoice. Who recorded it and when is stamped
                      server-side and shown permanently in the ledger below. */}
                    {showPayForm && balanceDue > 0 && (
                      <div className="p-3 rounded-[11px] border border-line bg-text-primary/[0.02] mb-3">
                        <div className="micro mb-3">Record Payment</div>
                        <FormGrid>
                          <Field
                            label="Amount received (NGN)"
                            hint={`balance ${money(balanceDue)}`}
                          >
                            <NumberField
                              value={payAmount}
                              onChange={setPayAmount}
                              placeholder="0.00"
                              suffix="NGN"
                            />
                          </Field>
                          <Field label="Bank transaction reference">
                            <TextInput
                              value={payBankRef}
                              onChange={(e) => setPayBankRef(e.target.value)}
                              placeholder="e.g. GTB/2026/00123"
                            />
                          </Field>
                          <Field label="Bank name">
                            <TextInput
                              value={payBankName}
                              onChange={(e) => setPayBankName(e.target.value)}
                              placeholder="e.g. GTBank"
                            />
                          </Field>
                          <Field label="Notes" hint="optional">
                            <TextInput
                              value={payNotes}
                              onChange={(e) => setPayNotes(e.target.value)}
                              placeholder="Payment note"
                            />
                          </Field>
                        </FormGrid>
                        {payError && (
                          <p className="text-[12px] text-danger mt-3">
                            {payError}
                          </p>
                        )}
                        <div className="flex items-start gap-1.5 text-[11px] text-text-faint mt-3">
                          <UserCheck className="w-3.5 h-3.5 mt-[1px] shrink-0" />
                          Recorded under your name with the time you accepted
                          it, reconciled against the bank-statement import, and
                          applied to
                          {invoice
                            ? ` invoice ${invoice.invoice_number}`
                            : " this order's invoice"}{" "}
                          at the same moment.
                        </div>
                        <div className="flex gap-2 mt-4">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleRecordPayment}
                            disabled={addPayment.isPending || !payAmount}
                          >
                            {addPayment.isPending ? "Saving…" : "Save Payment"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowPayForm(false);
                              setPayError(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Manual entry is a business-level switch — say so plainly
                      rather than silently hiding the button and leaving staff
                      hunting for it. */}
                    {balanceDue > 0 && canEditSales && !manualAllowed && (
                      <div className="flex items-start gap-2 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line text-[12px] text-text-muted mb-3">
                        <ShieldAlert className="w-3.5 h-3.5 mt-[1px] shrink-0 text-warn" />
                        <span>
                          Recording a payment by hand is switched off for this
                          business — payments must arrive through a gateway. A
                          manager can turn it on under{" "}
                          <button
                            type="button"
                            className="text-accent hover:underline"
                            onClick={() => navigate("/sales?tab=payments")}
                          >
                            Sales → Payments
                          </button>
                          . You can still send a pay link.
                        </span>
                      </div>
                    )}

                    {order.payments && order.payments.length > 0 ? (
                      <div className="space-y-2">
                        {order.payments.map((p: OrderPayment) => (
                          <div
                            key={p.payment_id}
                            className="text-[13px] p-2.5 rounded-lg bg-text-primary/[0.02]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold flex items-center gap-2 flex-wrap">
                                  {p.payment_number}
                                  {p.payment_path === "staff_recorded" && (
                                    <Pill tone="info">Staff recorded</Pill>
                                  )}
                                </div>
                                <div className="text-[11px] text-text-faint capitalize">
                                  {p.method.replace(/_/g, " ")}
                                  {p.manual_bank_name
                                    ? ` · ${p.manual_bank_name}`
                                    : ""}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <MoneyText ngn={Number(p.amount_ngn)} />
                                <div className="text-[10px] text-text-faint">
                                  {formatDate(p.captured_at)}
                                </div>
                              </div>
                            </div>
                            <div className="mt-1.5 pt-1.5 border-t border-line/60 text-[11px] text-text-muted flex items-start gap-1.5">
                              <UserCheck className="w-3 h-3 mt-[2px] shrink-0 text-text-faint" />
                              <span>
                                {p.recorded_by_name ? (
                                  <>
                                    {/* A gateway took the money but a person
                                        tied it to this order (POS
                                        reconciliation) — say "matched", not
                                        "accepted". */}
                                    {p.payment_path === "staff_recorded"
                                      ? "Accepted by "
                                      : "Matched to this order by "}
                                    <span className="font-semibold text-text-primary">
                                      {p.recorded_by_name}
                                    </span>
                                  </>
                                ) : (
                                  "Captured automatically by the payment gateway"
                                )}{" "}
                                ·{" "}
                                {formatDateTime(p.recorded_at ?? p.captured_at)}
                                {p.manual_bank_transaction_id && (
                                  <>
                                    {" "}
                                    · ref{" "}
                                    <span className="font-mono">
                                      {p.manual_bank_transaction_id}
                                    </span>
                                  </>
                                )}
                              </span>
                            </div>
                            {p.notes && (
                              <div className="mt-1 text-[11px] text-text-faint">
                                {p.notes}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[13px] text-text-faint">
                        No payments recorded yet.
                        {balanceDue > 0
                          ? manualAllowed && canEditSales
                            ? " Record one above when the customer's transfer lands, or send a pay link."
                            : " Send the customer a pay link — gateway payments post themselves the moment they clear."
                          : ""}
                      </div>
                    )}
                  </Card>
                </div>
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
                      {/* A multi-item order finishes only when every hair does.
                          Without this the drawer showed one job and gave no
                          hint the other two existed. */}
                      {studioProgress && studioProgress.total > 1 && (
                        <Pill tone={studioProgress.ready ? "success" : "warn"}>
                          {studioProgress.done} of {studioProgress.total} items
                          ready
                        </Pill>
                      )}
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
                            navigate(
                              `/service-jobs?tab=board&job=${job.job_id}${studioFrom}`,
                            )
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
                                  {s.when ? fmtDate(s.when) : (s.sub ?? "")}
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
                          {/* The rail shows when each stage happened; this is
                              the date it's still promised for. */}
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
                        onClick={() =>
                          navigate(`/service-jobs?tab=board${studioFrom}`)
                        }
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
                            {formatDateTime(ev.occurred_at)}
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
                            {formatDateTime(e.when)}
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
                              {formatDate(o.created_at)}
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
        onClose={() => {
          setConfirmCancel(false);
          setCancelReason("");
          setCancelReasonText("");
        }}
        onConfirm={handleCancel}
        title="Cancel Order"
        message={
          <div className="space-y-3">
            <p>
              This releases the stock the order is holding and moves it to the
              archive. You can reinstate it afterwards, but any deposit it
              carries is forfeited to income and cannot be brought back.
            </p>
            <div>
              <div className="text-[12px] font-semibold text-text-primary mb-1.5">
                Why is it being cancelled?
              </div>
              <Select
                value={cancelReason}
                onChange={setCancelReason}
                options={[
                  { value: "", label: "Choose a reason…" },
                  ...MANUAL_CANCELLATION_REASONS,
                  { value: "other", label: "Other…" },
                ]}
              />
            </div>
            {cancelReason === "other" && (
              <TextInput
                autoFocus
                maxLength={500}
                placeholder="Say what happened"
                value={cancelReasonText}
                onChange={(e) => setCancelReasonText(e.target.value)}
              />
            )}
            <p className="text-[11.5px] text-text-faint">
              The reason is shown on the order and in the archive, so whoever
              looks at this next can see what happened.
            </p>
          </div>
        }
        confirmLabel="Cancel Order"
        busy={cancelOrder.isPending}
        disabled={!resolvedCancelReason}
      />
      {/* Reinstate dry run came back short: some lines can't be re-held. */}
      <ConfirmDialog
        open={!!reinstateShort}
        onClose={() => setReinstateShort(null)}
        onConfirm={() => handleReinstate(true)}
        title="Reinstate as pre-order?"
        tone="accent"
        confirmLabel="Reinstate anyway"
        busy={restoreOrder.isPending}
        message={
          <div className="space-y-2">
            <p>{reinstateShort?.message}</p>
            <ul className="space-y-1">
              {(reinstateShort?.lines ?? []).map((l) => (
                <li key={l.line_id} className="flex justify-between gap-3">
                  <span className="truncate">{l.name || "Item"}</span>
                  <span className="text-text-faint shrink-0">
                    want {l.wanted}, have {l.available}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        }
      />
      {pendingStatus &&
        (() => {
          const impact = statusMoveImpact(pendingStatus);
          const auto = statusAutomations?.[pendingStatus as OrderStatus];
          return (
            <ConfirmDialog
              open={!!pendingStatus}
              onClose={() => setPendingStatus(null)}
              onConfirm={handleConfirmMove}
              title={impact.title}
              confirmLabel={impact.confirmLabel}
              busy={setStatus.isPending}
              message={
                <div className="space-y-3">
                  <p>{impact.note}</p>
                  {impact.effects.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-1">
                        What this does:
                      </p>
                      <ul className="list-disc pl-5 space-y-1 text-sm opacity-90">
                        {impact.effects.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* Forcing "Order Ready" while hairs are still being styled
                      is allowed — it's the escape hatch for releasing one item
                      early — but the customer is told the WHOLE order is ready,
                      so say so plainly before they click. */}
                  {pendingStatus === "order_ready" &&
                    studioProgress &&
                    studioProgress.outstanding > 0 && (
                      <div className="flex items-start gap-2 rounded-[9px] px-3 py-2 text-sm bg-warn/[0.08] border border-warn/25">
                        <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                        <span>
                          {studioProgress.outstanding} of{" "}
                          {studioProgress.total}{" "}
                          {studioProgress.total === 1 ? "item is" : "items are"}{" "}
                          still in the Studio. Moving the order now tells the
                          customer the whole order is ready.
                        </span>
                      </div>
                    )}
                  {/* Message-bearing moves show the automation's *live* on/off
                      state so staff get a definite "will send"/"won't send"
                      rather than a hedge. Falls back to the honest conditional
                      wording if the live state can't be read. */}
                  {impact.message &&
                    (() => {
                      const label = impact.message.label;
                      if (automationsLoading && !statusAutomations) {
                        return (
                          <p className="text-sm opacity-70">
                            Checking whether the {label} message will send…
                          </p>
                        );
                      }
                      if (!auto) {
                        return (
                          <p className="text-sm opacity-90">
                            Sends the customer the {label} message — if it's
                            switched on in Messaging settings.
                          </p>
                        );
                      }
                      const channel = messagingChannelLabel(auto.channel);
                      return auto.is_active ? (
                        <div className="flex items-start gap-2 rounded-[9px] px-3 py-2 text-sm bg-success/[0.08] border border-success/25">
                          <Send className="w-4 h-4 text-success shrink-0 mt-0.5" />
                          <span>
                            Will send the customer the {label} message
                            {channel ? ` via ${channel}` : ""}.
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2 rounded-[9px] px-3 py-2 text-sm bg-warn/[0.08] border border-warn/25">
                          <XCircle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                          <span>
                            Won't send the {label} message — it's switched off
                            in Messaging settings.
                          </span>
                        </div>
                      );
                    })()}
                </div>
              }
            />
          );
        })()}

      {order && payLinkOpen && (
        <PayLinkModal order={order} onClose={() => setPayLinkOpen(false)} />
      )}

      {/* Change Order. Keyed on the order's updated_at so reopening it after a
          save reseeds the cart from the CURRENT lines rather than replaying the
          state it was mounted with. */}
      {order && changeOpen && (
        <ChangeOrderModal
          key={order.updated_at}
          order={order}
          open={changeOpen}
          onClose={() => setChangeOpen(false)}
          onSaved={(message) => fireToast("Order Updated", message)}
        />
      )}
    </div>
  );
}

// ── Pay link (Flexi Pay, PR-3) ───────────────────────────────
// Mints a customer-facing checkout link for a chosen amount (blank = the full
// balance) and drops it on the clipboard to paste into WhatsApp or email.
// Accepting money the customer already sent is the Record Payment form in the
// Payments card above — this modal is only ever about the link.
function PayLinkModal({
  order,
  onClose,
}: {
  order: SalesOrder;
  onClose: () => void;
}) {
  const balance = Number(order.balance_due_ngn);
  const currency =
    order.display_currency && order.display_currency !== "NGN"
      ? order.display_currency
      : undefined;
  const createLink = useCreatePaymentLink(order.order_id);
  const toastStore = useToastStore();

  // Pay-link amount (₦). Empty = full balance.
  const [linkAmount, setLinkAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const notify = (
    title: string,
    body: string,
    priority: "normal" | "high" = "normal",
  ) =>
    toastStore.add({
      notification_id: crypto.randomUUID(),
      user_id: "",
      business: null,
      type: "payment",
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

  const handleLink = async () => {
    setErr(null);
    const amt = linkAmount ? Number(linkAmount) : undefined;
    if (amt !== undefined && (!Number.isFinite(amt) || amt <= 0)) {
      setErr("Enter a valid amount, or leave blank for the full balance.");
      return;
    }
    try {
      const res = await createLink.mutateAsync({
        ...(amt !== undefined ? { amount_ngn: amt } : {}),
        // Settle in the currency the order was sold in. Omitting this billed a
        // USD order in Naira, letting Nomba reconvert at its own rate (the buyer
        // saw $708.25 instead of the quoted $764). NGN orders pass undefined.
        ...(currency ? { currency } : {}),
      });
      await navigator.clipboard.writeText(res.checkout_url).catch(() => {});
      notify("Pay link copied", "The payment link is on your clipboard.");
      onClose();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Couldn't generate the link.";
      setErr(msg);
      notify("Link failed", msg, "high");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[16px] glass shadow-glass p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-accent-glow" />
          <h3 className="font-display text-lg">Send pay link</h3>
        </div>
        <div className="text-[12px] text-text-muted">
          Balance {money(balance)} on {order.order_number}
        </div>

        <div className="space-y-3">
          <Field
            label="Amount"
            hint={`blank = full balance (${money(balance)})`}
          >
            <TextInput
              type="number"
              min={0}
              value={linkAmount}
              onChange={(e) => setLinkAmount(e.target.value)}
              placeholder={String(balance)}
            />
          </Field>
          {err && <p className="text-[12px] text-danger">{err}</p>}
          <Button
            onClick={handleLink}
            disabled={createLink.isPending}
            icon={<Link2 className="w-4 h-4" />}
          >
            {createLink.isPending ? "Generating…" : "Generate & copy pay link"}
          </Button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full text-[12px] text-text-muted hover:text-text-primary"
        >
          Close
        </button>
      </div>
    </div>
  );
}
