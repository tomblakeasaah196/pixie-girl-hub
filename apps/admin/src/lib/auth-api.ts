/**
 * Auth API — the thin client for /api/v1/auth/* and the public geo feed.
 * Token plumbing (in-memory access token + httpOnly refresh cookie +
 * silent refresh) lives in lib/api.ts; this module just shapes the calls.
 */

import { api, setAccessToken } from "@/lib/api";

/** The user object the backend returns from /auth/login + /auth/login-pin. */
export interface AuthUser {
  user_id: string;
  email: string;
  display_name: string;
  is_ceo: boolean;
  available_businesses: string[];
  default_business_key: string | null;
}

interface LoginResponse {
  user: AuthUser;
  access_token: string;
  expires_in: number;
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<AuthUser> {
  const res = await api.post<LoginResponse>("/auth/login", { email, password });
  setAccessToken(res.access_token);
  return res.user;
}

export async function loginWithPin(
  email: string,
  pin: string,
): Promise<AuthUser> {
  const res = await api.post<LoginResponse>("/auth/login-pin", { email, pin });
  setAccessToken(res.access_token);
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
  token: string,
  newPassword: string,
): Promise<void> {
  await api.post("/auth/reset-password", { token, new_password: newPassword });
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
  return api.get<GeoWelcome>(
    `/geo-welcome${qs ? `?${qs}` : ""}`,
    "public",
  );
}
