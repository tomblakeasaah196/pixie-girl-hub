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
