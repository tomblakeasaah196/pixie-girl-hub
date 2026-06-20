import type { OrderStatus, QuoteStatus, SalesChannel } from "./types";

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

export const SALES_CHANNELS: { value: SalesChannel; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "Phone" },
  { value: "storefront", label: "Website" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "event", label: "Event" },
  { value: "public_form", label: "Public Form" },
  { value: "wholesale", label: "Wholesale" },
  { value: "partner", label: "Partner" },
  { value: "stylist_routed", label: "Stylist" },
  { value: "subscription", label: "Subscription" },
  { value: "intercompany", label: "Intercompany" },
  { value: "woocommerce", label: "WooCommerce" },
];

export const FULFILMENT_OPTIONS = [
  { value: "walk_in", label: "Walk-in (Pickup)" },
  { value: "dispatch", label: "Delivery" },
] as const;

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
