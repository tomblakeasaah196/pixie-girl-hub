import { api } from "@/lib/api";
import type {
  PricingRule,
  PriceFloor,
  CreateRuleInput,
  UpdateRuleInput,
  CreateFloorInput,
  Scenario,
  ScenarioResultResponse,
  CreateScenarioInput,
  ComputeScenarioInput,
  Proposal,
  CreateProposalInput,
  PaginatedResponse,
} from "./types";

const BASE = "/api/v1/pricing"; // Corrected base path

// ── Rules ─────────────────────────────────────────────────────────────
export function listRules(params?: { channel?: string; is_active?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.channel) qs.set("channel", params.channel);
  if (params?.is_active !== undefined) qs.set("is_active", String(params.is_active));
  const q = qs.toString();
  return api.get<PaginatedResponse<PricingRule>>(`${BASE}/rules${q ? `?${q}` : ""}`);
}

export function createRule(input: CreateRuleInput) {
  return api.post<PricingRule>(`${BASE}/rules`, input);
}

export function updateRule(id: string, input: UpdateRuleInput) {
  return api.patch<PricingRule>(`${BASE}/rules/${id}`, input);
}

export function deactivateRule(id: string) {
  return api.delete(`${BASE}/rules/${id}`);
}

// ── Floors ────────────────────────────────────────────────────────────
export function listFloors(params?: { variant_id?: string }) {
  const qs = new URLSearchParams();
  if (params?.variant_id) qs.set("variant_id", params.variant_id);
  const q = qs.toString();
  return api.get<PaginatedResponse<PriceFloor>>(`${BASE}/floors${q ? `?${q}` : ""}`);
}

export function createFloor(input: CreateFloorInput) {
  return api.post<PriceFloor>(`${BASE}/floors`, input);
}

export function removeFloor(id: string) {
  return api.delete(`${BASE}/floors/${id}`);
}

// ── Scenarios ─────────────────────────────────────────────────────────
export function listScenarios(params?: { status?: string }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  const q = qs.toString();
  return api.get<PaginatedResponse<Scenario>>(`${BASE}/scenarios${q ? `?${q}` : ""}`);
}

export function createScenario(input: CreateScenarioInput) {
  return api.post<Scenario>(`${BASE}/scenarios`, input);
}

export function computeScenario(id: string, input: ComputeScenarioInput = {}) {
  return api.post<ScenarioResultResponse>(`${BASE}/scenarios/${id}/compute`, input);
}

export function getScenario(id: string) {
  return api.get<ScenarioResultResponse>(`${BASE}/scenarios/${id}`);
}

// ── Proposals ─────────────────────────────────────────────────────────
export function listProposals(params?: { status?: string }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  const q = qs.toString();
  return api.get<PaginatedResponse<Proposal>>(`${BASE}/proposals${q ? `?${q}` : ""}`);
}

export function createProposal(input: CreateProposalInput) {
  return api.post<Proposal>(`${BASE}/proposals`, input);
}

export function approveProposal(id: string) {
  return api.post<Proposal>(`${BASE}/proposals/${id}/approve`);
}

export function rejectProposal(id: string, reason: string) {
  return api.post<Proposal>(`${BASE}/proposals/${id}/reject`, { reason });
}

export function revertProposal(id: string, reason: string) {
  return api.post<Proposal>(`${BASE}/proposals/${id}/revert`, { reason });
}
