import { useAuth } from "@/stores/auth";
import type {
  Operator,
  OperatorRow,
  SystemSummary,
  InviteResult,
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
