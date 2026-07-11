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

// ── Health & Performance (Phase 2) ───────────────────────
export type HealthStatus = "ok" | "degraded" | "down" | "unknown";
export type HealthComponentName =
  | "db"
  | "redis"
  | "queue"
  | "disk"
  | "memory"
  | "cpu"
  | "backup"
  | "restore_drill";

export interface HealthComponent {
  component: HealthComponentName;
  status: HealthStatus;
  latency_ms: number | null;
  detail: Record<string, unknown>;
}

export interface HealthCurrent {
  overall: HealthStatus;
  captured_at: string;
  components: HealthComponent[];
}

export interface HealthHistoryPoint {
  captured_at: string;
  status: HealthStatus;
  latency_ms: number | null;
  detail: Record<string, unknown>;
}

export interface SlowRoute {
  route_pattern: string;
  method: string;
  req_count: number;
  err_count: number;
  p95_ms: number | null;
  max_ms: number | null;
}

export interface PerfSummary {
  hours: number;
  total_requests: number;
  total_errors: number;
  error_rate_pct: number;
  throughput_per_min: number;
  p95_ms: number | null;
  max_ms: number | null;
  slow_routes: SlowRoute[];
}

// ── Backups (Phase 3) ────────────────────────────────────
export type BackupKind = "logical_db" | "logical_bundle" | "full_volume";
export type BackupRunStatus = "running" | "success" | "failed" | "canceled";

export interface BackupRun {
  run_id: string;
  kind: BackupKind;
  destination_id: string | null;
  status: BackupRunStatus;
  trigger: "scheduled" | "manual" | "rerun";
  retention_class: "daily" | "weekly" | "monthly";
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  artifact_key: string | null;
  checksum: string | null;
  error: string | null;
  created_at: string;
}

export interface BackupDestination {
  destination_id: string;
  name: string;
  kind: "rclone" | "local";
  rclone_remote: string | null;
  path_prefix: string;
  is_default: boolean;
  is_active: boolean;
}

export interface BackupStatus {
  last_success: {
    kind: BackupKind;
    run_id: string;
    finished_at: string;
    size_bytes: number | null;
    duration_ms: number | null;
    artifact_key: string | null;
  }[];
  destination: {
    name: string;
    kind: string;
    rclone_remote: string | null;
    path_prefix: string;
  } | null;
  storage: { total?: number; used?: number; free?: number } | null;
  retention: { daily: number; weekly: number; monthly: number };
  restore_drill: {
    drill_id: string;
    status: RestoreDrillStatus;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
  } | null;
  schedule: { logical: string; full_volume: string; restore_drill?: string };
}

export type RestoreDrillStatus = "running" | "pass" | "fail";

export interface RestoreAssertion {
  check: string;
  expected: string;
  got: string | number;
  ok: boolean;
}

export interface RestoreDrill {
  drill_id: string;
  backup_run_id: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: RestoreDrillStatus;
  assertions: RestoreAssertion[];
  restored_row_counts: Record<string, number>;
  error: string | null;
}

// ── Alerts & Settings (Phase 5) ──────────────────────────
export type AlertSeverity = "info" | "warning" | "error" | "critical";
export type AlertStatus = "active" | "acknowledged" | "resolved";

export interface Alert {
  alert_id: string;
  rule_id: string | null;
  kind: string;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  source_ref: string | null;
  status: AlertStatus;
  channels_sent: Record<string, unknown>;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface AlertRule {
  rule_id: string;
  name: string;
  condition_type: string;
  threshold: Record<string, unknown>;
  channels: string[];
  enabled: boolean;
  updated_at: string;
}

export interface KaizenSettings {
  retention: { daily: number; weekly: number; monthly: number };
  alert_recipients: string[] | null;
  default_destination: { name: string; kind: string; rclone_remote: string | null } | null;
  ingest_key_configured: boolean;
  ingest_allowed_origins: string | null;
}
