/**
 * HR API client (HR Phase 1).
 *
 * Typed wrappers over /api/v1/hr — the self-service "My HR" surface and the
 * "HR & Staff" management surface. Every call rides the brand context header
 * set by lib/api. Functions are plain async (callers wrap in TanStack Query)
 * to mirror the engineering reference being cloned.
 */

import { api } from "./api";

// ── Types ──────────────────────────────────────────────────
export interface WorkSchedule {
  [day: string]: "on_site" | "remote" | "off";
}

export interface MyHrEarnings {
  tracker_enabled: boolean;
  base_salary_ngn: number;
  daily_rate_ngn: number;
  working_days_in_month: number;
  days_worked: number;
  month_to_date_earned_ngn: number;
  deductions_ngn: number;
  at_risk_ngn: number;
  projected_month_ngn: number;
}

export interface PerformanceTarget {
  target_id: string;
  profile_id: string;
  staff_name?: string;
  period_month: number;
  period_year: number;
  metric: string;
  metric_label: string;
  target_value: number;
  current_value: number;
  source: "operations" | "sales" | "manual";
  reward_type: "pct_salary" | "fixed_ngn" | "none";
  reward_value: number;
  reward_note: string | null;
  status: "active" | "achieved" | "missed" | "closed";
  remaining: number;
  progress_pct: number;
}

export interface HrQuery {
  query_id: string;
  profile_id: string;
  staff_name?: string;
  query_type: string;
  severity: "low" | "normal" | "high";
  subject: string;
  details: string | null;
  source: "auto" | "manual";
  status: "open" | "responded" | "waived" | "upheld" | "closed";
  attendance_day_id: string | null;
  deduction_pct: number | null;
  deduction_ngn: number | null;
  employee_response: string | null;
  responded_at: string | null;
  resolution: "waived" | "upheld" | null;
  created_at: string;
}

export interface LeaveRequest {
  leave_id: string;
  profile_id: string;
  staff_name?: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days_requested: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface AttendanceDay {
  day_id: string;
  profile_id: string;
  staff_name?: string;
  work_date: string;
  status: string;
  minutes_late: number;
  is_late: boolean;
  deduction_pct: number;
  deduction_ngn: number;
  justified: boolean;
}

export interface MyHr {
  profile: {
    profile_id: string;
    display_name: string;
    job_title: string;
    employee_number: string;
    department: string | null;
  };
  schedule: {
    work_schedule: WorkSchedule;
    expected_start_time: string | null;
    grace_minutes: number;
  };
  earnings: MyHrEarnings;
  targets: PerformanceTarget[];
  attendance: AttendanceDay[];
  open_queries: HrQuery[];
  leave_balance: { leave_type: string; days_taken: number }[];
  leave_requests: LeaveRequest[];
  annual_leave_days_remaining: number;
  tasks: {
    task_id: string;
    title: string;
    status: string;
    priority: string;
    due_at: string | null;
  }[];
  contracts: {
    contract_id: string;
    contract_type: string;
    effective_from: string;
    effective_to: string | null;
    gross_salary: number;
    document_id: string | null;
  }[];
}

export interface HrOverview {
  counts: {
    total_staff: number;
    present_today: number;
    late_today: number;
    on_leave_today: number;
    pending_leave: number;
    open_queries: number;
  };
  pending_justifications: AttendanceDay[];
}

export interface HrSettings {
  business: string;
  lateness_enabled: boolean;
  lateness_tiers: { after_minutes: number; deduction_pct: number }[];
  lateness_auto_query: boolean;
  lateness_query_reminder_days: number;
  default_grace_minutes: number;
  default_expected_start_time: string | null;
  working_days: string[];
  earnings_tracker_enabled: boolean;
  payout_require_pin: boolean;
  payout_provider: "nomba" | "flutterwave" | "manual";
  payout_pin_set: boolean;
  onboarding_checklist: { key: string; label: string }[];
}

interface ListEnvelope<T> {
  data: T[];
}

// ── Self-service ───────────────────────────────────────────
export const getMyHr = () => api.get<MyHr>("/hr/me");

export const requestLeave = (body: {
  leave_type: string;
  start_date: string;
  end_date: string;
  days_requested: number;
  reason?: string;
}) => api.post<LeaveRequest>("/hr/me/leave", body);

export const respondToQuery = (id: string, response: string) =>
  api.post<HrQuery>(`/hr/me/queries/${id}/respond`, { response });

// ── Management ─────────────────────────────────────────────
export const getOverview = () => api.get<HrOverview>("/hr/overview");

export const reconcileDay = (date?: string) =>
  api.post<{ date: string; records_created: number; late_count: number }>(
    "/hr/attendance/reconcile",
    { date },
  );

export const listAttendanceDays = (params: Record<string, string> = {}) =>
  api
    .get<ListEnvelope<AttendanceDay>>(
      `/hr/attendance-days${qs(params)}`,
    )
    .then((r) => r.data);

export const listLeave = (params: Record<string, string> = {}) =>
  api.get<ListEnvelope<LeaveRequest>>(`/hr/leave${qs(params)}`).then((r) => r.data);
export const approveLeave = (id: string) =>
  api.post<LeaveRequest>(`/hr/leave/${id}/approve`);
export const rejectLeave = (id: string, rejection_reason?: string) =>
  api.post<LeaveRequest>(`/hr/leave/${id}/reject`, { rejection_reason });

export const listQueries = (params: Record<string, string> = {}) =>
  api.get<ListEnvelope<HrQuery>>(`/hr/queries${qs(params)}`).then((r) => r.data);
export const raiseQuery = (body: {
  profile_id: string;
  query_type?: string;
  severity?: string;
  subject: string;
  details?: string;
}) => api.post<HrQuery>("/hr/queries", body);
export const resolveQuery = (
  id: string,
  resolution: "waived" | "upheld",
  note?: string,
) => api.post<HrQuery>(`/hr/queries/${id}/resolve`, { resolution, note });

export const listTargets = (params: Record<string, string> = {}) =>
  api.get<ListEnvelope<PerformanceTarget>>(`/hr/targets${qs(params)}`).then((r) => r.data);
export const setTarget = (body: {
  profile_id: string;
  period_month: number;
  period_year: number;
  metric?: string;
  metric_label: string;
  target_value: number;
  source?: string;
  reward_type?: string;
  reward_value?: number;
  reward_note?: string;
}) => api.post<PerformanceTarget>("/hr/targets", body);
export const updateTargetProgress = (id: string, current_value: number) =>
  api.patch<PerformanceTarget>(`/hr/targets/${id}/progress`, { current_value });
export const deleteTarget = (id: string) => api.delete<void>(`/hr/targets/${id}`);

export const getSettings = () => api.get<HrSettings>("/hr/settings");
export const updateSettings = (patch: Partial<HrSettings>) =>
  api.put<HrSettings>("/hr/settings", patch);
export const setPayoutPin = (pin: string) =>
  api.post<{ payout_pin_set: boolean }>("/hr/settings/payout-pin", { pin });

// ── Employees (existing endpoints, reused by onboarding) ───
export interface StaffRow {
  profile_id: string;
  employee_number: string;
  job_title: string;
  department: string | null;
  display_name: string;
  base_salary: number;
  employment_type: string;
}
export const listStaff = (params: Record<string, string> = {}) =>
  api.get<{ data: StaffRow[]; meta?: unknown }>(`/hr/employees${qs(params)}`);
export const createStaff = (body: Record<string, unknown>) =>
  api.post<StaffRow>("/hr/employees", body);
export const updateStaff = (id: string, patch: Record<string, unknown>) =>
  api.patch<StaffRow>(`/hr/employees/${id}`, patch);

function qs(params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
