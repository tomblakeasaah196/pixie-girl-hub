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
  is_offsite: boolean;
  offsite_distance_m: number | null;
  clock_in_address: string | null;
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
  leave_escalation_days: number;
  earnings_tracker_enabled: boolean;
  geofence_enabled: boolean;
  geofence_required_on_site: boolean;
  geofence_accuracy_max_m: number;
  offsite_auto_query: boolean;
  offsite_marks_absent: boolean;
  payout_require_pin: boolean;
  payout_provider: "nomba" | "flutterwave" | "manual";
  payout_pin_set: boolean;
  onboarding_checklist: { key: string; label: string }[];
}

interface ListEnvelope<T> {
  data: T[];
}

export interface MyToday {
  profile_id: string;
  clocked_in: boolean;
  clocked_out: boolean;
  clocked_in_at: string | null;
  is_offsite: boolean;
  last_address: string | null;
  expected_mode: "on_site" | "remote" | "off" | null;
  expected_start_time: string | null;
  geofence_required: boolean;
}

export interface ClockResult {
  event_id: string;
  event_type: "clock_in" | "clock_out";
  occurred_at: string;
  is_offsite: boolean;
  distance_m: number | null;
  address: string | null;
  late_minutes: number;
  status: "late" | "present";
}

export interface Geofence {
  geofence_id: string;
  business: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  address: string | null;
  unit_id: string | null;
  is_active: boolean;
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

export const getMyToday = () => api.get<MyToday>("/hr/me/today");

export const clock = (body: {
  event_type: "clock_in" | "clock_out";
  latitude?: number | null;
  longitude?: number | null;
  accuracy_m?: number | null;
  address?: string;
}) => api.post<ClockResult>("/hr/me/clock", body);

// ── Management ─────────────────────────────────────────────
export const getOverview = () => api.get<HrOverview>("/hr/overview");

export interface HrAnalytics {
  period: { year: number; month: number };
  headcount: number;
  attendance: {
    present_days: number;
    late_days: number;
    absent_days: number;
    leave_days: number;
    offsite_days: number;
    punctuality_pct: number;
  };
  lateness_deductions_ngn: number;
  open_queries: number;
  pending_leave: number;
  targets: { active: number; achieved: number };
  earned_mtd_ngn: number;
}
export const getAnalytics = () => api.get<HrAnalytics>("/hr/analytics");

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

export const applyLapsedOffsite = () =>
  api.post<{ lapsed: number; marked_absent: number }>("/hr/attendance/apply-lapsed-offsite");

// ── Office geofences (attendance perimeters) ───────────────
export const listGeofences = () => api.get<Geofence[]>("/attendance/geofences");
export const createGeofence = (body: {
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  address?: string;
}) => api.post<Geofence>("/attendance/geofences", body);
export const updateGeofence = (id: string, patch: Partial<Geofence>) =>
  api.patch<Geofence>(`/attendance/geofences/${id}`, patch);
export const deleteGeofence = (id: string) =>
  api.delete<void>(`/attendance/geofences/${id}`);

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

export interface StaffContract {
  contract_id: string;
  contract_type: string;
  effective_from: string;
  effective_to: string | null;
  gross_salary: number;
  document_id: string | null;
}
export const listEmployeeContracts = (id: string) =>
  api.get<{ data: StaffContract[] }>(`/hr/employees/${id}/contracts`).then((r) => r.data);
export const generateContract = (
  id: string,
  body: {
    contract_type?: string;
    effective_from?: string;
    effective_to?: string | null;
    gross_salary?: number;
    notes?: string;
  },
) => api.post<StaffContract>(`/hr/employees/${id}/contract`, body);

// ── Payroll (Phase 2) ──────────────────────────────────────
export interface PayrollRun {
  run_id: string;
  run_number: string;
  pay_month: number;
  pay_year: number;
  pay_date: string;
  period_start: string;
  period_end: string;
  status: "draft" | "calculated" | "reviewed" | "approved" | "paid" | "reversed";
  total_staff: number;
  total_gross_ngn: number;
  total_net_ngn: number;
  total_paye_ngn: number;
  paid_at: string | null;
}

export interface Payslip {
  payslip_id: string;
  payslip_number: string;
  user_id: string;
  payroll_run_id: string;
  job_title_snapshot: string | null;
  gross_pay_ngn: number;
  total_deductions_ngn: number;
  net_pay_ngn: number;
  payment_status: "pending" | "queued" | "paid" | "failed" | "reversed";
  payment_reference: string | null;
  failure_reason: string | null;
}

export const listPayrollRuns = () => api.get<PayrollRun[]>("/hr/payroll-runs");
export const getPayrollRun = (id: string) => api.get<PayrollRun>(`/hr/payroll-runs/${id}`);
export const createPayrollRun = (body: {
  pay_month: number;
  pay_year: number;
  pay_date: string;
  period_start: string;
  period_end: string;
}) => api.post<PayrollRun>("/hr/payroll-runs", body);
export const calculatePayrollRun = (id: string) =>
  api.post<PayrollRun>(`/hr/payroll-runs/${id}/calculate`);
export const reviewPayrollRun = (id: string) =>
  api.post<PayrollRun>(`/hr/payroll-runs/${id}/review`);
export const approvePayrollRun = (id: string) =>
  api.post<PayrollRun>(`/hr/payroll-runs/${id}/approve`);
export const payPayrollRun = (id: string, pin?: string) =>
  api.post<PayrollRun & { disbursement?: { provider: string; paid: number; queued: number; failed: number } }>(
    `/hr/payroll-runs/${id}/pay`,
    { pin },
  );
export const listPayslips = (runId: string) =>
  api.get<Payslip[]>(`/hr/payslips?payroll_run_id=${encodeURIComponent(runId)}`);

// ── Performance appraisal (cycles, KPIs, reviews) ──────────
export interface PerfCycle {
  cycle_id: string;
  cycle_name: string;
  cycle_type: string;
  starts_on: string;
  ends_on: string;
  status: string;
}
export interface PerfReview {
  review_id: string;
  cycle_id: string;
  user_id: string;
  staff_name?: string;
  overall_weighted_score: number;
  overall_rating_band: string;
  status: string;
  acknowledged_by_employee: boolean;
}
export interface KpiWeightSummary {
  total: number;
  target: number;
  balanced: boolean;
}

export const listPerfCycles = () =>
  api.get<PerfCycle[]>("/hr/performance-cycles");
export const createPerfCycle = (body: {
  cycle_name: string;
  cycle_type: string;
  starts_on: string;
  ends_on: string;
}) => api.post<PerfCycle>("/hr/performance-cycles", body);
export const kpiWeightSummary = () =>
  api.get<KpiWeightSummary>("/hr/kpi-definitions/weight-summary");
export const listPerfReviews = (params: Record<string, string> = {}) =>
  api.get<PerfReview[]>(`/hr/performance-reviews${qs(params)}`);
export const advancePerfReview = (id: string, status: string) =>
  api.post<PerfReview>(`/hr/performance-reviews/${id}/advance`, { status });

export interface KpiDef {
  kpi_id: string;
  kpi_key: string;
  display_name: string;
  weight_pct: number;
  min_score: number;
  max_score: number;
}
export const listKpiDefinitions = () =>
  api.get<KpiDef[]>("/hr/kpi-definitions");
export const scoreStaff = (
  cycleId: string,
  body: { user_id: string; scores: { kpi_id: string; raw_score: number; comments?: string }[] },
) => api.post(`/hr/performance-cycles/${cycleId}/scores`, body);
export const generatePerfReview = (cycleId: string, user_id: string) =>
  api.post<PerfReview>(`/hr/performance-cycles/${cycleId}/reviews`, { user_id });

function qs(params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
