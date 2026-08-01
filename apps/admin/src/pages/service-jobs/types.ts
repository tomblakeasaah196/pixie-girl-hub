export type JobStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "on_hold"
  | "returned_for_qc"
  | "qc_passed"
  | "rework"
  | "ready_for_dispatch"
  | "handed_to_sales"
  | "completed"
  | "rejected"
  | "cancelled";

export type VarianceStatus = "normal" | "flagged" | "investigated" | "resolved";

export interface ServiceType {
  service_type_id: string;
  service_key: string;
  display_name: string;
  description: string | null;
  standard_cost_ngn: string | null;
  standard_turnaround_days: number | null;
  default_account_id: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Ingredient {
  chemical_name: string;
  brand?: string;
  sku?: string;
  qty_ml?: number;
  qty_g?: number;
  role?: string;
}

export interface ChemicalRecipe {
  recipe_id: string;
  recipe_key: string;
  display_name: string;
  ingredients: Ingredient[];
  instructions: string | null;
  target_shade: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceJob {
  job_id: string;
  job_number: string;
  service_type_id: string;
  service_type_name?: string;
  service_key?: string;
  assigned_stylist_id: string | null;
  assigned_staff_user_id: string | null;
  // Joined display name of the assigned staff member (from the list / getJob
  // query) so job cards read "who has it", not a UUID or a generic label.
  assigned_staff_name?: string | null;
  hair_variant_id: string | null;
  hair_unit_id: string | null;
  hair_description: string | null;
  sales_order_id: string | null;
  sales_order_line_id: string | null;
  sales_order_number: string | null;
  customer_contact_id: string | null;
  intercompany_transaction_id: string | null;
  is_intercompany: boolean;
  specification: Record<string, unknown> | null;
  recipe_id: string | null;
  recipe_override: Record<string, unknown> | null;
  status: JobStatus;
  scheduled_for: string | null;
  expected_completion_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  agreed_cost_ngn: string | null;
  actual_cost_ngn: string | null;
  quality_rating: number | null;
  quality_notes: string | null;
  customer_rating: number | null;
  customer_feedback: string | null;
  before_photo_doc_ids: string[];
  after_photo_doc_ids: string[];
  task_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // ── Stylist Studio (PR2/PR4) ──────────────────────────────
  assigned_at: string | null;
  returned_at: string | null;
  qc_at: string | null;
  ready_at: string | null;
  handed_at: string | null;
  qc_by: string | null;
  rework_count: number;
  reserved_variant_id: string | null;
  sla_due_at: string | null;
  styled_id: string | null;
  shipment_id: string | null;
  customer_asset_id: string | null;
  // Hand-off tag written on the physical wig/hair, e.g. "342NS" (3-digit
  // counter + 2 initials from the styled product name). Allocated once, at
  // first assignment (see fn_next_stylist_tag + deriveTagInitials).
  tag_code: string | null;
  // ── Rich identity/context — from getJob join (PR: drawer enrichment) ──
  // Customer NAME ONLY — never phone/email; stylists don't get contact
  // details.
  customer_name?: string | null;
  order_placed_at?: string | null;
  base_product_name?: string | null;
  styled_product_name?: string | null;
  styled_product_image_url?: string | null;
  // Currently-out wig custody timestamp (null once returned/dispatched/
  // written off, or if this job never had a wig taken out).
  wig_out_at?: string | null;
  materials_cost_ngn?: string | null;
  chemicals_cost_ngn?: string | null;
  // Present only on the response from POST /:id/assign — true when this call
  // allocated a brand-new tag_code (first assignment), false on reassignment.
  is_new_tag?: boolean;
  // ── Intercompany Flow-1 (FLH styles PXG's hair) — from getJob join ──
  intercompany_number?: string | null;
  intercompany_seller_doc?: string | null;
  intercompany_seller_brand?: string | null;
  intercompany_buyer_brand?: string | null;
  intercompany_status?: string | null;
  intercompany_amount_ngn?: string | null;
}

// {data, meta} pagination envelope. The api client auto-unwraps bare {data}
// responses but preserves envelopes with `meta` — so this shape survives the
// client intact (the old flat {data, page, total} shape did not).
export interface JobPaginated {
  data: ServiceJob[];
  meta: { page: number; page_size: number; total: number; has_more: boolean };
}

export interface JobChemical {
  consumption_id: string;
  job_id: string;
  chemical_name: string;
  chemical_brand: string | null;
  variant_id: string | null;
  qty_used: number;
  unit: string;
  cost_ngn: string | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
}

export interface ChemicalReconciliation {
  reconciliation_id: string;
  fiscal_period_id: string;
  chemical_name: string;
  unit: string;
  qty_purchased: number;
  qty_consumed: number;
  qty_disposed: number;
  qty_variance: number;
  variance_value_ngn: string | null;
  variance_status: VarianceStatus;
  investigation_notes: string | null;
  computed_at: string;
}

export interface CreateJobInput {
  service_type_id: string;
  hair_variant_id?: string;
  hair_unit_id?: string;
  hair_description?: string;
  sales_order_id?: string;
  sales_order_line_id?: string;
  customer_contact_id?: string;
  assigned_staff_user_id?: string;
  assigned_stylist_id?: string;
  recipe_id?: string;
  specification?: Record<string, unknown>;
  scheduled_for?: string;
  expected_completion_at?: string;
  agreed_cost_ngn?: number;
  is_intercompany?: boolean;
  intercompany_transaction_id?: string;
  // Customer's style brief — a note and/or an inspiration link. Captured at
  // creation and locked (read-only thereafter; stylists add notes on top).
  brief?: { body?: string; url?: string };
}

export interface CreateRecipeInput {
  recipe_key: string;
  display_name: string;
  ingredients: Ingredient[];
  instructions?: string;
  target_shade?: string;
  notes?: string;
  is_active?: boolean;
}

// ── Stylist Studio: materials / references / time / custody (PR4) ──

export type MaterialKind = "discrete" | "chemical";

export interface JobMaterial {
  material_id: string;
  job_id: string;
  kind: MaterialKind;
  variant_id: string | null;
  quantity: string | null;
  chemical_name: string | null;
  usage_note: string | null;
  stock_deducted: boolean;
  stock_movement_id: string | null;
  logged_by: string | null;
  created_at: string;
}

export type ReferenceType =
  | "image"
  | "audio"
  | "video_link"
  | "text"
  | "creative_freedom";

export interface JobReference {
  reference_id: string;
  job_id: string;
  ref_type: ReferenceType;
  doc_id: string | null;
  url: string | null;
  body: string | null;
  created_by: string | null;
  created_at: string;
  // true = the customer's original brief, captured at job open and not
  // editable/deletable. false = a supplementary stylist/QC note.
  is_locked: boolean;
}

export interface JobTimeLog {
  log_id: string;
  job_id: string;
  stylist_user_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  note: string | null;
  created_at: string;
}

export type CustodyEvent = "out" | "return" | "dispatched" | "write_off";

export interface CustodyEntry {
  entry_id: string;
  job_id: string | null;
  event: CustodyEvent;
  quantity: number;
  stylist_user_id: string | null;
  location: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface StylistBalance {
  stylist_user_id: string;
  stylist_name: string | null;
  holding: number;
}

export interface OverdueWig {
  job_id: string;
  job_number: string | null;
  stylist_user_id: string | null;
  stylist_name: string | null;
  out_at: string;
  days_out: number;
}

export interface Accountability {
  threshold_days: number;
  balances: StylistBalance[];
  overdue: OverdueWig[];
}

export interface QcInput {
  result: "pass" | "rework";
  quality_rating?: number;
  quality_notes?: string;
  reassign_to?: string;
}

// ── Job activity timeline (read from the audit log) ─────────

export interface JobActivityEntry {
  log_id: string;
  occurred_at: string;
  user_name: string;
  action: string;
  after_state: Record<string, unknown> | null;
}

// ── Stylist scorecards (internal Stylist Studio only — separate from
// the Stylist Partner Programme's own review system under Grow > Stylists) ──

export interface StylistScorecardSummary {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  jobs_total: number;
  jobs_completed: number;
  avg_quality_rating: string | null;
  avg_customer_rating: string | null;
  rework_count: number;
  on_time_pct: string | null;
}

export interface ScorecardJob {
  job_id: string;
  job_number: string;
  tag_code: string | null;
  status: JobStatus;
  quality_rating: number | null;
  customer_rating: number | null;
  customer_feedback: string | null;
  quality_notes: string | null;
  rework_count: number;
  scheduled_for: string | null;
  expected_completion_at: string | null;
  sla_due_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ReworkEvent {
  log_id: string;
  occurred_at: string;
  user_name: string;
  after_state: { result?: string; quality_notes?: string | null } | null;
  job_id: string;
  job_number: string;
}

export interface StylistScorecard extends StylistScorecardSummary {
  jobs: ScorecardJob[];
  rework: ReworkEvent[];
}

// ── AI job summary ───────────────────────────────────────────

export interface JobSummary {
  summary: string;
  provider: string;
}

// ── "You're working on Job X" strip (own-scope stylists) ────
// The caller's single currently-open time session, joined with the parent
// job's number + service type label so the strip renders without a second
// call. `null` means no clock is running (strip stays hidden).
export interface MyCurrentSession {
  log_id: string;
  job_id: string;
  started_at: string;
  job_number: string;
  job_status: JobStatus;
  service_type_name: string | null;
}
