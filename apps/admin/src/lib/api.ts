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

import { isRecentlyActive, setIdleLimitSeconds } from "@/lib/activity";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
// Public endpoints are mounted at /api/public/* (no /v1). Derive the root.
const API_ROOT = API_BASE.replace(/\/v1\/?$/, "");

export type Json = unknown;

class ApiError extends Error {
  status: number;
  body: Json;
  code?: string;
  constructor(status: number, body: Json, message: string, code?: string) {
    super(message);
    this.status = status;
    this.body = body;
    this.code =
      code ??
      ((body as { error?: { code?: string }; code?: string })?.error
        ?.code as string | undefined);
  }
}

/** Thrown whenever a request never got a response at all — the browser
 *  couldn't reach the server (offline, DNS failure, connection reset,
 *  dropped mid-stream). Distinct from a `4xx`/`5xx` ApiError, which means
 *  the server was reachable and answered. Status codes like 500 already
 *  carry their own explanation from the backend; this is the one case
 *  where the client has to explain itself, so the message is written for
 *  a non-technical reader — no "fetch failed" jargon. */
function networkError(): ApiError {
  const online = typeof navigator === "undefined" || navigator.onLine;
  const message = online
    ? "Your connection looks slow or unstable right now. Try switching networks — e.g. from Wi-Fi to mobile data, or moving closer to your router — then try again."
    : "You're not connected to the internet. Check your Wi-Fi or mobile data, then try again.";
  return new ApiError(0, null, message, "NETWORK_ERROR");
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

/** X-User-Activity marks requests backed by recent human input — the only
 *  signal the backend accepts to re-arm the 45-minute idle window (see
 *  session-idle.js). Background refetches carry no header, so an abandoned
 *  tab's polling can never keep its session alive. */
function activityHeader(): string | null {
  return isRecentlyActive() ? "1" : null;
}

function brandContext(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("pgh-business");
    const parsed = raw ? JSON.parse(raw) : null;
    const key = parsed?.state?.activeKey ?? null;
    if (key) return key;

    // Fallback: use defaultBusinessKey from persisted auth store
    const authRaw = localStorage.getItem("pgh-auth");
    const authParsed = authRaw ? JSON.parse(authRaw) : null;
    return authParsed?.state?.user?.defaultBusinessKey ?? null;
  } catch {
    return null;
  }
}

/** True if this device believes it has (or just had) a live session — either
 *  an in-memory access token or a persisted profile from a prior sign-in.
 *  Used to decide whether a failed silent-refresh is a real session expiry
 *  (worth surfacing) versus just an anonymous 401. */
function hadKnownSession(): boolean {
  if (accessToken) return true;
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem("pgh-auth");
    const parsed = raw ? JSON.parse(raw) : null;
    return !!parsed?.state?.user;
  } catch {
    return false;
  }
}

/** Once a session has been declared expired on this device, it stays locked
 *  — surviving a reload — until the user re-proves identity (password/PIN).
 *  Without this, hitting refresh while the SessionExpiredOverlay is up (or
 *  right after it fires) let `bootstrap()` silently exchange the still-valid
 *  httpOnly refresh cookie for a brand-new access token, handing back full
 *  access with no credential check at all. Stored in localStorage (not the
 *  in-memory token) specifically so it survives the reload it's meant to
 *  guard against. */
const SESSION_LOCK_KEY = "pgh-session-locked";

export function isSessionLocked(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(SESSION_LOCK_KEY) === "1"
  );
}

/** Clears the lock after the user has re-proven identity via password/PIN. */
export function clearSessionLock(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(SESSION_LOCK_KEY);
  }
}

/** Broadcasts that a previously-authed session just failed to refresh (the
 *  refresh cookie itself has expired or been revoked — typically after long
 *  inactivity). A root-level listener (SessionExpiredOverlay) blurs the app
 *  and prompts for password/PIN re-entry rather than letting every in-flight
 *  call fail silently with its own error. */
export const SESSION_EXPIRED_EVENT = "pgh:session-expired";
function notifySessionExpired() {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(SESSION_LOCK_KEY, "1");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

/** Exchange the refresh cookie for a new access token. Returns true on
 *  success. Kept out of `request` so it never recurses into itself.
 *
 *  The refresh token is single-use and rotates server-side on every call
 *  (old jti deleted, new one issued — see auth.service.js#refresh). If two
 *  requests 401 around the same moment (e.g. several queries refetching at
 *  once after the tab was idle past the access-token's life), each used
 *  to fire its own /auth/refresh with the same still-valid cookie; the
 *  loser of that race got back TOKEN_REVOKED and wrongly told the app the
 *  whole session had expired, popping the password modal, even though the
 *  winner had just silently refreshed it. Sharing one in-flight promise
 *  across concurrent callers means only one refresh call ever goes out.
 */
let refreshPromise: Promise<boolean> | null = null;
export function refreshAccessToken(): Promise<boolean> {
  // A locked session must never be silently revived — not even by a fresh
  // page load — until the user re-enters a password or PIN.
  if (isSessionLocked()) return Promise.resolve(false);
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      // A refresh triggered by a real user re-arms the idle window; one
      // triggered by background polling only passes if the window is open.
      const active = activityHeader();
      if (active) headers["X-User-Activity"] = active;
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers,
        credentials: "include",
      });
      if (!res.ok) return false;
      const json = (await res.json()) as {
        data?: { access_token?: string; idle_timeout_s?: number };
      };
      const token = json?.data?.access_token ?? null;
      if (!token) return false;
      accessToken = token;
      setIdleLimitSeconds(json?.data?.idle_timeout_s);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, scope = "v1", _retried = false } = opts;
  const base = scope === "public" ? `${API_ROOT}/public` : API_BASE;
  const url = `${base}${path}`;
  // Auth routes are excluded from silent-refresh-and-retry (a 401 from
  // login/refresh IS the failure) — except heartbeat, which is an ordinary
  // authed call that just happens to live under /auth/: its 401 must run
  // the refresh machinery so an idle-expired session locks the screen.
  const isAuthRoute =
    path.startsWith("/auth/") && path !== "/auth/heartbeat";

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (scope === "v1") {
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const brand = brandContext();
    if (brand) headers["X-Brand-Context"] = brand;
    const active = activityHeader();
    if (active) headers["X-User-Activity"] = active;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: "include",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw networkError();
  }

  // Silent-refresh-and-retry on a 401 — but never for the auth routes
  // themselves (login/refresh failing 401 is a real auth failure). We attempt
  // the refresh even when there is NO in-memory access token: the access token
  // lives in memory only, so a hard reload (or a single earlier transient
  // refresh failure) leaves it null while the httpOnly refresh cookie is still
  // valid. Previously this was gated on `accessToken !== null`, which stranded
  // every subsequent request with a header-less "Authorization header missing"
  // 401 and no recovery until a full page reload.
  if (res.status === 401 && scope === "v1" && !isAuthRoute && !_retried) {
    const hadSession = hadKnownSession();
    const ok = await refreshAccessToken();
    if (ok) return request<T>(path, { ...opts, _retried: true });
    accessToken = null;
    if (hadSession) notifySessionExpired();
  }

  let text: string;
  try {
    text = await res.text();
  } catch {
    throw networkError();
  }
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
  // Paginated list endpoints add a sibling `meta` (page/total/has_more) —
  // that shape IS the payload callers expect (PaginatedResponse<T>), so
  // leave it intact rather than unwrapping past it.
  const obj = parsed as { data?: T; meta?: unknown } | null;
  if (obj && typeof obj === "object" && "data" in obj) {
    return ("meta" in obj ? obj : obj.data) as T;
  }
  return parsed as T;
}

function safeJson(s: string): Json {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export interface PostFormOptions {
  /** Upload-progress callback, 0–100. Fires as the request body streams up
   *  (and a final 100 once the body is fully sent — the server may still be
   *  processing). Enables the upload progress bars across the app. */
  onProgress?: (percent: number) => void;
  /** Abort the in-flight upload (e.g. user cancels). */
  signal?: AbortSignal;
  /** Internal: set when this is a retry after a silent token refresh. */
  _retried?: boolean;
}

/**
 * Multipart upload to an authed endpoint. Sends the in-memory access token +
 * refresh cookie and unwraps the { data } envelope like the JSON helpers.
 *
 * Built on XMLHttpRequest rather than fetch() because only XHR exposes upload
 * progress events — that's what drives the progress bars. Mirrors `request`'s
 * silent-refresh-and-retry on a 401 so a long-idle session doesn't drop an
 * upload.
 */
function postForm<T>(
  path: string,
  form: FormData,
  opts: PostFormOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);
    xhr.withCredentials = true; // send the refresh cookie
    xhr.setRequestHeader("Accept", "application/json");
    if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    const brand = brandContext();
    if (brand) xhr.setRequestHeader("X-Brand-Context", brand);
    const active = activityHeader();
    if (active) xhr.setRequestHeader("X-User-Activity", active);
    // NB: never set Content-Type — the browser adds the multipart boundary.

    if (opts.onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          opts.onProgress!(Math.round((e.loaded / e.total) * 100));
        }
      };
      // Body fully sent — show complete while the server finishes processing.
      xhr.upload.onload = () => opts.onProgress!(100);
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.onload = () => {
      const text = xhr.responseText;
      const parsed = text ? safeJson(text) : null;

      // Silent-refresh-and-retry once on a 401 (token expired mid-session).
      if (xhr.status === 401 && !opts._retried && accessToken !== null) {
        const hadSession = hadKnownSession();
        refreshAccessToken().then((ok) => {
          if (ok) {
            resolve(postForm<T>(path, form, { ...opts, _retried: true }));
          } else {
            accessToken = null;
            if (hadSession) notifySessionExpired();
            reject(new ApiError(401, parsed, "Unauthorized"));
          }
        });
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        const message =
          (parsed as { error?: { message?: string }; message?: string })?.error
            ?.message ||
          (parsed as { message?: string })?.message ||
          `HTTP ${xhr.status}`;
        reject(new ApiError(xhr.status, parsed, message));
        return;
      }
      resolve(((parsed as { data?: T })?.data ?? parsed) as T);
    };
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () =>
      reject(new DOMException("Upload cancelled", "AbortError"));

    xhr.send(form);
  });
}

/**
 * Authenticated file download (xlsx exports / import templates). Fetches the
 * blob with the bearer token + brand context, then triggers a browser save.
 * Falls back to a sensible filename when the server doesn't set one.
 */
async function download(path: string, fallbackName = "download"): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const brand = brandContext();
  if (brand) headers["X-Brand-Context"] = brand;
  const active = activityHeader();
  if (active) headers["X-User-Activity"] = active;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers,
      credentials: "include",
    });
  } catch {
    throw networkError();
  }
  if (!res.ok) throw new ApiError(res.status, null, `HTTP ${res.status}`);

  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match ? match[1] : fallbackName;

  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    throw networkError();
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Authenticated binary GET → Blob (no download prompt).
 *
 * For bytes we want to render in-page rather than save — e.g. the Geoapify
 * static map image behind the office-location picker. An <img src> can't carry
 * the in-memory bearer token, so we fetch here with the auth + brand headers
 * and hand back a Blob the caller turns into an object URL. Mirrors `request`'s
 * silent-refresh-and-retry once on a 401.
 */
async function getBlob(
  path: string,
  scope: Options["scope"] = "v1",
  _retried = false,
): Promise<Blob> {
  const base = scope === "public" ? `${API_ROOT}/public` : API_BASE;
  const headers: Record<string, string> = {};
  if (scope === "v1") {
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const brand = brandContext();
    if (brand) headers["X-Brand-Context"] = brand;
    const active = activityHeader();
    if (active) headers["X-User-Activity"] = active;
  }
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { headers, credentials: "include" });
  } catch {
    throw networkError();
  }
  if (res.status === 401 && scope === "v1" && !_retried) {
    const hadSession = hadKnownSession();
    const ok = await refreshAccessToken();
    if (ok) return getBlob(path, scope, true);
    accessToken = null;
    if (hadSession) notifySessionExpired();
  }
  if (!res.ok) throw new ApiError(res.status, null, `HTTP ${res.status}`);
  try {
    return await res.blob();
  } catch {
    throw networkError();
  }
}

/**
 * Save a file the backend has already generated and stored (e.g. an invoice or
 * receipt PDF served from /media). Fetches the bytes same-origin and saves them
 * via an <a download>, which reliably triggers a download.
 *
 * Why not window.open(): a window.open() called *after* an `await` is no longer
 * tied to the user's click, so HTTPS popup blockers silently eat it — which is
 * exactly why "Download PDF" appeared to do nothing on the live server while
 * working in local dev. We fall back to opening the URL only when the bytes
 * can't be fetched (e.g. a cross-origin CDN without CORS).
 */
export async function saveFileFromUrl(
  url: string,
  filename: string,
): Promise<void> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new ApiError(res.status, null, `HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Couldn't fetch the bytes (cross-origin CDN, transient network) — best
    // effort: open the file directly so the user still gets it.
    window.open(url, "_blank", "noopener");
  }
}

export const api = {
  get: <T>(path: string, scope: Options["scope"] = "v1") =>
    request<T>(path, { method: "GET", scope }),
  getBlob,
  postForm,
  download,
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
