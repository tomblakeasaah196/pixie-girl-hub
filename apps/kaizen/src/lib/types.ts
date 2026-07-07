export interface Operator {
  operator_id: string;
  email: string;
  display_name: string;
  must_change_password?: boolean;
}

export interface OperatorRow {
  operator_id: string;
  email: string;
  display_name: string;
  phone: string | null;
  status: "invited" | "active" | "disabled";
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface SystemSummary {
  version: string;
  node: string;
  env: string;
  uptime_s: number;
  server_time: string;
  operator: Operator;
}

export interface InviteResult {
  operator_id: string;
  email: string;
  emailed: boolean;
  invite_url: string;
  expires_at: string;
}

// ── Errors (Phase 1) ─────────────────────────────────────
export type ErrorSeverity = "info" | "warning" | "error" | "critical";
export type ErrorStatus = "open" | "resolved" | "ignored";
export type ErrorSource =
  | "backend"
  | "worker"
  | "admin"
  | "storefront"
  | "stylist"
  | "landing"
  | "kaizen"
  | "unknown";

export interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface ErrorGroup {
  group_id: string;
  fingerprint: string;
  title: string;
  error_code: string | null;
  source: ErrorSource;
  route_pattern: string | null;
  http_status: number | null;
  severity: ErrorSeverity;
  status: ErrorStatus;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  reopened_at: string | null;
  reopen_count: number;
}

export interface ErrorOccurrence {
  occurrence_id: string;
  occurred_at: string;
  request_id: string | null;
  route: string | null;
  method: string | null;
  http_status: number | null;
  brand: string | null;
  user_ref: string | null;
  message: string | null;
  stack: string | null;
  context: Record<string, unknown>;
}

export interface ErrorListResponse {
  data: ErrorGroup[];
  pagination: Pagination;
}

export interface ErrorDetailResponse {
  group: ErrorGroup & {
    resolution_note?: string | null;
    sample?: Record<string, unknown>;
  };
  occurrences: ErrorOccurrence[];
  pagination: Pagination;
}

export interface ErrorFilters {
  status?: ErrorStatus;
  severity?: ErrorSeverity;
  source?: ErrorSource;
  q?: string;
  page?: number;
  page_size?: number;
}
