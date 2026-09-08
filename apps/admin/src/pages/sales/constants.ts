import type {
  OrderStatus,
  QuoteStatus,
  SalesChannel,
  FulfilmentType,
} from "./types";

type Tone = "success" | "warn" | "danger" | "info" | "accent" | "neutral";

interface StatusMeta {
  label: string;
  tone: Tone;
}

export const ORDER_STATUS: Record<OrderStatus, StatusMeta> = {
  pending_payment: { label: "Pending Payment", tone: "warn" },
  partially_paid: { label: "Partially Paid", tone: "warn" },
  paid: { label: "Paid", tone: "success" },
  assigned: { label: "Assigned", tone: "info" },
  order_ready: { label: "Order Ready", tone: "info" },
  dispatched: { label: "Dispatched", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  cancellation_requested: { label: "Cancel Requested", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "danger" },
  // Rare/legacy side-states.
  draft: { label: "Draft", tone: "neutral" },
  refunded: { label: "Refunded", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
};

// ── Payment state ───────────────────────────────────────────────────────────
/**
 * How much of an order has actually been paid — derived from MONEY, never from
 * `status`.
 *
 * `sales_orders.status` is one lifecycle column that mixes payment states
 * ('pending_payment' → 'partially_paid' → 'paid') with fulfilment states
 * ('assigned' → 'order_ready' → 'dispatched' → 'completed') and the side-states
 * ('cancelled', 'refunded', 'failed'). Past 'paid' it deliberately stops saying
 * anything about money: addPayment's markPaid keeps the fulfilment status rather
 * than rewinding it, so a layaway order can sit at 'assigned' with a balance
 * outstanding. Anything of the shape `!["draft","pending_payment"].includes(status)`
 * therefore reads "paid" for partially paid, cancelled, refunded and failed
 * orders alike — which is exactly how the order page's pill came to say "Paid"
 * on an order with ₦5,000 still due.
 *
 * The truth is the three money columns: `total_ngn`, `amount_paid_ngn`, and the
 * generated `balance_due_ngn` (= total − paid). This is what the Orders list's
 * Balance column has always used.
 */
export interface PaymentMeta {
  label: string;
  tone: Tone;
  /** Nothing left to collect — the "safe to hand over the goods" test. */
  settled: boolean;
}

const amount = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function orderPaymentMeta(
  order?: {
    status?: string | null;
    total_ngn?: string | number | null;
    amount_paid_ngn?: string | number | null;
    balance_due_ngn?: string | number | null;
  } | null,
): PaymentMeta {
  if (!order) return { label: "—", tone: "neutral", settled: false };

  const total = amount(order.total_ngn);
  const paid = amount(order.amount_paid_ngn);
  // balance_due_ngn is a generated column (total − paid); recompute only for
  // payloads that don't carry it.
  const balance =
    order.balance_due_ngn == null ? total - paid : amount(order.balance_due_ngn);

  // A refund pays money back out, but the payment rows stay (the trigger's
  // timestamps are sticky, refunds run through cancellation_requests), so
  // amount_paid_ngn still reads full and the arithmetic alone would say "Paid".
  if (order.status === "refunded")
    return { label: "Refunded", tone: "danger", settled: false };

  // A closed order isn't chasing anybody — an unpaid one is simply closed.
  // Money still sitting on one is a live refund-or-forfeit decision, so that
  // case keeps its warning tone below.
  const closed = order.status === "cancelled" || order.status === "failed";

  if (balance < 0) return { label: "Overpaid", tone: "info", settled: true };
  if (paid <= 0)
    return total <= 0
      ? { label: "No charge", tone: "neutral", settled: true }
      : { label: "Unpaid", tone: closed ? "neutral" : "warn", settled: false };
  if (balance > 0) return { label: "Part paid", tone: "warn", settled: false };
  return { label: "Paid", tone: "success", settled: true };
}

/** No more money is coming or going — payment polling can stop. */
export function isOrderPaymentFinal(order?: {
  status?: string | null;
  total_ngn?: string | number | null;
  amount_paid_ngn?: string | number | null;
  balance_due_ngn?: string | number | null;
} | null): boolean {
  if (!order) return false;
  return (
    orderPaymentMeta(order).settled ||
    ["cancelled", "refunded", "failed"].includes(order.status ?? "")
  );
}

// The linear happy-path order, for the drawer's manual status stepper. Excludes
// the side-states (draft/cancel/refunded/failed), which are reached via their
// own actions, not by stepping forward.
export const ORDER_STATUS_FLOW: OrderStatus[] = [
  "pending_payment",
  "partially_paid",
  "paid",
  "assigned",
  "order_ready",
  "dispatched",
  "completed",
];

// The fulfilment stages staff can set manually from the drawer.
export const MANUAL_MOVE_STATUSES: OrderStatus[] = [
  "assigned",
  "order_ready",
  "dispatched",
  "completed",
];

export interface StatusMoveImpact {
  title: string;
  confirmLabel: string;
  note: string;
  effects: string[];
  /**
   * Present when this move fires a customer message. The drawer resolves the
   * automation's live on/off state (useStatusAutomations) and renders a
   * definite "will send" / "won't send — it's off" line in its place; `label`
   * is the message's friendly name (already curly-quoted for the sentence).
   */
  message?: { label: string };
}

// What a manual status move does — shown in the drawer's confirmation modal so
// staff see the impact (and which customer message fires) before committing.
// Message-bearing moves carry a `message` descriptor rather than a baked-in
// effect line, so the modal can show whether that message is *actually*
// switched on right now (see OrderDetail's impact modal).
export function statusMoveImpact(status: string): StatusMoveImpact {
  switch (status) {
    case "assigned":
      return {
        title: "Move to Assigned?",
        confirmLabel: "Mark Assigned",
        note: "Marks this order as being worked on by a stylist.",
        effects: [
          "Order status becomes Assigned",
          "No message is sent to the customer",
          "No change to payment or stock",
        ],
      };
    case "order_ready":
      return {
        title: "Move to Order Ready?",
        confirmLabel: "Mark Order Ready",
        note: "Marks the order packed and ready for the courier.",
        effects: ["Order status becomes Order Ready"],
        message: { label: "“Order Ready”" },
      };
    case "dispatched":
      return {
        title: "Move to Dispatched?",
        confirmLabel: "Mark Dispatched",
        note: "This tells the customer the order is on its way — only do it once the courier actually has the parcel.",
        effects: ["Order status becomes Dispatched"],
        message: { label: "“On its way”" },
      };
    case "completed":
      return {
        title: "Move to Completed?",
        confirmLabel: "Mark Completed",
        note: "Closes the order as delivered or collected. This is a final state.",
        effects: [
          "Order status becomes Completed",
          "Counts as completed revenue in reports",
          "No further automatic status changes",
        ],
      };
    default:
      return {
        title: "Move status?",
        confirmLabel: "Confirm",
        note: `Move this order to ${ORDER_STATUS[status as OrderStatus]?.label ?? status}.`,
        effects: [],
      };
  }
}

// Friendly channel name for the impact modal's "will send … via WhatsApp" line.
export function messagingChannelLabel(channel: string | null): string | null {
  switch (channel) {
    case "whatsapp":
      return "WhatsApp";
    case "email":
      return "email";
    case "instagram":
      return "Instagram";
    case "sms":
      return "SMS";
    default:
      // respect_contact_pref / in_app_only / unknown → don't name a channel.
      return null;
  }
}

export const QUOTE_STATUS: Record<QuoteStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  viewed: { label: "Viewed", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  converted: { label: "Converted", tone: "accent" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

// Approved channels shown in the picker, grouped Digital vs Physical (V2.2 §6.4).
// The full historical enum still exists on the backend so older orders keep
// their tag in reports — see SALES_CHANNEL_LABELS below for a lookup used to
// render legacy tags in read-only views.
export type SalesChannelGroup = "digital" | "physical";
export const SALES_CHANNEL_GROUPS: {
  key: SalesChannelGroup;
  label: string;
  channels: { value: SalesChannel; label: string }[];
}[] = [
  {
    key: "digital",
    label: "Digital",
    channels: [
      { value: "whatsapp", label: "WhatsApp" },
      { value: "instagram", label: "Instagram" },
      { value: "storefront", label: "Website" },
      { value: "sales_campaign", label: "Sales Campaign" },
    ],
  },
  {
    key: "physical",
    label: "Physical",
    channels: [
      { value: "walk_in", label: "Walk-in" },
      { value: "event", label: "Event" },
    ],
  },
];

// Flat picker list (backwards-compat for existing callers that iterate a
// single array — the grouped version drives the Quick Sale UI).
export const SALES_CHANNELS: { value: SalesChannel; label: string }[] =
  SALES_CHANNEL_GROUPS.flatMap((g) => g.channels);

// Legacy channel labels — used only for rendering historical orders whose
// channel was pruned from the picker. Fresh sales can no longer pick these.
export const SALES_CHANNEL_LEGACY_LABELS: Partial<Record<SalesChannel, string>> =
  {
    phone: "Phone",
    facebook: "Facebook",
    tiktok: "TikTok",
    public_form: "Public Form",
    wholesale: "Wholesale",
    partner: "Partner",
    stylist_routed: "Stylist",
    subscription: "Subscription",
    intercompany: "Intercompany",
    woocommerce: "WooCommerce",
    pos: "POS",
  };

/** Friendly channel label — approved + legacy in one lookup. */
export function salesChannelLabel(value: SalesChannel | string): string {
  const active = SALES_CHANNELS.find((c) => c.value === value);
  if (active) return active.label;
  const legacy = SALES_CHANNEL_LEGACY_LABELS[value as SalesChannel];
  if (legacy) return legacy;
  return String(value).replace(/_/g, " ");
}

export const FULFILMENT_OPTIONS = [
  { value: "walk_in", label: "Pick-up" },
  { value: "dispatch", label: "Delivery" },
] as const;

// How each order_type reads to staff. `collection` = customer picks up later,
// `walk_in` = took it in person at POS (same in-store handover as `collection`,
// so both read as "Pick-up" to staff), `dispatch` = courier delivery, `digital`
// = nothing to ship. Used by the orders list column + order detail so "did they
// pick Pick-up?" is answerable at a glance (no logistics fee + Pick-up = correct;
// no fee + Delivery = fee still pending).
export const FULFILMENT_LABELS: Record<
  FulfilmentType,
  { label: string; tone: Tone }
> = {
  dispatch: { label: "Delivery", tone: "info" },
  collection: { label: "Pick-up", tone: "accent" },
  walk_in: { label: "Pick-up", tone: "accent" },
  digital: { label: "Digital", tone: "neutral" },
};

/** Friendly fulfilment label for a raw order_type, with a safe fallback. */
export function fulfilmentLabel(orderType?: string | null): string {
  if (!orderType) return "—";
  return (
    (FULFILMENT_LABELS as Record<string, { label: string }>)[orderType]?.label ??
    orderType.replace(/_/g, " ")
  );
}

export const SEND_VIA_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
] as const;

export const ORDER_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...Object.entries(ORDER_STATUS).map(([v, m]) => ({
    value: v,
    label: m.label,
  })),
];

export const QUOTE_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...Object.entries(QUOTE_STATUS).map(([v, m]) => ({
    value: v,
    label: m.label,
  })),
];
