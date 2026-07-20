/**
 * Crowns 👑 — unified loyalty + streak economy (V2.2 §6.23) — typed client +
 * TanStack hooks. Backend: src/modules/retention/crown.* (mounted
 * /api/v1/retention/crowns, permission key `retention`).
 *
 * Every read is entity-scoped (X-Brand-Context is attached by the api client);
 * query keys carry the brand so a business switch refetches cleanly. Crowns are
 * status-only — there is no "spend/redeem", so there is no redemption hook.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

export type CrownVerification = "auto" | "honor" | "manual";
export type CrownAction =
  | "create_account"
  | "complete_purchase"
  | "money_spent"
  | "refer_friend_purchase"
  | "newsletter_subscribe"
  | "add_birthday"
  | "leave_review"
  | "social_follow"
  | "social_tag"
  | "ugc_upload"
  | "hair_quiz_complete"
  | "order_milestone"
  | "manual";

export interface CrownTier {
  tier_id: string;
  tier_key: string;
  tier_name: string;
  description: string | null;
  min_crowns: number;
  display_order: number;
  next_purchase_discount_pct: number;
  grants_free_shipping_next: boolean;
  lifetime_discount_pct: number;
  earning_multiplier: number;
  benefits: Record<string, boolean>;
  badge_colour_hex: string | null;
  is_active: boolean;
}

export interface CrownEarnRule {
  rule_id: string;
  rule_key: string;
  display_name: string;
  description: string | null;
  action_type: CrownAction;
  crowns_mode: "flat" | "per_currency";
  crown_value: number | null;
  unit_currency_per_crown: number | null;
  verification_mode: CrownVerification;
  social_platform: string | null;
  min_order_value: number | null;
  max_awards_per_customer_lifetime: number | null;
  max_awards_per_customer_per_month: number | null;
  max_awards_per_customer_per_year: number | null;
  is_active: boolean;
  display_order: number;
}

export interface CrownStreakConfig {
  config_id: string;
  streak_type: "purchase_monthly" | "engagement_weekly";
  display_name: string;
  description: string | null;
  period_unit: "day" | "week" | "month";
  period_length: number;
  grace_days: number;
  qualifying_action: "purchase" | "check_in";
  freeze_allowance: number;
  nudge_lead_days: number;
  awards_crowns_on_extend: number;
  is_active: boolean;
}

export interface CrownState {
  current_crowns: number;
  lifetime_earned: number;
  current_tier_id: string | null;
  tier_key: string | null;
  tier_name: string | null;
  lifetime_discount_pct: number | null;
  next_tier_name: string | null;
  next_tier_min: number | null;
  crowns_to_next_tier: number | null;
}

export interface CrownLedgerEntry {
  ledger_id: string;
  transaction_type: string;
  crowns: number;
  earn_action_type: string | null;
  description: string | null;
  occurred_at: string;
}

export interface CrownStreak {
  streak_id: string;
  streak_type: string;
  current_length: number;
  longest_length: number;
  status: "active" | "at_risk" | "frozen" | "broken";
  deadline_at: string | null;
  freezes_available: number;
}

export interface CrownGrant {
  grant_id: string;
  grant_type: "next_purchase_discount" | "free_shipping_next";
  discount_pct: number | null;
  status: string;
  tier_name: string | null;
  expires_at: string | null;
}

export interface CrownWallet {
  state: CrownState | null;
  ledger: CrownLedgerEntry[];
  streaks: CrownStreak[];
  grants: CrownGrant[];
  tiers: CrownTier[];
}

export interface CrownSubmission {
  submission_id: string;
  contact_id: string;
  contact_name: string | null;
  rule_name: string | null;
  action_type: CrownAction;
  verification_mode: CrownVerification;
  social_platform: string | null;
  social_handle: string | null;
  proof_url: string | null;
  media_asset_id: string | null;
  note: string | null;
  status: string;
  submitted_at: string;
}

// ════════════════════════════════════════════════════════════
// Config: tiers · earn rules · streak defs
// ════════════════════════════════════════════════════════════

export function useCrownTiers() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["retention", "crown-tiers", brand],
    queryFn: () => api.get<CrownTier[]>("/retention/crowns/tiers"),
    staleTime: 30_000,
  });
}

export function useSaveCrownTier() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<CrownTier> }) =>
      id
        ? api.patch<CrownTier>(`/retention/crowns/tiers/${id}`, body)
        : api.post<CrownTier>("/retention/crowns/tiers", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["retention", "crown-tiers", brand] }),
  });
}

export function useCrownEarnRules() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["retention", "crown-rules", brand],
    queryFn: () => api.get<CrownEarnRule[]>("/retention/crowns/earn-rules"),
    staleTime: 30_000,
  });
}

export function useSaveCrownRule() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<CrownEarnRule> }) =>
      id
        ? api.patch<CrownEarnRule>(`/retention/crowns/earn-rules/${id}`, body)
        : api.post<CrownEarnRule>("/retention/crowns/earn-rules", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["retention", "crown-rules", brand] }),
  });
}

export function useCrownStreakConfig() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["retention", "crown-streak-config", brand],
    queryFn: () => api.get<CrownStreakConfig[]>("/retention/crowns/streak-config"),
    staleTime: 60_000,
  });
}

export interface CrownAtRiskStreak {
  streak_id: string;
  contact_id: string;
  contact_name: string | null;
  streak_type: string;
  streak_name: string | null;
  current_length: number;
  status: string;
  deadline_at: string | null;
  freezes_available: number;
}

export function useCrownAtRiskStreaks() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["retention", "crown-at-risk", brand],
    queryFn: () =>
      api.get<CrownAtRiskStreak[]>("/retention/crowns/streaks/at-risk"),
    staleTime: 30_000,
  });
}

// ════════════════════════════════════════════════════════════
// Per-customer wallet + manual adjustment
// ════════════════════════════════════════════════════════════

export function useCrownWallet(contactId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["retention", "crown-wallet", brand, contactId],
    queryFn: () => api.get<CrownWallet>(`/retention/crowns/customers/${contactId}`),
    enabled: !!contactId,
    staleTime: 15_000,
  });
}

export function useAdjustCrowns() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { contactId: string; crowns: number; note?: string }) =>
      api.post(`/retention/crowns/customers/${args.contactId}/adjust`, {
        crowns: args.crowns,
        note: args.note,
      }),
    onSuccess: (_d, args) =>
      qc.invalidateQueries({
        queryKey: ["retention", "crown-wallet", brand, args.contactId],
      }),
  });
}

// ════════════════════════════════════════════════════════════
// Verification queue (honor auto-approves; manual waits for review)
// ════════════════════════════════════════════════════════════

export function useCrownSubmissions() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["retention", "crown-submissions", brand],
    queryFn: () =>
      api.get<CrownSubmission[]>("/retention/crowns/submissions"),
    staleTime: 15_000,
  });
}

export function useReviewCrownSubmission() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: {
      id: string;
      decision: "approve" | "reject";
      review_note?: string;
    }) =>
      api.post(`/retention/crowns/submissions/${args.id}/review`, {
        decision: args.decision,
        review_note: args.review_note,
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["retention", "crown-submissions", brand],
      }),
  });
}
