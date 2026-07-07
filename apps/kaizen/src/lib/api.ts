import { useAuth } from "@/stores/auth";
import type {
  Operator,
  OperatorRow,
  SystemSummary,
  InviteResult,
  ErrorListResponse,
  ErrorDetailResponse,
  ErrorFilters,
} from "@/lib/types";

const BASE = "/api/v1/kaizen";

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string[]>;
  constructor(
    message: string,
    code: string,
    status: number,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string[]> };
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ErrorBody = {};
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    /* non-JSON error */
  }
  const err = body.error;
  return new ApiError(
    err?.message || res.statusText || "Request failed",
    err?.code || "REQUEST_FAILED",
    res.status,
    err?.fields,
  );
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const token = useAuth.getState().accessToken;
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body)
    headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return false;
        const data = (await res.json()) as {
          access_token: string;
          operator: Operator;
        };
        useAuth.getState().setAuth(data.access_token, data.operator);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/** JSON fetch with a single transparent refresh-retry on 401. */
async function api<T>(
  path: string,
  init: RequestInit = {},
  { retry = true }: { retry?: boolean } = {},
): Promise<T> {
  const res = await rawFetch(path, init);
  if (res.status === 401 && retry) {
    const ok = await tryRefresh();
    if (ok) return api<T>(path, init, { retry: false });
    useAuth.getState().clear();
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── Auth ─────────────────────────────────────────────────
export async function login(email: string, password: string) {
  return api<{ operator: Operator; access_token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function bootstrapSession(): Promise<Operator | null> {
  const ok = await tryRefresh();
  return ok ? useAuth.getState().operator : null;
}

export async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    useAuth.getState().clear();
  }
}

export async function changePassword(
  current_password: string,
  new_password: string,
) {
  return api<{ ok: true }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password, new_password }),
  });
}

export async function acceptInvite(token: string, password: string) {
  return api<{ ok: true; email: string }>("/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

// ── Operators ────────────────────────────────────────────
export async function listOperators() {
  const r = await api<{ data: OperatorRow[] }>("/operators");
  return r.data;
}

export async function inviteOperator(email: string, display_name?: string) {
  const r = await api<{ data: InviteResult }>("/operators/invite", {
    method: "POST",
    body: JSON.stringify({ email, display_name }),
  });
  return r.data;
}

export async function disableOperator(id: string) {
  const r = await api<{ data: OperatorRow }>(`/operators/${id}/disable`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
  return r.data;
}

// ── System ───────────────────────────────────────────────
export async function systemSummary() {
  const r = await api<{ data: SystemSummary }>("/system/summary");
  return r.data;
}

// ── Errors (Phase 1) ─────────────────────────────────────
function errorQuery(f: ErrorFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.severity) p.set("severity", f.severity);
  if (f.source) p.set("source", f.source);
  if (f.q) p.set("q", f.q);
  if (f.page) p.set("page", String(f.page));
  if (f.page_size) p.set("page_size", String(f.page_size));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function listErrors(f: ErrorFilters) {
  return api<ErrorListResponse>(`/errors${errorQuery(f)}`);
}

export async function getErrorDetail(
  groupId: string,
  occPage = 1,
  occPageSize = 30,
) {
  return api<ErrorDetailResponse>(
    `/errors/${groupId}?occ_page=${occPage}&occ_page_size=${occPageSize}`,
  );
}

export async function resolveErrors(groupIds: string[], note?: string) {
  return api<{ data: { group_id: string; status: string }[] }>(
    "/errors/resolve",
    { method: "POST", body: JSON.stringify({ group_ids: groupIds, note }) },
  );
}

export async function ignoreErrors(groupIds: string[]) {
  return api<{ data: { group_id: string; status: string }[] }>(
    "/errors/ignore",
    { method: "POST", body: JSON.stringify({ group_ids: groupIds }) },
  );
}

export async function reopenErrors(groupIds: string[]) {
  return api<{ data: { group_id: string; status: string }[] }>(
    "/errors/reopen",
    { method: "POST", body: JSON.stringify({ group_ids: groupIds }) },
  );
}

/** Fetch the Markdown export (auth-required) and trigger a browser download. */
export async function downloadErrorExport(f: ErrorFilters) {
  const res = await rawFetch(`/errors/export${errorQuery(f)}`, {});
  if (res.status === 401) {
    const ok = await tryRefresh();
    if (!ok) {
      useAuth.getState().clear();
      throw await parseError(res);
    }
    return downloadErrorExport(f);
  }
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kaizen-errors-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Health & Performance (Phase 2) ───────────────────────
export async function healthCurrent() {
  const r = await api<{ data: import("@/lib/types").HealthCurrent }>("/health/current");
  return r.data;
}

export async function healthHistory(component: string, hours = 24) {
  const r = await api<{ data: import("@/lib/types").HealthHistoryPoint[] }>(
    `/health/history?component=${encodeURIComponent(component)}&hours=${hours}`,
  );
  return r.data;
}

export async function perfSummary(hours = 24) {
  const r = await api<{ data: import("@/lib/types").PerfSummary }>(
    `/perf/summary?hours=${hours}`,
  );
  return r.data;
}
