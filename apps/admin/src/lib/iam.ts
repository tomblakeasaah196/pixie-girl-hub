/**
 * IAM — data layer. Typed TanStack Query hooks for every IAM concern:
 * users, sessions, audit logs, security events, access reviews, and TOTP.
 * Per-brand resources include the active brand key in their query key so
 * switching brands refetches; the API attaches the brand via
 * X-Brand-Context (see lib/api.ts).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getAccessToken } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════
export interface IamUser {
  user_id: string;
  email: string;
  display_name: string;
  profile_type: "staff" | "external";
  external_label: string | null;
  status: "active" | "invited" | "suspended" | "locked" | "disabled";
  totp_enabled: boolean;
  last_login_at: string | null;
  failed_login_count: number;
  role_name: string | null;
  businesses: string[];
  profile_id: string | null;
}

export interface UserSession {
  session_id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  device_label: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_name?: string;
  user_email?: string;
}

export interface SecurityStats {
  failed_logins_24h: { count: number; user_name: string; user_email: string }[];
  inactive_accounts: number;
  locked_accounts: number;
  pending_invites: number;
  users_without_mfa: number;
  recent_events: SecurityEvent[];
  total_users: number;
  active_sessions: number;
}

export interface SecurityEvent {
  log_id: string;
  occurred_at: string;
  user_name: string;
  user_email: string | null;
  module: string;
  action: string;
  ip_address: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditEntry {
  log_id: string;
  occurred_at: string;
  user_id: string | null;
  user_name: string;
  user_email: string | null;
  business: string;
  module: string;
  action: string;
  table_name: string | null;
  record_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  ip_address: string | null;
  session_id: string | null;
  is_sensitive: boolean;
  metadata: Record<string, unknown>;
}

export interface AccessReview {
  review_id: string;
  business: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "completed" | "cancelled";
  initiated_by: string;
  initiator_name?: string;
  initiated_at: string;
  due_date: string | null;
  completed_at: string | null;
  completed_by: string | null;
  summary_note: string | null;
  entries?: AccessReviewEntry[];
  entry_stats?: { total: number; approved: number; revoked: number; flagged: number; pending: number };
}

export interface AccessReviewEntry {
  entry_id: string;
  review_id: string;
  user_id: string;
  user_name: string;
  user_email: string | null;
  role_name: string | null;
  businesses: string[];
  permissions_snapshot: { module: string; action: string }[];
  decision: "pending" | "approved" | "revoked" | "flagged";
  reviewer_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
}

export interface TotpSetupResponse {
  secret: string;
  uri: string;
}

// ════════════════════════════════════════════════════════════
// Filter types
// ════════════════════════════════════════════════════════════
export interface UserFilters {
  search?: string;
  status?: string;
  profile_type?: string;
  page?: number;
  per_page?: number;
}
export interface AuditFilters {
  module?: string;
  action?: string;
  user_search?: string;
  date_from?: string;
  date_to?: string;
  is_sensitive?: boolean;
  page?: number;
  per_page?: number;
}
export interface EventFilters {
  action?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  per_page?: number;
}
export interface ReviewFilters {
  status?: string;
  page?: number;
  per_page?: number;
}

// ════════════════════════════════════════════════════════════
// Security stats
// ════════════════════════════════════════════════════════════
export function useSecurityStats() {
  const brand = useBrand();
  return useQuery<SecurityStats>({
    queryKey: ["iam-stats", brand],
    queryFn: () => api.get<SecurityStats>("/iam/stats"),
    refetchInterval: 300_000,
  });
}

// ════════════════════════════════════════════════════════════
// Users
// ════════════════════════════════════════════════════════════
export function useIamUsers(filters: UserFilters = {}) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (filters.search) qs.set("search", filters.search);
  if (filters.status) qs.set("status", filters.status);
  if (filters.profile_type) qs.set("profile_type", filters.profile_type);
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.per_page) qs.set("per_page", String(filters.per_page));
  const q = qs.toString();
  return useQuery<{ rows: IamUser[]; total: number }>({
    queryKey: ["iam-users", brand, q],
    queryFn: () => api.get<{ rows: IamUser[]; total: number }>(`/iam/users${q ? `?${q}` : ""}`),
  });
}

export function useUserDetail(userId: string | null | undefined) {
  const brand = useBrand();
  return useQuery<IamUser>({
    queryKey: ["iam-users", brand, userId],
    queryFn: () => api.get<IamUser>(`/iam/users/${userId}`),
    enabled: !!userId,
  });
}

export function useProvisionStaff() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (data: { profileId: string; email: string; businesses: string[] }) =>
      api.post<{ temp_password: string }>(
        `/iam/users/provision-staff/${data.profileId}`,
        { email: data.email, businesses: data.businesses },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["iam-users", brand] }),
  });
}

export function useProvisionExternal() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (data: {
      display_name: string;
      email: string;
      external_label: string;
      businesses: string[];
    }) => api.post<{ temp_password: string }>("/iam/users/provision-external", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["iam-users", brand] }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post(`/iam/users/${userId}/deactivate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iam-users", brand] });
      qc.invalidateQueries({ queryKey: ["iam-stats", brand] });
    },
  });
}

export function useReactivateUser() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post(`/iam/users/${userId}/reactivate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iam-users", brand] });
      qc.invalidateQueries({ queryKey: ["iam-stats", brand] });
    },
  });
}

export function useAdminResetPassword() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post<{ temp_password: string }>(`/iam/users/${userId}/reset-password`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["iam-users", brand] }),
  });
}

export function useSendResetLink() {
  return useMutation({
    mutationFn: (userId: string) =>
      api.post(`/iam/users/${userId}/send-reset-link`),
  });
}

// ════════════════════════════════════════════════════════════
// Sessions
// ════════════════════════════════════════════════════════════
export function useUserSessions(userId: string | null | undefined) {
  const brand = useBrand();
  return useQuery<UserSession[]>({
    queryKey: ["iam-sessions", brand, userId],
    queryFn: () => api.get<UserSession[]>(`/iam/sessions/${userId}`),
    enabled: !!userId,
  });
}

export function useAllSessions() {
  const brand = useBrand();
  return useQuery<UserSession[]>({
    queryKey: ["iam-all-sessions", brand],
    queryFn: () => api.get<UserSession[]>("/iam/sessions"),
  });
}

export function useMySessions() {
  const brand = useBrand();
  return useQuery<UserSession[]>({
    queryKey: ["iam-my-sessions", brand],
    queryFn: () => api.get<UserSession[]>("/iam/my-sessions"),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.delete(`/iam/sessions/${sessionId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iam-sessions", brand] });
      qc.invalidateQueries({ queryKey: ["iam-my-sessions", brand] });
      qc.invalidateQueries({ queryKey: ["iam-all-sessions", brand] });
    },
  });
}

export function useRevokeAllSessions() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/iam/sessions/user/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iam-sessions", brand] });
      qc.invalidateQueries({ queryKey: ["iam-my-sessions", brand] });
      qc.invalidateQueries({ queryKey: ["iam-all-sessions", brand] });
    },
  });
}

export function useRevokeMySession() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.delete(`/iam/my-sessions/${sessionId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iam-my-sessions", brand] });
    },
  });
}

// ════════════════════════════════════════════════════════════
// Audit log
// ════════════════════════════════════════════════════════════
export function useAuditLog(filters: AuditFilters = {}) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (filters.module) qs.set("module", filters.module);
  if (filters.action) qs.set("action", filters.action);
  if (filters.user_search) qs.set("user_search", filters.user_search);
  if (filters.date_from) qs.set("date_from", filters.date_from);
  if (filters.date_to) qs.set("date_to", filters.date_to);
  if (filters.is_sensitive !== undefined) qs.set("is_sensitive", String(filters.is_sensitive));
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.per_page) qs.set("per_page", String(filters.per_page));
  const q = qs.toString();
  return useQuery<{ rows: AuditEntry[]; total: number }>({
    queryKey: ["iam-audit", brand, q],
    queryFn: () => api.get<{ rows: AuditEntry[]; total: number }>(`/iam/audit${q ? `?${q}` : ""}`),
  });
}

export function useAuditEntry(logId: string | null | undefined) {
  const brand = useBrand();
  return useQuery<AuditEntry>({
    queryKey: ["iam-audit", brand, logId],
    queryFn: () => api.get<AuditEntry>(`/iam/audit/${logId}`),
    enabled: !!logId,
  });
}

// ════════════════════════════════════════════════════════════
// Security events
// ════════════════════════════════════════════════════════════
export function useSecurityEvents(filters: EventFilters = {}) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (filters.action) qs.set("action", filters.action);
  if (filters.date_from) qs.set("date_from", filters.date_from);
  if (filters.date_to) qs.set("date_to", filters.date_to);
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.per_page) qs.set("per_page", String(filters.per_page));
  const q = qs.toString();
  return useQuery<{ rows: SecurityEvent[]; total: number }>({
    queryKey: ["iam-events", brand, q],
    queryFn: () => api.get<{ rows: SecurityEvent[]; total: number }>(`/iam/events${q ? `?${q}` : ""}`),
  });
}

// ════════════════════════════════════════════════════════════
// Access reviews
// ════════════════════════════════════════════════════════════
export function useAccessReviews(filters: ReviewFilters = {}) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.per_page) qs.set("per_page", String(filters.per_page));
  const q = qs.toString();
  return useQuery<{ rows: AccessReview[]; total: number }>({
    queryKey: ["iam-reviews", brand, q],
    queryFn: () => api.get<{ rows: AccessReview[]; total: number }>(`/iam/reviews${q ? `?${q}` : ""}`),
  });
}

export function useAccessReview(reviewId: string | null | undefined) {
  const brand = useBrand();
  return useQuery<AccessReview>({
    queryKey: ["iam-reviews", brand, reviewId],
    queryFn: () => api.get<AccessReview>(`/iam/reviews/${reviewId}`),
    enabled: !!reviewId,
  });
}

export function useCreateReview() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (data: { title: string; description?: string; due_date?: string }) =>
      api.post("/iam/reviews", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["iam-reviews", brand] }),
  });
}

export function useUpdateReview() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ reviewId, patch }: { reviewId: string; patch: Partial<AccessReview> }) =>
      api.patch(`/iam/reviews/${reviewId}`, patch),
    onSuccess: (_data, { reviewId }) => {
      qc.invalidateQueries({ queryKey: ["iam-reviews", brand] });
      qc.invalidateQueries({ queryKey: ["iam-reviews", brand, reviewId] });
    },
  });
}

export function useDecideEntry() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({
      reviewId,
      entryId,
      decision,
      reviewer_note,
    }: {
      reviewId: string;
      entryId: string;
      decision: string;
      reviewer_note?: string;
    }) =>
      api.patch(`/iam/reviews/${reviewId}/entries/${entryId}`, {
        decision,
        reviewer_note,
      }),
    onSuccess: (_data, { reviewId }) => {
      qc.invalidateQueries({ queryKey: ["iam-reviews", brand, reviewId] });
    },
  });
}

// ════════════════════════════════════════════════════════════
// TOTP
// ════════════════════════════════════════════════════════════
export function useTotpStatus() {
  const brand = useBrand();
  return useQuery<{ enabled: boolean }>({
    queryKey: ["totp-status", brand],
    queryFn: () => api.get<{ enabled: boolean }>("/iam/totp/status"),
  });
}

export function useTotpSetup() {
  return useMutation({
    mutationFn: () => api.post<TotpSetupResponse>("/iam/totp/setup"),
  });
}

export function useTotpVerify() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (data: { code: string }) =>
      api.post("/iam/totp/verify", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["totp-status", brand] }),
  });
}

export function useTotpDisable() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (data: { password: string }) =>
      api.post("/iam/totp/disable", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["totp-status", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Export helpers
// ════════════════════════════════════════════════════════════
export async function downloadAuditExport(
  filters: AuditFilters,
  format: "csv" | "xlsx",
) {
  const qs = new URLSearchParams();
  if (filters.module) qs.set("module", filters.module);
  if (filters.action) qs.set("action", filters.action);
  if (filters.user_search) qs.set("user_search", filters.user_search);
  if (filters.date_from) qs.set("date_from", filters.date_from);
  if (filters.date_to) qs.set("date_to", filters.date_to);
  if (filters.is_sensitive !== undefined) qs.set("is_sensitive", String(filters.is_sensitive));
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.per_page) qs.set("per_page", String(filters.per_page));
  qs.set("format", format);
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
  const res = await fetch(`${base}/iam/audit/export?${qs}`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadReviewExport(
  reviewId: string,
  format: "csv" | "xlsx",
) {
  const qs = new URLSearchParams();
  qs.set("format", format);
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
  const res = await fetch(`${base}/iam/reviews/${reviewId}/export?${qs}`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `access-review-${reviewId}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
