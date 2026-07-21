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
}

// What a manual status move does — shown in the drawer's confirmation modal so
// staff see the impact (and which customer message fires) before committing.
// The messages only actually send if their automation is switched on under
// Messaging → Automations, hence the "if it's switched on" wording.
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
        effects: [
          "Order status becomes Order Ready",
          "Sends the customer the “Order Ready” message — if it's switched on in Messaging settings",
        ],
      };
    case "dispatched":
      return {
        title: "Move to Dispatched?",
        confirmLabel: "Mark Dispatched",
        note: "This tells the customer the order is on its way — only do it once the courier actually has the parcel.",
        effects: [
          "Order status becomes Dispatched",
          "Sends the customer the “On its way” message — if it's switched on in Messaging settings",
        ],
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
  { value: "walk_in", label: "Walk-in (Pickup)" },
  { value: "dispatch", label: "Delivery" },
] as const;

// How each order_type reads to staff. `collection` = customer picks up later,
// `walk_in` = took it in person at POS, `dispatch` = courier delivery, `digital`
// = nothing to ship. Used by the orders list column + order detail so "did they
// pick Pick-up?" is answerable at a glance (no logistics fee + Pick-up = correct;
// no fee + Delivery = fee still pending).
export const FULFILMENT_LABELS: Record<
  FulfilmentType,
  { label: string; tone: Tone }
> = {
  dispatch: { label: "Delivery", tone: "info" },
  collection: { label: "Pick-up", tone: "accent" },
  walk_in: { label: "Walk-in", tone: "neutral" },
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
