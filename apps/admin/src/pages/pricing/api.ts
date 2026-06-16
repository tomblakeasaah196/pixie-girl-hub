import { api } from "@/lib/api";
import type {
  PricingRule,
  PriceFloor,
  ScenarioResult,
  ScenarioComputeInput,
  Proposal,
  CreateRuleInput,
  UpdateRuleInput,
  CreateFloorInput,
  UpdateFloorInput,
  CreateProposalInput,
  PaginatedResponse,
} from "./types";

const BASE = "/pricing";

// ── Pricing Rules ─────────────────────────────────────────────────────────────

export function listRules(params?: { page?: number; page_size?: number; is_active?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.page_size) qs.set("page_size", String(params.page_size));
  if (params?.is_active !== undefined) qs.set("is_active", String(params.is_active));
  const q = qs.toString();
  return api.get<PaginatedResponse<PricingRule>>(`${BASE}/rules${q ? `?${q}` : ""}`);
}

export function getRule(id: string) {
  return api.get<PricingRule>(`${BASE}/rules/${id}`);
}

export function createRule(input: CreateRuleInput) {
  return api.post<PricingRule>(`${BASE}/rules`, input);
}

export function updateRule(id: string, input: UpdateRuleInput) {
  return api.patch<PricingRule>(`${BASE}/rules/${id}`, input);
}

// ── Price Floors ──────────────────────────────────────────────────────────────

export function listFloors(params?: { page?: number; page_size?: number }) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.page_size) qs.set("page_size", String(params.page_size));
  const q = qs.toString();
  return api.get<PaginatedResponse<PriceFloor>>(`${BASE}/floors${q ? `?${q}` : ""}`);
}

export function createFloor(input: CreateFloorInput) {
  return api.post<PriceFloor>(`${BASE}/floors`, input);
}

export function updateFloor(id: string, input: UpdateFloorInput) {
  return api.patch<PriceFloor>(`${BASE}/floors/${id}`, input);
}

// ── Scenario Computation ──────────────────────────────────────────────────────

export function computeScenario(input: ScenarioComputeInput) {
  return api.post<ScenarioResult>(`${BASE}/scenarios/compute`, input);
}

// ── Pricing Proposals ─────────────────────────────────────────────────────────

export function listProposals(params?: {
  page?: number;
  page_size?: number;
  status?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.page_size) qs.set("page_size", String(params.page_size));
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

export function revertProposal(id: string) {
  return api.post<Proposal>(`${BASE}/proposals/${id}/revert`);
}
