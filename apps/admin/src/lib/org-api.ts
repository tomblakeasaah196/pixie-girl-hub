import { api } from "./api";

// ── Org Units ──────────────────────────────────────────────────────────────

export interface OrgUnit {
  unit_id: string;
  business: string;
  parent_unit_id: string | null;
  unit_key: string;
  display_name: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Org Positions ──────────────────────────────────────────────────────────

export interface OrgPosition {
  position_id: string;
  unit_id: string;
  position_key: string;
  display_name: string;
  profile_id: string | null;
  reports_to_position_id: string | null;
  is_management: boolean;
  is_deputy: boolean;
  deputy_capacities: string[];
  approval_threshold_ngn: number | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface DottedLine {
  dotted_id: string;
  position_id: string;
  dotted_to_position_id: string;
  dotted_to_display_name: string;
  rights: {
    can_view_dashboards: boolean;
    can_view_documents: boolean;
    can_request_updates: boolean;
    receives_notifications: boolean;
    can_approve: false;
  };
  notes: string | null;
  created_at: string;
}

// ── Workflow Definitions ───────────────────────────────────────────────────

export interface WorkflowStage {
  order: number;
  name?: string;
  approvers: Array<{ type: "role" | "position" | "user"; value: string }>;
  condition?: Record<string, unknown>;
  applies_when?: Record<string, unknown>;
  threshold_field?: string;
  threshold_ngn_gt?: number;
  threshold_ngn_gte?: number;
  threshold_ngn_lte?: number;
  threshold_ngn_lt?: number;
  amount_threshold_ngn?: number | null;
  timeout_hours?: number;
  on_timeout?: "escalate" | "auto_approve" | "auto_reject";
  fallback_to_deputy?: boolean;
}

export interface WorkflowDefinition {
  workflow_id: string;
  business: string;
  name: string;
  description: string | null;
  trigger_module: string;
  trigger_action: string;
  is_active: boolean;
  definition: {
    trigger?: { module: string; action: string };
    stages: WorkflowStage[];
  };
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ── Workflow Instances (Approvals) ─────────────────────────────────────────

export interface WorkflowDecision {
  decision_id?: string;
  stage: number;
  actor_id?: string;
  actor_name?: string;
  action: "approve" | "reject" | "request_changes";
  notes: string | null;
  decided_at: string;
}

export interface WorkflowInstance {
  instance_id: string;
  workflow_id: string;
  workflow_name: string;
  trigger: { module: string; action: string };
  reference: { table: string; id: string };
  current_stage: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  context: Record<string, unknown>;
  initiated_by: { user_id: string; name: string };
  initiated_at: string;
  completed_at: string | null;
  stage_entered_at: string;
  stage_timeout_at: string | null;
  requires_ceo: boolean;
  can_act: boolean;
  decisions?: WorkflowDecision[];
}

// ── API ────────────────────────────────────────────────────────────────────

export const orgApi = {
  // Org units
  listUnits: (params?: { include_inactive?: boolean; q?: string }) => {
    const entries = Object.entries(params ?? {}).filter(
      ([, v]) => v !== undefined,
    ) as [string, string][];
    const qs = entries.length
      ? "?" + new URLSearchParams(entries).toString()
      : "";
    return api.get<OrgUnit[]>(`/org${qs}`);
  },
  getUnit: (id: string) => api.get<OrgUnit>(`/org/${id}`),
  createUnit: (body: Partial<OrgUnit>) => api.post<OrgUnit>("/org", body),
  updateUnit: (id: string, body: Partial<OrgUnit>) =>
    api.patch<OrgUnit>(`/org/${id}`, body),
  deleteUnit: (id: string) => api.delete<void>(`/org/${id}`),

  // Positions
  listPositions: (params?: { unit_id?: string }) => {
    const qs = params?.unit_id
      ? `?unit_id=${encodeURIComponent(params.unit_id)}`
      : "";
    return api.get<OrgPosition[]>(`/org/positions${qs}`);
  },
  getPosition: (id: string) => api.get<OrgPosition>(`/org/positions/${id}`),
  createPosition: (body: Partial<OrgPosition>) =>
    api.post<OrgPosition>("/org/positions", body),
  updatePosition: (id: string, body: Partial<OrgPosition>) =>
    api.patch<OrgPosition>(`/org/positions/${id}`, body),
  deletePosition: (id: string) => api.delete<void>(`/org/positions/${id}`),

  // Dotted lines
  listDottedLines: (position_id: string) =>
    api.get<DottedLine[]>(`/org/positions/${position_id}/dotted-lines`),
  createDottedLine: (
    position_id: string,
    body: { dotted_to_position_id: string; notes?: string },
  ) => api.post<DottedLine>(`/org/positions/${position_id}/dotted-lines`, body),
  deleteDottedLine: (dotted_id: string) =>
    api.delete<void>(`/org/dotted-lines/${dotted_id}`),

  // Workflow definitions
  listDefinitions: (include_inactive?: boolean) => {
    const qs = include_inactive ? "?include_inactive=true" : "";
    return api.get<WorkflowDefinition[]>(`/org/workflows${qs}`);
  },
  getDefinition: (id: string) =>
    api.get<WorkflowDefinition>(`/org/workflows/${id}`),
  createDefinition: (body: {
    name: string;
    description?: string;
    trigger_module: string;
    trigger_action: string;
    definition: WorkflowDefinition["definition"];
  }) => api.post<WorkflowDefinition>("/org/workflows", body),
  setDefinitionActive: (id: string, is_active: boolean) =>
    api.patch<WorkflowDefinition>(`/org/workflows/${id}`, { is_active }),

  // Approvals queue
  // Backend returns { data, meta } but api.get auto-unwraps { data } → array.
  // We type accordingly and re-fetch the full envelope when meta is needed.
  listPending: (page = 1) =>
    api.get<WorkflowInstance[]>(`/org/approvals/pending?page=${page}`),
  getInstance: (id: string) =>
    api.get<WorkflowInstance>(`/org/approvals/${id}`),
  act: (
    id: string,
    action: "approve" | "reject" | "request_changes",
    notes?: string,
  ) =>
    api.post<WorkflowInstance>(`/org/approvals/${id}/act`, { action, notes }),
};
