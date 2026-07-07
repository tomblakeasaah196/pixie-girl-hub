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
  draft: { label: "Draft", tone: "neutral" },
  pending_payment: { label: "Pending Payment", tone: "warn" },
  paid: { label: "Paid", tone: "success" },
  in_production: { label: "In Production", tone: "info" },
  awaiting_dispatch: { label: "Awaiting Dispatch", tone: "info" },
  partially_fulfilled: { label: "Partially Fulfilled", tone: "warn" },
  fulfilled: { label: "Fulfilled", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
  cancellation_requested: { label: "Cancel Requested", tone: "danger" },
};

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
