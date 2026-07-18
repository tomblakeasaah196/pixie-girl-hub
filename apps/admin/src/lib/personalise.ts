/**
 * Personalise tokens — the ONE registry both mail surfaces share.
 *
 * The Marketing template editor and the Retention strategy builder write the
 * same `{{token}}` merge tags, rendered by the same backend pipeline
 * (src/services/email-personalise + email_campaigns/email-render). This file
 * is the frontend mirror of that vocabulary:
 *
 *   • recipient — who the mail is going to (auto-filled per customer)
 *   • loyalty   — their live loyalty/purchase state (auto-filled per customer)
 *   • brand     — identity from Settings (auto-filled per brand)
 *   • sale      — a campaign's sale details (campaign mail only)
 *   • custom    — owner-defined tokens ("add your own" in the editor),
 *                 stored per brand via /email-campaigns/personalise-tokens
 *
 * Scopes: the campaign editor shows recipient+loyalty+sale (+custom); the
 * retention builder shows recipient+loyalty (+custom) — sale tokens only mean
 * something inside a campaign.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

export type TokenGroup = "recipient" | "loyalty" | "brand" | "sale";
export type TokenScope = "campaign" | "retention";

export interface PersonaliseToken {
  /** Bare token name (no braces) — what the pill serialises to. */
  token: string;
  label: string;
  group: TokenGroup;
  /** Auto-filled by the pipeline — never set by hand. */
  auto?: boolean;
}

export const PERSONALISE_TOKENS: PersonaliseToken[] = [
  // Recipient (auto)
  { token: "first_name", label: "First name", group: "recipient", auto: true },
  { token: "customer_name", label: "Full name", group: "recipient", auto: true },
  { token: "email", label: "Email address", group: "recipient", auto: true },
  { token: "unsubscribe_url", label: "Unsubscribe link", group: "recipient", auto: true },
  // Loyalty (auto — live per customer, formatted for prose: "1,250", "₦350,000")
  { token: "points_balance", label: "Points balance", group: "loyalty", auto: true },
  { token: "lifetime_points", label: "Lifetime points", group: "loyalty", auto: true },
  { token: "tier_name", label: "Loyalty tier", group: "loyalty", auto: true },
  { token: "order_count", label: "Orders placed", group: "loyalty", auto: true },
  { token: "lifetime_spend", label: "Lifetime spend (₦)", group: "loyalty", auto: true },
  { token: "days_since_last_order", label: "Days since last order", group: "loyalty", auto: true },
  { token: "days_since_signup", label: "Days since joining", group: "loyalty", auto: true },
  // Brand identity (auto, from Settings)
  { token: "brand_name", label: "Brand name", group: "brand", auto: true },
  { token: "logo_url", label: "Logo URL", group: "brand", auto: true },
  { token: "brand_color", label: "Accent colour", group: "brand", auto: true },
  { token: "website_url", label: "Website", group: "brand", auto: true },
  { token: "support_email", label: "Support email", group: "brand", auto: true },
  // Sale / campaign (from a campaign's Sale details)
  { token: "discount", label: "Discount %", group: "sale" },
  { token: "sale_url", label: "Sale link", group: "sale" },
  { token: "sale_end_display", label: "End date", group: "sale" },
  { token: "deadline_phrase", label: "Countdown phrase", group: "sale" },
  { token: "days_left", label: "Days left", group: "sale" },
];

/** Which built-in groups the Personalise menu offers per editor scope. */
export const SCOPE_GROUPS: Record<
  TokenScope,
  { group: TokenGroup; heading: string }[]
> = {
  campaign: [
    { group: "recipient", heading: "Fills in for each customer" },
    { group: "loyalty", heading: "Their loyalty & orders" },
    { group: "sale", heading: "From the campaign's sale details" },
  ],
  retention: [
    { group: "recipient", heading: "Fills in for each customer" },
    { group: "loyalty", heading: "Their loyalty & orders" },
  ],
};

const LABELS: Record<string, string> = Object.fromEntries(
  PERSONALISE_TOKENS.map((t) => [t.token, t.label]),
);
// Custom-token labels register here as they load so pills read as chips, not
// code, on every surface that renders them.
const DYNAMIC_LABELS: Record<string, string> = {};
export function registerTokenLabels(list: { token: string; label?: string }[]) {
  for (const t of list) DYNAMIC_LABELS[t.token] = t.label || t.token;
}
export function tokenLabel(token: string): string {
  return LABELS[token] || DYNAMIC_LABELS[token] || token;
}

// ── Custom tokens (owner-defined, per brand) ────────────────
export interface CustomToken {
  token: string;
  label: string;
  value: string;
}

/** Same client-side rule the backend enforces — instant feedback in the
 *  add-token form. */
export const CUSTOM_TOKEN_RE = /^[a-z][a-z0-9_]{1,39}$/;
export function isReservedToken(token: string): boolean {
  return PERSONALISE_TOKENS.some((t) => t.token === token);
}

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

/** The brand's custom tokens. 403s quietly resolve to none — a retention
 *  user without the email_campaigns grant still gets the built-in menu. */
export function useCustomTokens() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["email", "personalise-tokens", brand],
    queryFn: async () => {
      try {
        const r = await api.get<{ custom: CustomToken[] }>(
          "/email-campaigns/personalise-tokens",
        );
        return r.custom ?? [];
      } catch {
        return [] as CustomToken[];
      }
    },
    staleTime: 60_000,
  });
}

export function useSaveCustomTokens() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (tokens: CustomToken[]) =>
      api.put<{ custom: CustomToken[] }>("/email-campaigns/personalise-tokens", {
        tokens,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email", "personalise-tokens", brand] });
      // Token values merge into rendered mail — previews must refresh.
      qc.invalidateQueries({ queryKey: ["email", "frame-shell", brand] });
      qc.invalidateQueries({ queryKey: ["email", "preview", brand] });
    },
  });
}
