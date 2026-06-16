export type JobStatus =
  | "pending"
  | "in_progress"
  | "on_hold"
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
  hair_variant_id: string | null;
  hair_unit_id: string | null;
  hair_description: string | null;
  sales_order_id: string | null;
  sales_order_line_id: string | null;
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
}

export interface JobPaginated {
  data: ServiceJob[];
  page: number;
  page_size: number;
  total: number;
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
