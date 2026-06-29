/**
 * Customer Retention & Loyalty (V2.2 §6.23) — typed client + TanStack hooks.
 *
 * Backend: src/modules/retention (mounted /api/v1/retention, permission key
 * `retention`). One module, many sub-resources:
 *   • strategies   — the no-code, multi-step strategy engine (+ catalogue,
 *                    templates, preview, test-send).
 *   • rewards      — the loyalty redemption catalogue.
 *   • earn-rules   — how loyalty points are earned (config-driven).
 *   • referral-program — settings, tiered ladder, dashboard.
 *   • analytics    — §6.23.7 dashboard (computed + simple estimates).
 *   • loyalty/coupons/subscriptions/bundles — existing economy resources.
 *
 * Every read is entity-scoped (X-Brand-Context is attached by the api client);
 * query keys carry the brand so a business switch refetches cleanly.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import type { Tone } from "@/components/ui/primitives";

export function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

export type StrategyStatus = "draft" | "active" | "paused" | "archived";

export interface StrategyStep {
  step_id?: string;
  step_order: number;
  wait_minutes: number;
  step_conditions?: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  email_template_id?: string | null;
  coupon_template?: Record<string, unknown> | null;
  description?: string | null;
}

export interface Strategy {
  strategy_id: string;
  strategy_key: string;
  display_name: string;
  description: string | null;
  template_key: string | null;
  trigger_type: string;
  trigger_conditions: Record<string, unknown>;
  audience_segment_id: string | null;
  status: StrategyStatus;
  max_enrollments_per_customer: number | null;
  reenroll_cooldown_days: number | null;
  summary: string | null;
  total_enrolled: number;
  total_completed: number;
  step_count?: number;
  created_at: string;
  steps?: StrategyStep[];
}

export interface CatalogueTrigger {
  key: string;
  label: string;
  kind: "event" | "scheduled";
  description: string;
}
export interface CatalogueField {
  key: string;
  label: string;
  type: string;
  sample: unknown;
}
export interface CatalogueOperator {
  key: string;
  label: string;
}
export interface CatalogueAction {
  key: string;
  label: string;
  description: string;
  config_schema: {
    key: string;
    label: string;
    type: string;
    required?: boolean;
    options?: string[];
  }[];
}
export interface CatalogueTemplate {
  template_key: string;
  name: string;
  description: string;
  trigger_type: string;
  step_count: number;
}
export interface Catalogue {
  triggers: CatalogueTrigger[];
  condition_fields: CatalogueField[];
  operators: CatalogueOperator[];
  actions: CatalogueAction[];
  templates: CatalogueTemplate[];
}

export interface StrategyPreview {
  summary: string;
  would_enroll: boolean;
  facts_used: Record<string, unknown>;
  steps: {
    step_order: number;
    action_type: string;
    wait: string;
    condition_met: boolean;
    description: string | null;
    rendered?: { subject: string; html: string };
  }[];
}

export interface Reward {
  reward_id: string;
  reward_key: string;
  display_name: string;
  description: string | null;
  reward_type: "order_discount" | "free_shipping" | "free_product" | "gift";
  points_cost: number;
  discount_type: "percentage" | "fixed_amount" | null;
  discount_value: number | null;
  is_active: boolean;
  total_redeemed: number;
  display_order: number;
}

export interface EarnRule {
  rule_id: string;
  rule_key: string;
  display_name: string;
  description: string | null;
  action_type: string;
  points_mode: "flat" | "per_currency";
  points_value: number | null;
  currency_per_point: number | null;
  apply_tier_multiplier: boolean;
  points_expire_days: number | null;
  is_active: boolean;
  display_order: number;
}

export interface ReferralSettings {
  business: string;
  is_active: boolean;
  reward_on: "order_placed" | "full_settlement";
  friend_discount_type: "percentage" | "fixed_amount" | null;
  friend_discount_value: number | null;
  default_referrer_points: number;
  default_referrer_credit_ngn: number;
  min_qualifying_order_ngn: number;
  anti_fraud: Record<string, boolean>;
}

export interface ReferralTier {
  tier_id: string;
  display_name: string | null;
  min_successful_referrals: number;
  referrer_points: number;
  referrer_credit_ngn: number;
  is_active: boolean;
}

export interface ReferralDashboard {
  top_referrers: {
    referral_id: string;
    referral_code: string;
    successful_count: number;
    total_rewards_value: number;
    first_name: string | null;
    display_name: string | null;
  }[];
  totals: {
    total_referrers: number;
    total_conversions: number;
    total_rewarded: number;
    flagged: number;
  };
}

export interface RetentionAnalytics {
  window_days: number;
  points_economy: { earned: number; spent: number; outstanding_liability: number };
  tier_distribution: { tier: string; customers: number }[];
  repeat_purchase: { total_customers: number; repeat_customers: number; repeat_rate_pct: number };
  revenue: { total_ngn: number; total_orders: number; avg_order_value_ngn: number };
  coupon_roi: { redemptions: number; total_discount_ngn: number };
  referral_performance: { referrers: number; conversions: number; rewarded: number };
  subscriptions: { active: number; mrr_ngn: number };
  estimates: {
    clv_ngn: number;
    avg_orders_per_customer: number;
    churn_rate_pct: number;
    churn_basis: string;
  };
}

export interface LoyaltyTier {
  tier_id: string;
  tier_key: string;
  tier_name: string;
  min_lifetime_points: number;
  max_lifetime_points: number | null;
  earning_multiplier: number;
  benefits: Record<string, unknown>;
  colour: string;
  display_order: number;
  is_active: boolean;
}

export interface Coupon {
  coupon_id: string;
  coupon_code: string;
  display_name: string;
  discount_type: string;
  discount_value: number;
  is_active: boolean;
  total_redeemed: number;
  valid_to: string | null;
}

export interface SubscriptionPlan {
  plan_id: string;
  plan_key: string;
  display_name: string;
  billing_cycle: string;
  price_ngn: number;
  units_per_cycle: number;
  is_active: boolean;
}

export interface BundleOffer {
  bundle_id: string;
  bundle_code: string;
  display_name: string;
  pricing_model: string;
  is_active: boolean;
  is_visible_storefront: boolean;
}

export interface MaintenancePlan {
  plan_id: string;
  plan_key: string;
  display_name: string;
  description: string | null;
  billing_cycle: "monthly" | "quarterly" | "semi_annual" | "annual";
  price_ngn: number;
  extra_service_discount_pct: number | null;
  is_active: boolean;
  display_order: number;
}

export interface MaintenanceSubscription {
  subscription_id: string;
  subscription_number: string;
  plan_name: string;
  contact_name: string | null;
  first_name: string | null;
  status: string;
  total_visits: number;
  next_billing_at: string | null;
}

// ════════════════════════════════════════════════════════════
// Strategies
// ════════════════════════════════════════════════════════════

export function useStrategyCatalogue() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "strategy-catalogue", brand],
    queryFn: () => api.get<Catalogue>("/retention/strategies/catalogue"),
    staleTime: 5 * 60_000,
  });
}

export function useStrategies(status?: string) {
  const brand = useBrand();
  const qs = status ? `?status=${status}` : "";
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "strategies", brand, status ?? "all"],
    queryFn: () => api.get<Strategy[]>(`/retention/strategies${qs}`),
    staleTime: 20_000,
  });
}

export function useStrategy(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["retention", "strategy", brand, id],
    queryFn: () => api.get<Strategy>(`/retention/strategies/${id}`),
  });
}

export function useCreateStrategy() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: Partial<Strategy> & { steps?: StrategyStep[] }) =>
      api.post<Strategy>("/retention/strategies", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retention", "strategies", brand] }),
  });
}

export function useCreateFromTemplate() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: { template_key: string; overrides?: Record<string, string> }) =>
      api.post<Strategy>("/retention/strategies/from-template", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retention", "strategies", brand] }),
  });
}

export function useUpdateStrategy(id: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (patch: Partial<Strategy> & { steps?: StrategyStep[] }) =>
      api.patch<Strategy>(`/retention/strategies/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retention", "strategies", brand] });
      qc.invalidateQueries({ queryKey: ["retention", "strategy", brand, id] });
    },
  });
}

export function useSetStrategyStatus() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; status: StrategyStatus }) =>
      api.patch<Strategy>(`/retention/strategies/${args.id}/status`, { status: args.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retention", "strategies", brand] }),
  });
}

export function usePreviewStrategy(id: string | undefined) {
  return useMutation({
    mutationFn: (contact_id?: string) =>
      api.post<StrategyPreview>(`/retention/strategies/${id}/preview`, { contact_id }),
  });
}

export function useTestSendStrategy(id: string | undefined) {
  return useMutation({
    mutationFn: (step_order?: number) =>
      api.post<{ sent_to: string; subject: string }>(
        `/retention/strategies/${id}/test-send`,
        { step_order },
      ),
  });
}

// ════════════════════════════════════════════════════════════
// Rewards
// ════════════════════════════════════════════════════════════

export function useRewards() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "rewards", brand],
    queryFn: () => api.get<Reward[]>("/retention/rewards"),
    staleTime: 30_000,
  });
}

export function useSaveReward() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id?: string; body: Partial<Reward> }) =>
      args.id
        ? api.patch<Reward>(`/retention/rewards/${args.id}`, args.body)
        : api.post<Reward>("/retention/rewards", args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retention", "rewards", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Earn rules
// ════════════════════════════════════════════════════════════

export function useEarnRules() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "earn-rules", brand],
    queryFn: () => api.get<EarnRule[]>("/retention/earn-rules"),
    staleTime: 30_000,
  });
}

export function useSaveEarnRule() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id?: string; body: Partial<EarnRule> }) =>
      args.id
        ? api.patch<EarnRule>(`/retention/earn-rules/${args.id}`, args.body)
        : api.post<EarnRule>("/retention/earn-rules", args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retention", "earn-rules", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Referral programme
// ════════════════════════════════════════════════════════════

export function useReferralSettings() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "referral-settings", brand],
    queryFn: () => api.get<ReferralSettings | null>("/retention/referral-program/settings"),
    staleTime: 60_000,
  });
}

export function useSaveReferralSettings() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (patch: Partial<ReferralSettings>) =>
      api.put<ReferralSettings>("/retention/referral-program/settings", patch),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["retention", "referral-settings", brand] }),
  });
}

export function useReferralTiers() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "referral-tiers", brand],
    queryFn: () => api.get<ReferralTier[]>("/retention/referral-program/tiers"),
    staleTime: 60_000,
  });
}

export function useSaveReferralTier() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id?: string; body: Partial<ReferralTier> }) =>
      args.id
        ? api.patch<ReferralTier>(`/retention/referral-program/tiers/${args.id}`, args.body)
        : api.post<ReferralTier>("/retention/referral-program/tiers", args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retention", "referral-tiers", brand] }),
  });
}

export function useDeleteReferralTier() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<unknown>(`/retention/referral-program/tiers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retention", "referral-tiers", brand] }),
  });
}

export function useReferralDashboard() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "referral-dashboard", brand],
    queryFn: () => api.get<ReferralDashboard>("/retention/referral-program/dashboard"),
    staleTime: 60_000,
  });
}

// ════════════════════════════════════════════════════════════
// Analytics
// ════════════════════════════════════════════════════════════

export function useRetentionAnalytics(windowDays = 90) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "analytics", brand, windowDays],
    queryFn: () =>
      api.get<RetentionAnalytics>(`/retention/analytics?window_days=${windowDays}`),
    staleTime: 60_000,
  });
}

// ════════════════════════════════════════════════════════════
// Loyalty / coupons / subscriptions / bundles (existing resources)
// ════════════════════════════════════════════════════════════

export function useLoyaltyTiers() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "loyalty-tiers", brand],
    queryFn: () => api.get<LoyaltyTier[]>("/retention/loyalty/tiers"),
    staleTime: 60_000,
  });
}

export function useSaveLoyaltyTier() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id?: string; body: Partial<LoyaltyTier> }) =>
      args.id
        ? api.patch<LoyaltyTier>(`/retention/loyalty/tiers/${args.id}`, args.body)
        : api.post<LoyaltyTier>("/retention/loyalty/tiers", args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retention", "loyalty-tiers", brand] }),
  });
}

export function useMaintenancePlans() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "maintenance-plans", brand],
    queryFn: () => api.get<MaintenancePlan[]>("/retention/maintenance/plans"),
    staleTime: 60_000,
  });
}

export function useMaintenanceSubscriptions() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "maintenance-subs", brand],
    queryFn: () => api.get<MaintenanceSubscription[]>("/retention/maintenance/subscriptions"),
    staleTime: 60_000,
  });
}

export function useSaveMaintenancePlan() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id?: string; body: Partial<MaintenancePlan> }) =>
      args.id
        ? api.patch<MaintenancePlan>(`/retention/maintenance/plans/${args.id}`, args.body)
        : api.post<MaintenancePlan>("/retention/maintenance/plans", args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retention", "maintenance-plans", brand] }),
  });
}

export function useCoupons() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "coupons", brand],
    queryFn: async () => {
      const r = await api.get<Coupon[] | { data: Coupon[] }>("/retention/coupons");
      return Array.isArray(r) ? r : (r?.data ?? []);
    },
    staleTime: 30_000,
  });
}

export function useSaveCoupon() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id?: string; body: Record<string, unknown> }) =>
      args.id
        ? api.patch<Coupon>(`/retention/coupons/${args.id}`, args.body)
        : api.post<Coupon>("/retention/coupons", args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retention", "coupons", brand] }),
  });
}

export function useSubscriptionPlans() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "sub-plans", brand],
    queryFn: () => api.get<SubscriptionPlan[]>("/retention/subscriptions/plans"),
    staleTime: 60_000,
  });
}

export function useBundles() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["retention", "bundles", brand],
    queryFn: async () => {
      const r = await api.get<BundleOffer[] | { data: BundleOffer[] }>("/retention/bundles");
      return Array.isArray(r) ? r : (r?.data ?? []);
    },
    staleTime: 60_000,
  });
}

// ════════════════════════════════════════════════════════════
// Presentation helpers
// ════════════════════════════════════════════════════════════

export const STRATEGY_STATUS_TONE: Record<StrategyStatus, Tone> = {
  draft: "neutral",
  active: "success",
  paused: "warn",
  archived: "neutral",
};

export function waitLabel(minutes: number): string {
  if (!minutes) return "immediately";
  if (minutes % 1440 === 0) return `${minutes / 1440}d later`;
  if (minutes % 60 === 0) return `${minutes / 60}h later`;
  return `${minutes}m later`;
}
