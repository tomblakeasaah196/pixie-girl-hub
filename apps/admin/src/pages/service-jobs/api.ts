/**
 * NOTE on response typing: the api client (lib/api.ts) auto-unwraps bare
 * `{data: X}` payloads to `X`, and only preserves envelopes that carry `meta`
 * (paginated lists). So every type parameter below is the INNER value — never
 * `{data: X}`. Typing the envelope here silently breaks consumers: the hooks'
 * old `select: r => r.data` on already-unwrapped values returned undefined,
 * which is exactly the bug that blinded the whole Studio board.
 */
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
  JobMaterial,
  JobReference,
  JobTimeLog,
  Accountability,
  CustodyEntry,
  QcInput,
} from "./types";

const BASE = "/service-jobs";

// ── Service types ──────────────────────────────────────────

export function listServiceTypes(params?: { is_active?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.is_active !== undefined)
    qs.set("is_active", String(params.is_active));
  const q = qs.toString();
  return api.get<ServiceType[]>(`${BASE}/types${q ? `?${q}` : ""}`);
}

export function createServiceType(input: {
  service_key: string;
  display_name: string;
  description?: string;
  standard_cost_ngn?: number;
  standard_turnaround_days?: number;
  display_order?: number;
}) {
  return api.post<ServiceType>(`${BASE}/types`, input);
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
  return api.patch<ServiceType>(`${BASE}/types/${id}`, patch);
}

// ── Chemical recipes ───────────────────────────────────────

export function listRecipes(params?: { is_active?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.is_active !== undefined)
    qs.set("is_active", String(params.is_active));
  const q = qs.toString();
  return api.get<ChemicalRecipe[]>(
    `${BASE}/recipes${q ? `?${q}` : ""}`,
  );
}

export function getRecipe(id: string) {
  return api.get<ChemicalRecipe>(`${BASE}/recipes/${id}`);
}

export function createRecipe(input: CreateRecipeInput) {
  return api.post<ChemicalRecipe>(`${BASE}/recipes`, input);
}

export function updateRecipe(id: string, patch: Partial<CreateRecipeInput>) {
  return api.patch<ChemicalRecipe>(`${BASE}/recipes/${id}`, patch);
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
  if (params?.assigned_staff_user_id)
    qs.set("assigned_staff_user_id", params.assigned_staff_user_id);
  if (params?.assigned_stylist_id)
    qs.set("assigned_stylist_id", params.assigned_stylist_id);
  if (params?.customer_contact_id)
    qs.set("customer_contact_id", params.customer_contact_id);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.page_size) qs.set("page_size", String(params.page_size));
  const q = qs.toString();
  return api.get<JobPaginated>(`${BASE}${q ? `?${q}` : ""}`);
}

export function getJob(id: string) {
  return api.get<ServiceJob>(`${BASE}/${id}`);
}

export function createJob(input: CreateJobInput) {
  return api.post<ServiceJob>(BASE, input);
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
  return api.patch<ServiceJob>(`${BASE}/${id}`, patch);
}

export function advanceJob(
  id: string,
  status: string,
  actual_cost_ngn?: number,
) {
  return api.post<ServiceJob>(`${BASE}/${id}/advance`, {
    status,
    actual_cost_ngn,
  });
}

export function assignStaff(id: string, assigned_staff_user_id: string) {
  return api.post<ServiceJob>(`${BASE}/${id}/assign`, {
    assigned_staff_user_id,
  });
}

// Options for the drawer's stylist picker: staff whose job_title contains
// "stylist" in the current brand, with live workload + leave state. Backed
// by GET /service-jobs/stylists; small list (no pagination).
export interface AssignableStylist {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string;
  open_jobs_count: number;
  on_leave_today: boolean;
}
export function listAssignableStylists() {
  return api.get<AssignableStylist[]>(`${BASE}/stylists`);
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
  return api.post<ServiceJob>(`${BASE}/${id}/outcome`, input);
}

// ── Job chemicals ──────────────────────────────────────────

export function listJobChemicals(jobId: string) {
  return api.get<JobChemical[]>(`${BASE}/${jobId}/chemicals`);
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
  return api.post<JobChemical>(`${BASE}/${jobId}/chemicals`, input);
}

// ── Chemical reconciliation ────────────────────────────────

export function listReconciliations(params?: {
  fiscal_period_id?: string;
  variance_status?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.fiscal_period_id)
    qs.set("fiscal_period_id", params.fiscal_period_id);
  if (params?.variance_status)
    qs.set("variance_status", params.variance_status);
  const q = qs.toString();
  return api.get<ChemicalReconciliation[]>(
    `${BASE}/chemical-reconciliations${q ? `?${q}` : ""}`,
  );
}

export function runReconciliation(periodId: string) {
  return api.post<{ reconciled: number; flagged: number }>(
    `${BASE}/periods/${periodId}/chemical-reconciliation`,
  );
}

// ── Stylist Studio lifecycle (PR4) ─────────────────────────

export function startJob(id: string) {
  return api.post<ServiceJob>(`${BASE}/${id}/start`, {});
}
export function pauseJob(id: string) {
  return api.post<ServiceJob>(`${BASE}/${id}/pause`, {});
}
export function resumeJob(id: string) {
  return api.post<ServiceJob>(`${BASE}/${id}/resume`, {});
}
export function returnJob(id: string) {
  return api.post<ServiceJob>(`${BASE}/${id}/return`, {});
}
export function qcJob(id: string, input: QcInput) {
  return api.post<ServiceJob>(`${BASE}/${id}/qc`, input);
}
export function dispatchJob(id: string) {
  return api.post<ServiceJob>(`${BASE}/${id}/dispatch`, {});
}
export function handToSales(id: string) {
  return api.post<ServiceJob>(`${BASE}/${id}/hand-to-sales`, {});
}
export function linkIntercompany(id: string, ic_transaction_id: string) {
  return api.post<ServiceJob>(`${BASE}/${id}/intercompany-link`, {
    ic_transaction_id,
  });
}
export function writeOffWig(id: string, reason: string) {
  return api.post<CustodyEntry>(`${BASE}/${id}/write-off`, {
    reason,
  });
}

// ── Materials / references / time logs ─────────────────────

export function listMaterials(jobId: string) {
  return api.get<JobMaterial[]>(`${BASE}/${jobId}/materials`);
}
export function logMaterial(
  jobId: string,
  input: {
    kind: "discrete" | "chemical";
    variant_id?: string;
    quantity?: number;
    chemical_name?: string;
    usage_note?: string;
  },
) {
  return api.post<JobMaterial[]>(`${BASE}/${jobId}/materials`, input);
}
export function listReferences(jobId: string) {
  return api.get<JobReference[]>(`${BASE}/${jobId}/references`);
}
export function addReference(
  jobId: string,
  input: {
    ref_type: "image" | "audio" | "video_link" | "text" | "creative_freedom";
    doc_id?: string;
    url?: string;
    body?: string;
  },
) {
  return api.post<JobReference[]>(
    `${BASE}/${jobId}/references`,
    input,
  );
}
export function deleteReference(jobId: string, refId: string) {
  return api.delete<JobReference[]>(
    `${BASE}/${jobId}/references/${refId}`,
  );
}
export function listTimeLogs(jobId: string) {
  return api.get<JobTimeLog[]>(`${BASE}/${jobId}/time-logs`);
}

// ── Wig accountability ─────────────────────────────────────

export function getAccountability() {
  return api.get<Accountability>(`${BASE}/accountability`);
}
export function listCustodyLedger(params?: {
  job_id?: string;
  stylist_user_id?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.job_id) qs.set("job_id", params.job_id);
  if (params?.stylist_user_id)
    qs.set("stylist_user_id", params.stylist_user_id);
  const q = qs.toString();
  return api.get<CustodyEntry[]>(
    `${BASE}/accountability/ledger${q ? `?${q}` : ""}`,
  );
}
