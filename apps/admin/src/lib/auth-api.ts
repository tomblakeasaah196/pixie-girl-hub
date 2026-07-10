/**
 * Auth API — the thin client for /api/v1/auth/* and the public geo feed.
 * Token plumbing (in-memory access token + httpOnly refresh cookie +
 * silent refresh) lives in lib/api.ts; this module just shapes the calls.
 */

import { api, setAccessToken } from "@/lib/api";
import { setIdleLimitSeconds } from "@/lib/activity";

/** The user object the backend returns from /auth/login + /auth/login-pin. */
export interface AuthUser {
  user_id: string;
  email: string;
  display_name: string;
  is_ceo: boolean;
  role_names: string[];
  available_businesses: string[];
  default_business_key: string | null;
  /** Whether the account has completed one-time email verification. */
  email_verified: boolean;
}

interface LoginResponse {
  user: AuthUser;
  access_token: string;
  expires_in: number;
  /** Server-side idle timeout (seconds) — the client idle lock mirrors it. */
  idle_timeout_s?: number;
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<AuthUser> {
  const res = await api.post<LoginResponse>("/auth/login", { email, password });
  setAccessToken(res.access_token);
  setIdleLimitSeconds(res.idle_timeout_s);
  return res.user;
}

export async function loginWithPin(
  email: string,
  pin: string,
): Promise<AuthUser> {
  const res = await api.post<LoginResponse>("/auth/login-pin", { email, pin });
  setAccessToken(res.access_token);
  setIdleLimitSeconds(res.idle_timeout_s);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } catch {
    /* best-effort — clearing the in-memory token is what matters */
  }
  setAccessToken(null);
}

export async function forgotPassword(email: string): Promise<void> {
  // Always resolves 200 (no account enumeration) unless the network fails.
  await api.post("/auth/forgot-password", { email });
}

export async function resetPassword(
  email: string,
  otp: string,
  newPassword: string,
): Promise<void> {
  await api.post("/auth/reset-password", {
    email,
    otp,
    new_password: newPassword,
  });
}

// ── One-time email account activation (authed) ────────────
export interface ActivationSendResult {
  sent?: boolean;
  already?: boolean;
  email_masked: string;
}

/** Email a one-time activation code to the signed-in user's own address. */
export async function sendActivationCode(): Promise<ActivationSendResult> {
  return api.post<ActivationSendResult>("/auth/activate/send");
}

/** Confirm the activation code, marking the account's email verified. */
export async function confirmActivation(
  otp: string,
): Promise<{ verified: boolean }> {
  return api.post<{ verified: boolean }>("/auth/activate/confirm", { otp });
}

// ── PIN management (authed) ───────────────────────────────
export async function getPinStatus(): Promise<{ pin_set: boolean }> {
  return api.get<{ pin_set: boolean }>("/auth/pin");
}
export async function setPin(pin: string): Promise<void> {
  await api.post("/auth/pin", { pin });
}
export async function removePin(): Promise<void> {
  await api.delete("/auth/pin");
}

// ── Resolved permissions (authed, all roles union) ────────
export interface PermGrant {
  module: string;
  action: string;
  record_scope: string;
}
export async function fetchMyPermissions(): Promise<PermGrant[]> {
  return api.get<PermGrant[]>("/auth/me/permissions");
}

// ── Device-local "PIN set up here" flag ───────────────────
// Describes THIS browser only (never a credential): whether a PIN was set
// up on this device, so the login screen can default to the Quick-PIN pad.
const PIN_ENABLED_KEY = "pgh-pin-enabled";

export function isPinEnabledLocally(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(PIN_ENABLED_KEY) === "1"
  );
}

export function setPinEnabledLocally(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (enabled) localStorage.setItem(PIN_ENABLED_KEY, "1");
  else localStorage.removeItem(PIN_ENABLED_KEY);
}

// ── Geo welcome (public, per-IP, no cache) ────────────────
export interface GeoWelcome {
  location: {
    city?: string | null;
    country?: string | null;
    country_code?: string | null;
    continent_code?: string | null;
  } | null;
  welcome: string;
  note: string;
}
export async function getGeoWelcome(
  params?: Record<string, string>,
): Promise<GeoWelcome> {
  const qs = params ? new URLSearchParams(params).toString() : "";
  return api.get<GeoWelcome>(`/geo-welcome${qs ? `?${qs}` : ""}`, "public");
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await api.post("/auth/change-password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

export interface MyProfile {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  phone: string | null;
  job_title: string | null;
  department: string | null;
  employee_number: string | null;
  is_ceo: boolean;
  email_verified: boolean;
}

export async function getMe(): Promise<MyProfile> {
  return api.get<MyProfile>("/auth/me");
}

export async function updateMe(data: {
  display_name?: string;
  phone?: string;
}): Promise<MyProfile> {
  return api.patch<MyProfile>("/auth/me", data);
}

export async function uploadAvatar(
  blob: Blob,
  onProgress?: (percent: number) => void,
): Promise<{ avatar_url: string }> {
  const form = new FormData();
  form.append("avatar", blob, "avatar.jpg");
  return api.postForm<{ avatar_url: string }>("/auth/me/avatar", form, {
    onProgress,
  });
}

export async function requestEmailChange(
  currentPassword: string,
  newEmail: string,
): Promise<void> {
  await api.post("/auth/change-email", {
    current_password: currentPassword,
    new_email: newEmail,
  });
}

export async function confirmEmailChange(
  otp: string,
): Promise<{ email: string }> {
  return api.post<{ email: string }>("/auth/verify-email-change", { otp });
}
