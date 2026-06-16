/**
 * Outbound Channel Policy — typed client. Matches the routes in
 * `src/modules/outbound_policy/outbound-policy.routes.js`.
 */

import { api } from "@/lib/api";

export type ChannelPreference =
  | "email"
  | "whatsapp"
  | "instagram"
  | "in_app_only"
  | "respect_contact_pref"
  | "disabled";

export type FallbackChannel =
  | "email"
  | "whatsapp"
  | "instagram"
  | "in_app_only"
  | "disabled";

export interface OutboundPolicy {
  policy_id: string;
  business: string;
  event_key: string;
  channel_preference: ChannelPreference;
  fallback_channel: FallbackChannel | null;
  rationale: string | null;
  block_whatsapp: boolean;
  is_active: boolean;
  updated_at: string;
}

export interface PolicyUpsert {
  event_key: string;
  channel_preference: ChannelPreference;
  fallback_channel?: FallbackChannel;
  rationale?: string;
  block_whatsapp?: boolean;
  is_active?: boolean;
}

export const outboundPolicyApi = {
  list: () => api.get<OutboundPolicy[]>("/outbound-policy"),
  upsert: (input: PolicyUpsert) =>
    api.put<OutboundPolicy>("/outbound-policy", input),
};

/**
 * Friendly metadata for the seeded event keys. Order matters for
 * the table; categories drive section grouping.
 */
export const EVENT_META: Record<
  string,
  { label: string; category: string; description: string }
> = {
  order_confirmation: {
    label: "Order confirmation",
    category: "Transactional",
    description: "PDF receipt right after a successful order.",
  },
  order_paid_receipt: {
    label: "Payment received",
    category: "Transactional",
    description: "Confirmation that a customer's payment landed.",
  },
  invoice_issued: {
    label: "Invoice issued",
    category: "Transactional",
    description: "Outbound invoice with PDF attachment.",
  },
  order_ready: {
    label: "Order ready",
    category: "Production",
    description: "Order completed in production, awaiting dispatch.",
  },
  production_update: {
    label: "Production update",
    category: "Production",
    description: "Optional progress info while order is in production.",
  },
  order_shipped: {
    label: "Order shipped",
    category: "Delivery",
    description: "Tracking link + courier details.",
  },
  out_for_delivery: {
    label: "Out for delivery",
    category: "Delivery",
    description: "Rider has picked up; customer must be reachable.",
  },
  delivery_failed: {
    label: "Delivery failed",
    category: "Delivery",
    description: "Re-attempt required — speed matters.",
  },
  payment_reminder: {
    label: "Payment reminder",
    category: "Recovery",
    description: "Customer owes a balance — recovery-positive.",
  },
  layaway_reminder: {
    label: "Layaway reminder",
    category: "Recovery",
    description: "Layaway plan instalment due.",
  },
  abandoned_cart: {
    label: "Abandoned cart",
    category: "Recovery",
    description: "Customer left the storefront mid-checkout.",
  },
  marketing_blast: {
    label: "Marketing blast",
    category: "Marketing",
    description: "Promotional broadcast to a segment.",
  },
  newsletter: {
    label: "Newsletter",
    category: "Marketing",
    description: "Periodic update to subscribers.",
  },
  campaign_launch: {
    label: "Campaign launch",
    category: "Marketing",
    description: "Flash sale / new collection announcement.",
  },
  welcome: {
    label: "Welcome",
    category: "Lifecycle",
    description: "First impression for a new customer.",
  },
  birthday: {
    label: "Birthday",
    category: "Lifecycle",
    description: "Annual birthday wish (and maybe a coupon).",
  },
  review_request: {
    label: "Review request",
    category: "Lifecycle",
    description: "Post-delivery review nudge.",
  },
  staff_invite: {
    label: "Staff invite",
    category: "Internal",
    description: "Onboarding link for new staff.",
  },
  stylist_assignment: {
    label: "Stylist assignment",
    category: "Operations",
    description: "Stylist needs to act on a job.",
  },
};

export const CATEGORY_ORDER = [
  "Transactional",
  "Production",
  "Delivery",
  "Recovery",
  "Marketing",
  "Lifecycle",
  "Internal",
  "Operations",
] as const;
