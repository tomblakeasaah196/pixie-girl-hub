import { clientBrand, type BrandKey } from "./brand";

/**
 * Typed Hub API client for the Storefront Website.
 *
 * Replaces EVERYTHING Supabase did in the Aura reference (its `*.functions.ts`,
 * `integrations/supabase/*`, and direct `supabase.rpc/from()` calls). One small
 * fetch wrapper that:
 *   - targets the Hub backend (relative `/api` in the browser via the vite/nginx
 *     proxy; absolute HUB_API_URL on the SSR server),
 *   - stamps `X-Brand-Context` (host-resolved; see brand.ts),
 *   - sends credentials so the httpOnly refresh cookie rides along,
 *   - unwraps the Hub `{ data }` envelope and throws an AppError-shaped error.
 *
 * SSR note: on the server, pass `ctx` (brand + incoming cookie) from the route
 * loader so the request is brand-correct and authenticated. In the browser the
 * cookie is automatic and brand comes from <html data-brand>.
 */

export interface ApiError extends Error {
  code: string;
  httpStatus: number;
  userMessage: string;
}

export interface ApiContext {
  /** Brand override (SSR). Browser auto-detects from <html data-brand>. */
  brand?: BrandKey;
  /** Raw Cookie header to forward (SSR only). */
  cookie?: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

function baseUrl(): string {
  // Browser → same-origin proxy. Server → configured Hub URL.
  if (typeof window !== "undefined") return "";
  return process.env?.HUB_API_URL || "http://localhost:7000";
}

function makeError(code: string, httpStatus: number, userMessage: string): ApiError {
  const e = new Error(userMessage) as ApiError;
  e.code = code;
  e.httpStatus = httpStatus;
  e.userMessage = userMessage;
  return e;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  ctx: ApiContext = {},
): Promise<T> {
  const brand = ctx.brand ?? (typeof window !== "undefined" ? clientBrand() : undefined);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Brand-Context": brand ?? "pixiegirl",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (ctx.cookie) headers["Cookie"] = ctx.cookie;

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
      signal: ctx.signal,
    });
  } catch {
    throw makeError("NETWORK", 0, "We couldn't reach the store. Check your connection and retry.");
  }

  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; userMessage?: string; message?: string } })?.error;
    throw makeError(
      err?.code ?? `HTTP_${res.status}`,
      res.status,
      err?.userMessage ?? err?.message ?? "Something went wrong. Please try again.",
    );
  }

  // Hub envelope is { data, meta? }; tolerate bare payloads too.
  const payload = json as { data?: T } | T;
  return (payload && typeof payload === "object" && "data" in (payload as object)
    ? (payload as { data: T }).data
    : (payload as T));
}

export const api = {
  get: <T>(path: string, ctx?: ApiContext) => request<T>("GET", path, undefined, ctx),
  post: <T>(path: string, body?: unknown, ctx?: ApiContext) => request<T>("POST", path, body, ctx),
  patch: <T>(path: string, body?: unknown, ctx?: ApiContext) => request<T>("PATCH", path, body, ctx),
  put: <T>(path: string, body?: unknown, ctx?: ApiContext) => request<T>("PUT", path, body, ctx),
  delete: <T>(path: string, ctx?: ApiContext) => request<T>("DELETE", path, undefined, ctx),
};
