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
  first_clock_in_at: string | null;
  minutes_late: number;
  is_late: boolean;
  deduction_pct: number;
  deduction_ngn: number;
  justified: boolean;
  is_offsite: boolean;
  offsite_distance_m: number | null;
  clock_in_address: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  last_clock_out_at: string | null;
  early_leave_minutes: number;
  overtime_minutes: number;
  clock_out_address: string | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_out_is_offsite: boolean;
  clock_out_distance_m: number | null;
  clock_in_ip: string | null;
  clock_out_ip: string | null;
  // true = clock-in came from an enrolled device; false = unknown device
  // (flagged red, never blocked); null = not applicable (CEO / not enrolled).
  clock_in_device_recognized: boolean | null;
}

export interface ArrivalPoint {
  work_date: string;
  at: string;
  local_minutes: number;
}

export interface AttendanceInsights {
  present_days: number;
  late_days: number;
  absent_days: number;
  offsite_days: number;
  at_risk_days: number;
  punctuality_pct: number;
  avg_late_minutes: number;
  overtime_minutes: number;
  overtime_days: number;
  avg_overtime_minutes: number;
  earliest_arrival: ArrivalPoint | null;
  latest_arrival: ArrivalPoint | null;
  earliest_departure: ArrivalPoint | null;
  latest_departure: ArrivalPoint | null;
}

export interface CommissionRow {
  earning_id: string;
  commission_amount_ngn: number;
  sale_channel: string | null;
  status: string;
  earned_at: string;
}

export interface BonusRow {
  bonus_id: string;
  amount_ngn: number;
  bonus_type?: string | null;
  reason?: string | null;
  status: string;
  awarded_at: string;
}

export interface HrContract {
  contract_id: string;
  contract_type: string;
  effective_from: string;
  effective_to: string | null;
  gross_salary: number;
  document_id: string | null;
  signature_status?: string | null;
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
    expected_end_time: string | null;
    grace_minutes: number;
  };
  earnings: MyHrEarnings;
  insights: AttendanceInsights;
  open_queries: HrQuery[];
  leave_balance: { leave_type: string; days_taken: number }[];
  leave_requests: LeaveRequest[];
  annual_leave_days_remaining: number;
  accruals: {
    commission_pending_ngn: number;
    bonus_pending_ngn: number;
    commissions: CommissionRow[];
    bonuses: BonusRow[];
  };
  rewards: RewardGrant[];
  onboarding: Onboarding;
}

export interface MyTask {
  task_id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
}

/** Paginated envelope for the My HR self-service lists (10/page by default). */
export interface Paginated<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number };
}

export interface Onboarding {
  welcome: string | null;
  items: { key: string; label: string; completed: boolean }[];
  done: number;
  total: number;
  help_articles: { article_id: string; slug: string; title: string; summary: string | null }[];
  documents: { document_id: string; title: string | null; document_type: string; created_at: string }[];
  links: { label: string; url: string }[];
}

/** Full (masked) staff profile as returned by GET /hr/employees/:id. */
export interface StaffProfile {
  profile_id: string;
  user_id: string | null;
  contact_id: string | null;
  display_name: string;
  primary_phone?: string | null;
  contact_email?: string | null;
  employee_number: string;
  job_title: string | null;
  department: string | null;
  employment_type: string | null;
  start_date: string | null;
  end_date: string | null;
  base_salary: number;
  bank_name: string | null;
  bank_account_number: string | null;
  work_schedule: WorkSchedule | null;
  work_expected_start_time: string | null;
  work_expected_end_time: string | null;
  probation_status: string;
  probation_start_date: string | null;
  probation_end_date: string | null;
  probation_outcome: string | null;
  annual_leave_days_entitled: number;
  annual_leave_days_remaining: number;
  non_solicit_months: number | null;
  non_solicit_until: string | null;
  statutory_exempt?: boolean;
  [key: string]: unknown;
}

export interface Employee360 {
  profile: StaffProfile;
  onboarding?: { done: number; total: number };
  insights: AttendanceInsights & {
    tenure_days: number | null;
    target_attainment_pct: number | null;
    quality_score: number | null;
    earned_mtd_ngn: number;
    deductions_mtd_ngn: number;
  };
  schedule: {
    work_schedule: WorkSchedule;
    expected_start_time: string | null;
    expected_end_time: string | null;
  };
  attendance: AttendanceDay[];
  targets: PerformanceTarget[];
  queries: HrQuery[];
  leave_requests: LeaveRequest[];
  contracts: HrContract[];
  payslips: Payslip[];
  commissions: CommissionRow[];
  bonuses: BonusRow[];
  reviews: PerfReview[];
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
  default_expected_end_time: string | null;
  clockout_reminder_enabled: boolean;
  working_days: string[];
  leave_escalation_days: number;
  earnings_tracker_enabled: boolean;
  statutory_deductions_enabled: boolean;
  advance_recovery_cap_pct: number;
  geofence_enabled: boolean;
  geofence_required_on_site: boolean;
  geofence_accuracy_max_m: number;
  offsite_auto_query: boolean;
  offsite_marks_absent: boolean;
  payout_require_pin: boolean;
  payout_provider: "nomba" | "flutterwave" | "manual";
  payout_pin_set: boolean;
  onboarding_checklist: { key: string; label: string }[];
  onboarding_links: { label: string; url: string }[];
  onboarding_welcome: string | null;
  onboarding_help_article_ids: string[];
}

interface ListEnvelope<T> {
  data: T[];
}

/**
 * The API client (lib/api) already unwraps a bare `{ data }` envelope to the
 * inner value — it only keeps the envelope intact when a `meta` key is present.
 * These HR list endpoints return `{ data: [...] }` with NO meta, so the client
 * hands us the array directly; a further `.data` access would read undefined
 * off the array and silently blank the list (this is exactly why the pending
 * leave inbox showed nothing). `asList` tolerates either shape.
 */
function asList<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const d = (r as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as T[]) : [];
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
  device_recognized: boolean | null;
  late_minutes: number;
  status: "late" | "present";
}

// ── Device binding (000304) ────────────────────────────────
export type DeviceType = "mobile" | "laptop" | "desktop" | "tablet" | "other";

export interface StaffDevice {
  device_id: string;
  device_fingerprint?: string;
  device_label: string;
  device_type: DeviceType;
  enrolled_at: string;
  last_seen_at: string | null;
  last_ip: string | null;
  is_active: boolean;
}

export interface MyDevices {
  data: StaffDevice[];
  max_devices: number | null; // null = uncapped (CEO)
  can_add: boolean;
}

export interface OtpChallenge {
  sent_to: string; // masked email
  expires_in: number;
}

export interface EmployeeDevices {
  profile_id: string;
  display_name: string | null;
  job_title: string | null;
  business: string;
  devices: {
    device_id: string;
    device_label: string;
    device_type: DeviceType;
    enrolled_at: string;
    last_seen_at: string | null;
    last_ip: string | null;
  }[];
  active_count: number;
}

export interface DeviceChange {
  log_id: string;
  action: "enrolled" | "removed" | "replaced" | "flagged_unknown";
  device_label: string | null;
  note: string | null;
  created_at: string;
  profile_id: string;
  display_name: string | null;
  actor_name: string | null;
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
export const toggleOnboardingItem = (item_key: string, completed: boolean) =>
  api.post<{ item_key: string; completed: boolean }>("/hr/me/onboarding", { item_key, completed });

interface PageParams {
  page?: number;
  page_size?: number;
}

function pageQs(params: PageParams): string {
  return qs({
    ...(params.page ? { page: String(params.page) } : {}),
    ...(params.page_size ? { page_size: String(params.page_size) } : {}),
  });
}

/** This month's (or a chosen month's) reconciled attendance, 10/page by default. */
export const myAttendance = (
  params: PageParams & { year?: number; month?: number } = {},
) =>
  api.get<
    Paginated<AttendanceDay> & { meta: { year: number; month: number } }
  >(
    `/hr/me/attendance${qs({
      ...(params.year ? { year: String(params.year) } : {}),
      ...(params.month ? { month: String(params.month) } : {}),
      ...(params.page ? { page: String(params.page) } : {}),
      ...(params.page_size ? { page_size: String(params.page_size) } : {}),
    })}`,
  );

export const myTasks = (params: PageParams = {}) =>
  api.get<Paginated<MyTask>>(`/hr/me/tasks${pageQs(params)}`);

export const myContracts = (params: PageParams = {}) =>
  api.get<Paginated<HrContract>>(`/hr/me/contracts${pageQs(params)}`);

export const myTargets = (params: PageParams = {}) =>
  api.get<Paginated<PerformanceTarget>>(`/hr/me/targets${pageQs(params)}`);

export const myPayslips = (params: PageParams = {}) =>
  api.get<Paginated<Payslip>>(`/hr/me/payslips${pageQs(params)}`);

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
  device_fingerprint?: string;
}) => api.post<ClockResult>("/hr/me/clock", body);

// ── Device binding — self-service (My HR) ──────────────────
export const getMyDevices = () => api.get<MyDevices>("/hr/me/devices");
export const startDeviceEnroll = (body: {
  device_label: string;
  device_type?: DeviceType;
  device_fingerprint: string;
}) => api.post<OtpChallenge>("/hr/me/devices/enroll/start", body);
export const verifyDeviceEnroll = (otp: string) =>
  api.post<StaffDevice>("/hr/me/devices/enroll/verify", { otp });
export const startDeviceRemove = (deviceId: string) =>
  api.post<OtpChallenge>(`/hr/me/devices/${deviceId}/remove/start`);
export const verifyDeviceRemove = (deviceId: string, otp: string) =>
  api.post<{ removed: boolean; device_id: string }>(
    `/hr/me/devices/${deviceId}/remove/verify`,
    { otp },
  );

// ── Device binding — HR & Staff ────────────────────────────
export const listAllDevices = () =>
  api
    .get<ListEnvelope<EmployeeDevices>>("/hr/devices")
    .then((r) => asList<EmployeeDevices>(r));
export const listDeviceChanges = (limit = 50) =>
  api
    .get<ListEnvelope<DeviceChange>>(`/hr/devices/changes?limit=${limit}`)
    .then((r) => asList<DeviceChange>(r));

// ── Live attendance (000304) — the shape of a socket punch + seed rows ──
export interface LivePunch {
  event_id: string;
  profile_id: string;
  display_name: string | null;
  event_type: "clock_in" | "clock_out";
  occurred_at: string;
  is_offsite: boolean;
  distance_m: number | null;
  address: string | null;
  device_recognized: boolean | null;
  late_minutes?: number;
  status?: "late" | "present";
}

// ── Management ─────────────────────────────────────────────
export const getOverview = () => api.get<HrOverview>("/hr/overview");
export const listLiveAttendance = () =>
  api
    .get<ListEnvelope<LivePunch>>("/hr/attendance/live")
    .then((r) => asList<LivePunch>(r));

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
export interface HrTrendPoint {
  year: number;
  month: number;
  label: string;
  headcount: number;
  new_hires: number;
  attrition: number;
  punctuality_pct: number;
  payroll_ngn: number;
}
export interface HrTrends {
  months: number;
  series: HrTrendPoint[];
}
export const getAnalyticsTrends = (months = 12) =>
  api.get<HrTrends>(`/hr/analytics/trends?months=${months}`);

export interface ProbationItem {
  profile_id: string;
  user_id: string | null;
  display_name: string;
  job_title: string;
  probation_status: string;
  probation_end_date: string;
  days_left: number;
}
export const getProbationEndingSoon = (days = 30) =>
  api.get<{ days: number; items: ProbationItem[] }>(
    `/hr/probation/ending-soon?days=${days}`,
  );

export const getAnalytics = (params: { year?: number; month?: number } = {}) =>
  api.get<HrAnalytics>(
    `/hr/analytics${qs({
      ...(params.year ? { year: String(params.year) } : {}),
      ...(params.month ? { month: String(params.month) } : {}),
    })}`,
  );

export const reconcileDay = (date?: string) =>
  api.post<{ date: string; records_created: number; late_count: number }>(
    "/hr/attendance/reconcile",
    { date },
  );

export const reconcilePeriod = (from: string, to: string) =>
  api.post<{ reconciled: number; dates: string[] }>(
    "/hr/attendance/reconcile-period",
    { from, to },
  );

export const listAttendanceDays = (params: Record<string, string> = {}) =>
  api
    .get<ListEnvelope<AttendanceDay>>(
      `/hr/attendance-days${qs(params)}`,
    )
    .then((r) => asList<AttendanceDay>(r));

export const listLeave = (params: Record<string, string> = {}) =>
  api
    .get<ListEnvelope<LeaveRequest>>(`/hr/leave${qs(params)}`)
    .then((r) => asList<LeaveRequest>(r));
export const approveLeave = (id: string) =>
  api.post<LeaveRequest>(`/hr/leave/${id}/approve`);
export const rejectLeave = (id: string, rejection_reason?: string) =>
  api.post<LeaveRequest>(`/hr/leave/${id}/reject`, { rejection_reason });

export const listQueries = (params: Record<string, string> = {}) =>
  api
    .get<ListEnvelope<HrQuery>>(`/hr/queries${qs(params)}`)
    .then((r) => asList<HrQuery>(r));
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
  api
    .get<ListEnvelope<PerformanceTarget>>(`/hr/targets${qs(params)}`)
    .then((r) => asList<PerformanceTarget>(r));
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
  user_id: string | null;
  employee_number: string;
  job_title: string;
  department: string | null;
  display_name: string;
  base_salary: number;
  employment_type: string;
}
// /hr/employees returns { data, page, page_size, total } with NO `meta` key, so
// the api client unwraps it to the bare StaffRow[] array. Every consumer reads
// `staff.data`, though — which would be undefined on an array and silently empty
// the staff pickers (Performance scoring, HR queries/attendance/appraisals).
// Normalise back to a { data } envelope so `.data` always resolves.
export const listStaff = async (params: Record<string, string> = {}) => {
  const r = await api.get<StaffRow[] | { data: StaffRow[] }>(
    `/hr/employees${qs(params)}`,
  );
  return { data: asList<StaffRow>(r) };
};
export const getEmployee360 = (profileId: string) =>
  api.get<Employee360>(`/hr/employees/${profileId}/dossier`);
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
  api
    .get<{ data: StaffContract[] }>(`/hr/employees/${id}/contracts`)
    .then((r) => asList<StaffContract>(r));
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
  staff_name?: string | null;
  job_title_snapshot: string | null;
  gross_pay_ngn: number;
  attendance_deduction_ngn: number;
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
export const payslipPdf = (payslipId: string) =>
  api.post<import("./documents-api").DocumentRow>(`/hr/payslips/${payslipId}/pdf`);

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
export const updatePerfCycle = (id: string, body: { status?: string; cycle_name?: string; notes?: string }) =>
  api.patch<PerfCycle>(`/hr/performance-cycles/${id}`, body);
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
  description?: string | null;
  weight_pct: number;
  min_score: number;
  max_score: number;
  score_source?: ScoreSource;
  auto_score_config?: Record<string, unknown> | null;
  display_order?: number;
  is_active?: boolean;
}
export interface KpiDefInput {
  kpi_key: string;
  display_name: string;
  description?: string;
  weight_pct: number;
  min_score?: number;
  max_score?: number;
  score_source?: ScoreSource;
  auto_score_config?: Record<string, unknown> | null;
  display_order?: number;
  is_active?: boolean;
}
export const listKpiDefinitions = () =>
  api.get<KpiDef[]>("/hr/kpi-definitions");
export const createKpiDefinition = (body: KpiDefInput) =>
  api.post<KpiDef>("/hr/kpi-definitions", body);
export const updateKpiDefinition = (id: string, body: Partial<KpiDefInput>) =>
  api.patch<KpiDef>(`/hr/kpi-definitions/${id}`, body);
export const deleteKpiDefinition = (id: string) =>
  api.delete(`/hr/kpi-definitions/${id}`);
export const exportReviewPdf = (reviewId: string) =>
  api.post<{ document_id: string; title: string }>(
    `/hr/performance-reviews/${reviewId}/pdf`,
  );
export const scoreStaff = (
  cycleId: string,
  body: { user_id: string; scores: { kpi_id: string; raw_score: number; comments?: string }[] },
) => api.post(`/hr/performance-cycles/${cycleId}/scores`, body);
export const generatePerfReview = (cycleId: string, user_id: string) =>
  api.post<PerfReview>(`/hr/performance-cycles/${cycleId}/reviews`, { user_id });

// ── Appraisal auto-scoring (PR-B) ──────────────────────────
export type ScoreSource =
  | "manual"
  | "customer_ratings"
  | "sales_data"
  | "crm_data"
  | "service_job_ratings"
  | "clock_in_data"
  | "custom";

export interface PerfScore {
  score_id: string;
  cycle_id: string;
  user_id: string;
  kpi_id: string;
  kpi_name: string;
  kpi_key: string;
  raw_score: number;
  weight_pct_snapshot: number;
  weighted_score: number;
  score_source: ScoreSource;
  evidence: Record<string, unknown> | null;
  is_calibrated: boolean;
  pre_calibration_score: number | null;
  last_auto_scored_at: string | null;
  last_auto_score_status: "ok" | "no_data" | "error" | "skipped" | null;
}

export interface AutoScoreResult {
  scored: number;
  no_data: number;
  skipped: number;
  kpis: number;
  staff: number;
}

export const listPerfScores = (cycleId: string, userId?: string) =>
  api.get<PerfScore[]>(
    `/hr/performance-cycles/${cycleId}/scores${userId ? `?user_id=${userId}` : ""}`,
  );
export const autoScoreCycle = (cycleId: string, body: { user_id?: string } = {}) =>
  api.post<AutoScoreResult>(`/hr/performance-cycles/${cycleId}/auto-score`, body);
export const calibratePerfScore = (
  cycleId: string,
  scoreId: string,
  body: { raw_score: number; reason?: string },
) =>
  api.post<PerfScore>(
    `/hr/performance-cycles/${cycleId}/scores/${scoreId}/calibrate`,
    body,
  );

// ── Rewards (meeting §3 reward system) ─────────────────────
export type RewardMetric =
  | "first_in_days" | "last_out_days" | "punctual_days" | "data_entries"
  | "styles_completed" | "sales_count" | "quality_avg";
export type RewardType = "fixed_ngn" | "pct_salary" | "salary_increase_pct";

export interface RewardRule {
  reward_rule_id: string;
  name: string;
  description: string | null;
  metric: RewardMetric;
  comparator: "gte" | "lte";
  threshold: number;
  period_type: "month";
  reward_type: RewardType;
  reward_value: number;
  is_active: boolean;
}

export interface RewardGrant {
  reward_grant_id: string;
  staff_name?: string;
  rule_name?: string;
  rule_metric?: string;
  profile_id: string;
  period_year: number;
  period_month: number;
  metric: string;
  metric_value: number;
  reward_type: RewardType;
  reward_value: number;
  amount_ngn: number | null;
  proposed_salary_ngn: number | null;
  bonus_id: string | null;
  status: "awarded" | "pending" | "applied" | "rejected";
  created_at: string;
}

export interface RewardLeaderboard {
  metric: string;
  period: { year: number; month: number };
  rows: { profile_id: string; staff_name: string; value: number }[];
}

export const listRewardRules = () =>
  api.get<{ data: RewardRule[] }>("/hr/rewards/rules").then((r) => asList<RewardRule>(r));
export const createRewardRule = (body: Partial<RewardRule>) =>
  api.post<RewardRule>("/hr/rewards/rules", body);
export const updateRewardRule = (id: string, patch: Partial<RewardRule>) =>
  api.patch<RewardRule>(`/hr/rewards/rules/${id}`, patch);
export const deleteRewardRule = (id: string) =>
  api.delete<void>(`/hr/rewards/rules/${id}`);
export const evaluateRewards = (body: { year?: number; month?: number } = {}) =>
  api.post<{ granted: number; period: { year: number; month: number } }>("/hr/rewards/evaluate", body);
export const rewardLeaderboard = (metric: RewardMetric, params: { year?: number; month?: number } = {}) =>
  api.get<RewardLeaderboard>(
    `/hr/rewards/leaderboard${qs({
      metric,
      ...(params.year ? { year: String(params.year) } : {}),
      ...(params.month ? { month: String(params.month) } : {}),
    })}`,
  );
export const listRewardGrants = (params: Record<string, string> = {}) =>
  api.get<{ data: RewardGrant[] }>(`/hr/rewards/grants${qs(params)}`).then((r) => asList<RewardGrant>(r));
export const applyRewardGrant = (id: string) =>
  api.post<RewardGrant>(`/hr/rewards/grants/${id}/apply`);
export const rejectRewardGrant = (id: string, reason?: string) =>
  api.post<RewardGrant>(`/hr/rewards/grants/${id}/reject`, { reason });

function qs(params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
