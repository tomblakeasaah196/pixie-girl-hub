/**
 * Fetch wrapper for the admin app.
 *
 * Session model (canon §5, non-negotiable #2/#10):
 *  - The access token lives ONLY in memory (this module), never in
 *    localStorage — XSS can't read it.
 *  - The refresh token is an httpOnly cookie set by the backend; we send
 *    it by using `credentials: "include"` on every call.
 *  - On a 401 for an authed call we silently POST /auth/refresh once,
 *    re-set the access token, and retry the original request. If refresh
 *    fails, we clear the token and surface the 401 so the guard can route
 *    to /login.
 *
 * Brand context (canon §4) rides on X-Brand-Context, read from the
 * persisted business store without importing it (avoids a cycle).
 */

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
// Public endpoints are mounted at /api/public/* (no /v1). Derive the root.
const API_ROOT = API_BASE.replace(/\/v1\/?$/, "");

export type Json = unknown;

class ApiError extends Error {
  status: number;
  body: Json;
  code?: string;
  constructor(status: number, body: Json, message: string) {
    super(message);
    this.status = status;
    this.body = body;
    this.code = (body as { error?: { code?: string }; code?: string })?.error
      ?.code as string | undefined;
  }
}

// ── In-memory access token ────────────────────────────────
let accessToken: string | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface Options {
  method?: Method;
  body?: Json;
  /** Use the public /api root (no /v1) instead of the protected /api/v1 base. */
  scope?: "v1" | "public";
  /** Internal: set when this is a retry after a silent refresh. */
  _retried?: boolean;
}

function brandContext(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("pgh-business");
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.state?.activeKey ?? null;
  } catch {
    return null;
  }
}

/** Exchange the refresh cookie for a new access token. Returns true on
 *  success. Kept out of `request` so it never recurses into itself. */
export async function refreshAccessToken(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { data?: { access_token?: string } };
    const token = json?.data?.access_token ?? null;
    if (!token) return false;
    accessToken = token;
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, scope = "v1", _retried = false } = opts;
  const base = scope === "public" ? `${API_ROOT}/public` : API_BASE;
  const url = `${base}${path}`;
  const isAuthRoute = path.startsWith("/auth/");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (scope === "v1") {
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const brand = brandContext();
    if (brand) headers["X-Brand-Context"] = brand;
  }

  const res = await fetch(url, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Silent-refresh-and-retry on a 401 — but never for the auth routes
  // themselves (login/refresh failing 401 is a real auth failure).
  if (
    res.status === 401 &&
    scope === "v1" &&
    !isAuthRoute &&
    !_retried &&
    accessToken !== null
  ) {
    const ok = await refreshAccessToken();
    if (ok) return request<T>(path, { ...opts, _retried: true });
    accessToken = null;
  }

  const text = await res.text();
  const parsed = text ? safeJson(text) : null;

  if (!res.ok) {
    const message =
      (parsed as { error?: { message?: string }; message?: string })?.error
        ?.message ||
      (parsed as { message?: string })?.message ||
      `HTTP ${res.status}`;
    throw new ApiError(res.status, parsed, message);
  }

  // Backend wraps every successful payload in { data: ... }; unwrap.
  return ((parsed as { data?: T })?.data ?? parsed) as T;
}

function safeJson(s: string): Json {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Multipart upload to an authed endpoint. Sends the in-memory access token
 *  + refresh cookie; unwraps the { data } envelope like the JSON helpers.
 *  (Kept separate so `request` stays JSON-only.) */
async function postForm<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const brand = brandContext();
  if (brand) headers["X-Brand-Context"] = brand;

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    credentials: "include",
    body: form,
  });
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    const message =
      (parsed as { error?: { message?: string }; message?: string })?.error
        ?.message ||
      (parsed as { message?: string })?.message ||
      `HTTP ${res.status}`;
    throw new ApiError(res.status, parsed, message);
  }
  return ((parsed as { data?: T })?.data ?? parsed) as T;
}

export const api = {
  get: <T>(path: string, scope: Options["scope"] = "v1") =>
    request<T>(path, { method: "GET", scope }),
  postForm,
  post: <T>(path: string, body?: Json, scope: Options["scope"] = "v1") =>
    request<T>(path, { method: "POST", body, scope }),
  patch: <T>(path: string, body?: Json, scope: Options["scope"] = "v1") =>
    request<T>(path, { method: "PATCH", body, scope }),
  put: <T>(path: string, body?: Json, scope: Options["scope"] = "v1") =>
    request<T>(path, { method: "PUT", body, scope }),
  delete: <T>(path: string, scope: Options["scope"] = "v1") =>
    request<T>(path, { method: "DELETE", scope }),
};

export { ApiError };
