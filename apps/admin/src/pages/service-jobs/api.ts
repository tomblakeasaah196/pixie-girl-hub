import { api } from "@/lib/api";
import type {
  ServiceType,
  ChemicalRecipe,
  ServiceJob,
  JobPaginated,
  JobChemical,
  ChemicalReconciliation,
  CreateJobInput,
  CreateRecipeInput,
} from "./types";

const BASE = "/service-jobs";

// ── Service types ──────────────────────────────────────────

export function listServiceTypes(params?: { is_active?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.is_active !== undefined) qs.set("is_active", String(params.is_active));
  const q = qs.toString();
  return api.get<{ data: ServiceType[] }>(`${BASE}/types${q ? `?${q}` : ""}`);
}

export function createServiceType(input: {
  service_key: string;
  display_name: string;
  description?: string;
  standard_cost_ngn?: number;
  standard_turnaround_days?: number;
  display_order?: number;
}) {
  return api.post<{ data: ServiceType }>(`${BASE}/types`, input);
}

export function updateServiceType(
  id: string,
  patch: Partial<{
    display_name: string;
    description: string;
    standard_cost_ngn: number;
    standard_turnaround_days: number;
    display_order: number;
    is_active: boolean;
  }>,
) {
  return api.patch<{ data: ServiceType }>(`${BASE}/types/${id}`, patch);
}

// ── Chemical recipes ───────────────────────────────────────

export function listRecipes(params?: { is_active?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.is_active !== undefined) qs.set("is_active", String(params.is_active));
  const q = qs.toString();
  return api.get<{ data: ChemicalRecipe[] }>(`${BASE}/recipes${q ? `?${q}` : ""}`);
}

export function getRecipe(id: string) {
  return api.get<{ data: ChemicalRecipe }>(`${BASE}/recipes/${id}`);
}

export function createRecipe(input: CreateRecipeInput) {
  return api.post<{ data: ChemicalRecipe }>(`${BASE}/recipes`, input);
}

export function updateRecipe(id: string, patch: Partial<CreateRecipeInput>) {
  return api.patch<{ data: ChemicalRecipe }>(`${BASE}/recipes/${id}`, patch);
}

// ── Jobs ───────────────────────────────────────────────────

export function listJobs(params?: {
  status?: string;
  assigned_staff_user_id?: string;
  assigned_stylist_id?: string;
  customer_contact_id?: string;
  page?: number;
  page_size?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.assigned_staff_user_id) qs.set("assigned_staff_user_id", params.assigned_staff_user_id);
  if (params?.assigned_stylist_id) qs.set("assigned_stylist_id", params.assigned_stylist_id);
  if (params?.customer_contact_id) qs.set("customer_contact_id", params.customer_contact_id);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.page_size) qs.set("page_size", String(params.page_size));
  const q = qs.toString();
  return api.get<JobPaginated>(`${BASE}${q ? `?${q}` : ""}`);
}

export function getJob(id: string) {
  return api.get<{ data: ServiceJob }>(`${BASE}/${id}`);
}

export function createJob(input: CreateJobInput) {
  return api.post<{ data: ServiceJob }>(BASE, input);
}

export function updateJob(
  id: string,
  patch: Partial<{
    hair_variant_id: string;
    hair_unit_id: string;
    hair_description: string;
    assigned_stylist_id: string;
    specification: Record<string, unknown>;
    recipe_id: string;
    recipe_override: Record<string, unknown>;
    scheduled_for: string;
    expected_completion_at: string;
    agreed_cost_ngn: number;
  }>,
) {
  return api.patch<{ data: ServiceJob }>(`${BASE}/${id}`, patch);
}

export function advanceJob(id: string, status: string, actual_cost_ngn?: number) {
  return api.post<{ data: ServiceJob }>(`${BASE}/${id}/advance`, { status, actual_cost_ngn });
}

export function assignStaff(id: string, assigned_staff_user_id: string) {
  return api.post<{ data: ServiceJob }>(`${BASE}/${id}/assign`, { assigned_staff_user_id });
}

export function recordOutcome(
  id: string,
  input: {
    quality_rating?: number;
    quality_notes?: string;
    customer_rating?: number;
    customer_feedback?: string;
  },
) {
  return api.post<{ data: ServiceJob }>(`${BASE}/${id}/outcome`, input);
}

// ── Job chemicals ──────────────────────────────────────────

export function listJobChemicals(jobId: string) {
  return api.get<{ data: JobChemical[] }>(`${BASE}/${jobId}/chemicals`);
}

export function recordJobChemical(
  jobId: string,
  input: {
    chemical_name: string;
    chemical_brand?: string;
    variant_id?: string;
    qty_used: number;
    unit: string;
    cost_ngn?: number;
    notes?: string;
  },
) {
  return api.post<{ data: JobChemical }>(`${BASE}/${jobId}/chemicals`, input);
}

// ── Chemical reconciliation ────────────────────────────────

export function listReconciliations(params?: {
  fiscal_period_id?: string;
  variance_status?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.fiscal_period_id) qs.set("fiscal_period_id", params.fiscal_period_id);
  if (params?.variance_status) qs.set("variance_status", params.variance_status);
  const q = qs.toString();
  return api.get<{ data: ChemicalReconciliation[] }>(`${BASE}/chemical-reconciliations${q ? `?${q}` : ""}`);
}

export function runReconciliation(periodId: string) {
  return api.post<{ data: { reconciled: number; flagged: number } }>(
    `${BASE}/periods/${periodId}/chemical-reconciliation`,
  );
}
