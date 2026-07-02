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

/* ── Portal (PR4 — stylist JWT) ────────────────────────────── */

export interface MyProfile {
  stylist_id: string;
  partner_code: string;
  display_name: string;
  status: string;
  city: string;
  state: string | null;
  country_code: string;
  service_radius_km: number;
  max_active_assignments: number;
  current_active_count: number;
  bio: string | null;
  portfolio_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  current_tier_key: string | null;
  tier_label: string | null;
  tier_color: string | null;
  current_tier_expires_at: string | null;
  on_probation: boolean;
  probation_ends_at: string | null;
  badge_token: string | null;
  badge_revoked_at: string | null;
  contract_signed_at: string | null;
  referral_code: string | null;
  avg_rating: string | null;
  rating_count: number;
  payout_currency: string;
  payout_bank_name: string | null;
  payout_account_name: string | null;
  unread_notifications: number;
  specialities: { speciality_id: string; service_key: string; display_name: string; rate: string }[];
}

export interface Offer {
  offer_id: string;
  assignment_id: string;
  assignment_number: string;
  service_key: string;
  offer_expires_at: string;
  base_rate: string | null;
  scheduled_at: string | null;
  service_address: Record<string, unknown> | null;
}

export interface Assignment {
  assignment_id: string;
  assignment_number: string;
  service_key: string;
  status: string;
  accepted_at: string | null;
  completed_at: string | null;
  scheduled_at: string | null;
  net_payout: string | null;
  payout_currency: string | null;
  payable_at: string | null;
  satisfaction_confirmed_at: string | null;
  customer_rating: number | null;
  payout_id: string | null;
  disputed_at: string | null;
  dispute_resolved_at: string | null;
}

export interface Earnings {
  assignments_on_hold_ngn: string;
  assignments_payable_ngn: string;
  paid_out_ngn: string;
  referral_totals: {
    pending_ngn: string;
    payable_ngn: string;
    paid_ngn: string;
    orders: number;
  };
  recent_payouts: Payout[];
}

export interface Payout {
  payout_id: string;
  payout_number: string;
  period_start: string;
  period_end: string;
  currency: string;
  gross_amount: string;
  platform_fee_amount: string;
  net_amount: string;
  status: string;
  paid_at: string | null;
  lines?: {
    line_id: string;
    line_kind: "assignment" | "referral";
    description: string | null;
    net_amount: string;
  }[];
}

export interface ReferralSummary {
  links: {
    link_id: string;
    code: string;
    label: string | null;
    target_path: string | null;
    clicks: number;
    is_active: boolean;
  }[];
  attributions: {
    attribution_id: string;
    order_number: string | null;
    order_total_ngn: string;
    commission_amount_ngn: string;
    status: string;
    created_at: string;
  }[];
  totals: {
    pending_ngn: string;
    payable_ngn: string;
    paid_ngn: string;
    orders: number;
  };
}

export interface PortalNotification {
  notification_id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export interface BadgeInfo {
  issued: boolean;
  verify_url?: string;
  qr_data_url?: string;
  tier_label?: string | null;
  tier_expires_at?: string | null;
  partner_code?: string;
}

export interface ContractState {
  exists: boolean;
  document_id?: string;
  signed_at?: string | null;
  status?: string;
  signing_token?: string | null;
}

const PORTAL = "/api/v1/stylist-portal";

export const portalApi = {
  login: (email: string, password: string) =>
    request<{
      stylist: {
        stylist_id: string;
        display_name: string;
        force_password_reset: boolean;
      };
      access_token: string;
    }>(`${PORTAL}/login`, { method: "POST", body: { email, password } }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean }>(`${PORTAL}/password/forgot`, {
      method: "POST",
      body: { email },
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>(`${PORTAL}/password/reset`, {
      method: "POST",
      body: { token, password },
    }),
  me: () => request<MyProfile>(`${PORTAL}/me`, { auth: true }),
  updateMe: (patch: Record<string, unknown>) =>
    request<MyProfile>(`${PORTAL}/me`, { method: "PATCH", body: patch, auth: true }),
  updatePayoutDetails: (patch: Record<string, unknown>) =>
    request<{ ok: boolean }>(`${PORTAL}/me/payout-details`, {
      method: "PATCH",
      body: patch,
      auth: true,
    }),
  offers: () => request<Offer[]>(`${PORTAL}/offers`, { auth: true }),
  assignments: (status?: string) =>
    request<Assignment[]>(
      `${PORTAL}/assignments${status ? `?status=${status}` : ""}`,
      { auth: true },
    ),
  assignmentAction: (id: string, action: "accept" | "decline" | "start" | "complete", reason?: string) =>
    request<Assignment>(`${PORTAL}/assignments/${id}/${action}`, {
      method: "POST",
      body: action === "decline" ? { reason } : {},
      auth: true,
    }),
  earnings: () => request<Earnings>(`${PORTAL}/earnings`, { auth: true }),
  payouts: () => request<Payout[]>(`${PORTAL}/payouts`, { auth: true }),
  payout: (id: string) => request<Payout>(`${PORTAL}/payouts/${id}`, { auth: true }),
  referrals: () => request<ReferralSummary>(`${PORTAL}/referrals`, { auth: true }),
  createReferralLink: (label?: string, target_path?: string) =>
    request<ReferralSummary["links"][number]>(`${PORTAL}/referrals/links`, {
      method: "POST",
      body: { label, target_path },
      auth: true,
    }),
  notifications: (unreadOnly?: boolean) =>
    request<PortalNotification[]>(
      `${PORTAL}/notifications${unreadOnly ? "?unread=true" : ""}`,
      { auth: true },
    ),
  markNotificationRead: (id: string) =>
    request(`${PORTAL}/notifications/${id}/read`, { method: "POST", auth: true }),
  markAllNotificationsRead: () =>
    request(`${PORTAL}/notifications/read-all`, { method: "POST", auth: true }),
  badge: () => request<BadgeInfo>(`${PORTAL}/badge`, { auth: true }),
  badgeCardUrl: `${PORTAL}/badge/card`,
  contract: () => request<ContractState>(`${PORTAL}/contract`, { auth: true }),
  contractDocumentUrl: `${PORTAL}/contract/document`,
  signContract: (signature_image: string) =>
    request(`${PORTAL}/contract/sign`, {
      method: "POST",
      body: { signature_image },
      auth: true,
    }),
};

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
