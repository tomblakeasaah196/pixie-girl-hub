/**
 * Hub API client for the stylist portal (V2.2 §6.26).
 *
 * Public surfaces (PR3) hit /api/public/stylist-programme/* — no auth. The
 * partner dashboard (PR4) hits /api/v1/stylist-portal/* with the stylist JWT
 * (kept in memory; a page refresh re-authenticates — the stylist token class
 * has no refresh cookie by design, it is a short-session external portal).
 *
 * Browser → same-origin /api (vite/edge proxy). SSR → HUB_API_URL.
 */

export interface ApiError extends Error {
  code: string;
  httpStatus: number;
  userMessage: string;
}

function baseUrl(): string {
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

let stylistToken: string | null = null;
export function setStylistToken(token: string | null) {
  stylistToken = token;
  if (typeof sessionStorage !== "undefined") {
    if (token) sessionStorage.setItem("stylist_token", token);
    else sessionStorage.removeItem("stylist_token");
  }
}
export function getStylistToken(): string | null {
  if (stylistToken) return stylistToken;
  if (typeof sessionStorage !== "undefined")
    stylistToken = sessionStorage.getItem("stylist_token");
  return stylistToken;
}

async function request<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "PATCH";
    body?: unknown;
    form?: FormData;
    auth?: boolean;
  } = {},
): Promise<T> {
  const { method = "GET", body, form, auth = false } = opts;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getStylistToken();
    if (!token) throw makeError("AUTH_REQUIRED", 401, "Please sign in again.");
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = (parsed as { error?: { code?: string; message?: string; fields?: unknown } })
      ?.error;
    const fields = err?.fields;
    const fieldMsg =
      typeof fields === "string"
        ? fields
        : fields && typeof fields === "object"
          ? Object.values(fields as Record<string, string[]>)
              .flat()
              .join("; ")
          : null;
    throw makeError(
      err?.code ?? `HTTP_${res.status}`,
      res.status,
      fieldMsg || err?.message || "Something went wrong — please try again.",
    );
  }
  const obj = parsed as { data?: T } | null;
  return (obj && typeof obj === "object" && "data" in obj ? obj.data : parsed) as T;
}

/* ── Public (§6.26 sections A + B) ─────────────────────────── */

export interface Question {
  question_id: string;
  question: string;
  help_text: string | null;
  field_type: "text" | "textarea" | "select" | "boolean";
  options: string[] | null;
  is_required: boolean;
  display_order: number;
}

export interface DirectoryPartner {
  partner_code: string;
  display_name: string;
  city: string;
  state: string | null;
  country_code: string;
  tier_key: string | null;
  tier_label: string | null;
  tier_color: string | null;
  avg_rating: string | null;
  rating_count: number;
  bio: string | null;
  portfolio_url: string | null;
  instagram_url: string | null;
  website_url: string | null;
  badge_token: string | null;
}

export interface BadgeVerification {
  valid: boolean;
  partner_code?: string;
  display_name?: string;
  status?: string;
  on_probation?: boolean;
  city?: string;
  country_code?: string;
  current_tier?: string | null;
  tier_label?: string | null;
  tier_color?: string | null;
  tier_expires_at?: string | null;
  avg_rating?: string | null;
  rating_count?: number;
  portfolio_url?: string | null;
}

export interface ReviewContext {
  assignment_number: string;
  service_key: string;
  stylist_name: string | null;
  completed_at: string;
  already_reviewed: boolean;
  satisfaction_confirmed: boolean;
}

const PUB = "/api/public/stylist-programme";

export const publicApi = {
  questions: () => request<Question[]>(`${PUB}/questions`),
  apply: (form: FormData) =>
    request<{ stylist_id: string; partner_code: string; status: string }>(
      `${PUB}/apply`,
      { method: "POST", form },
    ),
  directory: (params: { city?: string; country_code?: string; tier?: string }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const s = qs.toString();
    return request<DirectoryPartner[]>(`${PUB}/directory${s ? `?${s}` : ""}`);
  },
  verifyBadge: (token: string) =>
    request<BadgeVerification>(`/api/public/stylist-verify/${token}`),
  reviewContext: (token: string) =>
    request<ReviewContext>(`${PUB}/review/${token}`),
  submitReview: (token: string, rating: number, review?: string) =>
    request<{ ok: boolean }>(`${PUB}/review/${token}`, {
      method: "POST",
      body: { rating, review },
    }),
};
