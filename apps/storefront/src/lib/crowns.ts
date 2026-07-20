/**
 * Crowns 👑 — storefront client (§6.23 unified economy). The shopper's own
 * wallet + earning, plus the public programme for the marketing page. Wraps the
 * one Hub fetch client (brand + customer token handled there). Crowns are
 * status-only — there is no spend/redeem.
 */

import { api } from "./api";

export interface CrownTierPublic {
  tier_key: string;
  tier_name: string;
  description: string | null;
  min_crowns: number;
  next_purchase_discount_pct: number;
  lifetime_discount_pct: number;
  grants_free_shipping_next: boolean;
  benefits: Record<string, boolean>;
  badge_colour_hex: string | null;
}

export interface CrownEarnRulePublic {
  rule_key: string;
  display_name: string;
  description: string | null;
  action_type: string;
  crowns_mode: "flat" | "per_currency";
  crown_value: number | null;
  unit_currency_per_crown: number | null;
  verification_mode: "auto" | "honor" | "manual";
  social_platform: string | null;
}

export interface CrownProgramme {
  tiers: CrownTierPublic[];
  earn_rules: CrownEarnRulePublic[];
  streaks: { streak_type: string; display_name: string; description: string | null; period_unit: string }[];
}

export interface CrownWalletStreak {
  streak_type: string;
  current_length: number;
  longest_length: number;
  status: "active" | "at_risk" | "frozen" | "broken";
  deadline_at: string | null;
  freezes_available: number;
}

export interface CrownVoucher {
  grant_type: "next_purchase_discount" | "free_shipping_next";
  discount_pct: number | null;
  tier_name: string | null;
  expires_at: string | null;
}

export interface CrownWallet {
  balance: number;
  lifetime_earned: number;
  tier: { key: string; name: string; lifetime_discount_pct: number } | null;
  next_tier: { name: string; crowns_to_go: number } | null;
  streaks: CrownWalletStreak[];
  vouchers: CrownVoucher[];
  ledger: {
    transaction_type: string;
    crowns: number;
    description: string | null;
    occurred_at: string;
  }[];
}

export interface CrownDiscount {
  lifetime_discount_pct: number;
  next_purchase_discount_pct: number;
  next_purchase_grant_id: string | null;
  free_shipping: boolean;
  tier_name: string | null;
}

export interface CrownSubmitBody {
  rule_key: string;
  social_handle?: string;
  proof_url?: string;
  media_asset_id?: string;
  note?: string;
}

export const getCrownProgramme = () =>
  api.get<CrownProgramme>("/api/public/auth/crowns/programme");

export const getCrownWallet = () =>
  api.get<CrownWallet>("/api/public/auth/crowns");

export const getCrownDiscount = () =>
  api.get<CrownDiscount>("/api/public/auth/crowns/discount");

export const submitCrownAction = (body: CrownSubmitBody) =>
  api.post<{ submission_id: string; status: string }>(
    "/api/public/auth/crowns/submit",
    body,
  );

export const crownCheckIn = () =>
  api.post<{ streaks: CrownWalletStreak[] }>("/api/public/auth/crowns/check-in");
