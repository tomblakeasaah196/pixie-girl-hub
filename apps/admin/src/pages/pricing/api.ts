import { api } from "@/lib/api";
import type {
  ApplyInput,
  ApplyResult,
  CreateFloorInput,
  CreateOverrideInput,
  CreateProposalInput,
  CreateRuleInput,
  CreateScenarioInput,
  ComputeSliderInput,
  Floor,
  HistoryRow,
  Override,
  PricingConfig,
  Proposal,
  ProposalDetail,
  Recommendation,
  RecommendInput,
  Rule,
  Scenario,
  ScenarioDetail,
  UpdateConfigInput,
  UpdateRuleInput,
} from "./types";

const BASE = "/pricing";

function qs(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (!parts.length) return "";
  return (
    "?" +
    parts.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&")
  );
}

// ── Advisor ──────────────────────────────────────────────────────────────────
export const recommend = (input: RecommendInput) =>
  api.post<Recommendation>(`${BASE}/recommend`, input);

export const applyPrice = (input: ApplyInput) =>
  api.post<ApplyResult>(`${BASE}/apply`, input);

export const getConfig = () => api.get<PricingConfig>(`${BASE}/config`);

export const updateConfig = (input: UpdateConfigInput) =>
  api.put<PricingConfig>(`${BASE}/config`, input);

export const setVariantUsd = (variantId: string, priceUsd: number | null) =>
  api.put<{ variant_id: string; price_usd: number | null }>(
    `${BASE}/variants/${variantId}/usd`,
    { price_usd: priceUsd },
  );

// ── Scenarios ────────────────────────────────────────────────────────────────
export const listScenarios = (status?: string) =>
  api.get<Scenario[]>(`${BASE}/scenarios${qs({ status })}`);

export const getScenario = (id: string) =>
  api.get<ScenarioDetail>(`${BASE}/scenarios/${id}`);

export const createScenario = (input: CreateScenarioInput) =>
  api.post<Scenario>(`${BASE}/scenarios`, input);

export const computeScenario = (id: string, sliders?: ComputeSliderInput[]) =>
  api.post<Scenario & { results_count: number }>(
    `${BASE}/scenarios/${id}/compute`,
    { sliders },
  );

// ── Proposals ────────────────────────────────────────────────────────────────
export const listProposals = (status?: string) =>
  api.get<Proposal[]>(`${BASE}/proposals${qs({ status })}`);

export const getProposal = (id: string) =>
  api.get<ProposalDetail>(`${BASE}/proposals/${id}`);

export const createProposal = (input: CreateProposalInput) =>
  api.post<Proposal>(`${BASE}/proposals`, input);

export const approveProposal = (id: string) =>
  api.post<Proposal & { applied?: boolean }>(`${BASE}/proposals/${id}/approve`);

export const rejectProposal = (id: string, reason?: string) =>
  api.post<Proposal>(`${BASE}/proposals/${id}/reject`, { reason });

export const revertProposal = (id: string, reason?: string) =>
  api.post<Proposal & { reverted?: boolean }>(
    `${BASE}/proposals/${id}/revert`,
    { reason },
  );

// ── Rules ────────────────────────────────────────────────────────────────────
export const listRules = (params?: { channel?: string; is_active?: boolean }) =>
  api.get<Rule[]>(
    `${BASE}/rules${qs({
      channel: params?.channel,
      is_active:
        params?.is_active === undefined ? undefined : String(params.is_active),
    })}`,
  );

export const createRule = (input: CreateRuleInput) =>
  api.post<Rule>(`${BASE}/rules`, input);

export const updateRule = (id: string, input: UpdateRuleInput) =>
  api.patch<Rule>(`${BASE}/rules/${id}`, input);

export const deleteRule = (id: string) =>
  api.delete<void>(`${BASE}/rules/${id}`);

// ── Floors ───────────────────────────────────────────────────────────────────
export const listFloors = (variantId?: string) =>
  api.get<Floor[]>(`${BASE}/floors${qs({ variant_id: variantId })}`);

export const createFloor = (input: CreateFloorInput) =>
  api.post<Floor>(`${BASE}/floors`, input);

export const deleteFloor = (id: string) =>
  api.delete<void>(`${BASE}/floors/${id}`);

// ── Overrides ────────────────────────────────────────────────────────────────
export const listOverrides = (variantId?: string) =>
  api.get<Override[]>(`${BASE}/overrides${qs({ variant_id: variantId })}`);

export const createOverride = (input: CreateOverrideInput) =>
  api.post<Override>(`${BASE}/overrides`, input);

export const deleteOverride = (id: string) =>
  api.delete<void>(`${BASE}/overrides/${id}`);

// ── History ──────────────────────────────────────────────────────────────────
export const getHistory = (variantId: string) =>
  api.get<HistoryRow[]>(`${BASE}/history/${variantId}`);
