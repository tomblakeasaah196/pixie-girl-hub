/**
 * Minimal fetch wrapper for the admin app.
 *
 * - Reads VITE_API_URL (set in apps/admin/.env). Falls back to a same-
 *   origin /api/v1 path so the Vite dev proxy can route the calls.
 * - Attaches the dev JWT (if one is in localStorage under `pgh-token`)
 *   so authed endpoints stop returning 401 the moment the auth module
 *   lands. Today, only /api/public/* answers; the rest 401 cleanly.
 * - Sets the active brand on X-Brand-Context — the backend
 *   brand-context middleware reads this on every authed call.
 */

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
// Public endpoints are mounted at /api/public/* (no /v1), siblings to
// /api/v1. Derive the root by stripping the trailing /v1 segment so a
// single env var configures both.
const API_ROOT = API_BASE.replace(/\/v1\/?$/, "");

export type Json = unknown;

class ApiError extends Error {
  status: number;
  body: Json;
  constructor(status: number, body: Json, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface Options {
  method?: Method;
  body?: Json;
  /** Use the public /api root (no /v1) instead of the protected /api/v1 base. */
  scope?: "v1" | "public";
}

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, scope = "v1" } = opts;
  const base = scope === "public" ? `${API_ROOT}/public` : API_BASE;
  const url = `${base}${path}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (scope === "v1") {
    const token =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("pgh-token")
        : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    // Brand context for every authed call. The shell persists the
    // active brand under `pgh-business` — we read it raw so this
    // module doesn't import the store (which would create a cycle).
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem("pgh-business");
        const parsed = raw ? JSON.parse(raw) : null;
        const brand = parsed?.state?.activeKey;
        if (brand) headers["X-Brand-Context"] = brand;
      } catch {
        /* malformed — ignore */
      }
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 204 / empty body → return null so callers don't blow up on .json()
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

export const api = {
  get: <T>(path: string, scope: Options["scope"] = "v1") =>
    request<T>(path, { method: "GET", scope }),
  post: <T>(path: string, body?: Json, scope: Options["scope"] = "v1") =>
    request<T>(path, { method: "POST", body, scope }),
  patch: <T>(path: string, body?: Json, scope: Options["scope"] = "v1") =>
    request<T>(path, { method: "PATCH", body, scope }),
  delete: <T>(path: string, scope: Options["scope"] = "v1") =>
    request<T>(path, { method: "DELETE", scope }),
};

export { ApiError };
