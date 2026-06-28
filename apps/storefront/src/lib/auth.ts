import { api, setAuthToken } from "./api";

/*
 * Customer auth client. Access token lives in memory (setAuthToken); the refresh
 * token is an httpOnly cookie the browser sends automatically. On app load,
 * call bootstrapAuth() once to silently refresh, so a returning customer stays
 * signed in across reloads.
 */

export interface CustomerProfile {
  contact_id: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  primary_phone?: string;
  loyalty_points?: number;
}

interface AuthResult {
  access_token: string;
  contact?: CustomerProfile;
}

export async function register(body: {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}): Promise<AuthResult> {
  const r = await api.post<AuthResult>("/api/public/auth/register", body);
  setAuthToken(r.access_token);
  return r;
}

export async function login(body: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const r = await api.post<AuthResult>("/api/public/auth/login", body);
  setAuthToken(r.access_token);
  return r;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/api/public/auth/logout");
  } finally {
    setAuthToken(null);
  }
}

/** Silent refresh on load. Returns true when a session was restored. */
export async function bootstrapAuth(): Promise<boolean> {
  try {
    const r = await api.post<{ access_token: string }>("/api/public/auth/refresh");
    setAuthToken(r.access_token);
    return true;
  } catch {
    setAuthToken(null);
    return false;
  }
}

export const getMe = () => api.get<CustomerProfile>("/api/public/auth/me");

export const getMyOrders = () =>
  api.get<
    {
      order_number: string;
      status: string;
      total_ngn: string;
      display_currency?: string;
      display_total?: string | null;
      created_at: string;
      public_tracking_token?: string;
    }[]
  >("/api/public/auth/orders");

/** Merge the guest cart into the customer cart (call right after login). */
export async function mergeGuestCart(): Promise<void> {
  try {
    await api.post("/api/public/storefront/cart/merge");
  } catch {
    /* non-fatal: a failed merge just leaves the guest cart behind */
  }
}
