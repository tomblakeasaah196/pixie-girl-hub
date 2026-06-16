import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getAccessToken, refreshAccessToken, setAccessToken } from "@/lib/api";
import {
  logout as apiLogout,
  fetchMyPermissions,
  type AuthUser,
} from "@/lib/auth-api";
import { useBusinessStore } from "@/stores/business";

/**
 * Auth/session (canon §5).
 *
 *  - The access token lives in memory only (lib/api.ts) — NEVER persisted.
 *  - The refresh token is an httpOnly cookie owned by the backend.
 *  - We DO persist a lightweight, non-sensitive user PROFILE so a reload
 *    can show the shell instantly while `bootstrap()` silently exchanges
 *    the refresh cookie for a fresh access token. If that exchange fails,
 *    the profile is dropped and the guard routes to /login.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Resolved permission keys "module:action" — drives permission-aware UI. */
  permissions: string[];
  permittedBusinesses: string[]; // "*" = all
  // Raw backend fields (kept for entity-selection + brand scoping).
  isCeo: boolean;
  availableBusinesses: string[];
  defaultBusinessKey: string | null;
  /** True when the user holds the factory_manager role — triggers Chinese UI default. */
  isFactoryManager: boolean;
  avatarUrl?: string | null;
}

type SessionStatus = "unknown" | "authed" | "anon";

interface AuthState {
  user: User | null;
  status: SessionStatus;
  setSession: (u: AuthUser) => void;
  signOut: () => Promise<void>;
  /** Restore a session on app boot using the refresh cookie. Idempotent. */
  bootstrap: () => Promise<void>;
  /** Fetch resolved permission grants from /auth/me/permissions and store them. */
  loadPermissions: () => Promise<void>;
  can: (module: string, action: string) => boolean;
  patchUser: (
    partial: Partial<Pick<User, "name" | "email" | "avatarUrl">>,
  ) => void;
}

/** Map the backend AuthUser onto the shell's User shape. */
export function toUser(u: AuthUser): User {
  const roleNames = u.role_names ?? [];
  return {
    id: u.user_id,
    name: u.display_name || u.email.split("@")[0],
    email: u.email,
    role: u.is_ceo
      ? "CEO · Owner"
      : roleNames.includes("factory_manager")
        ? "Factory Manager"
        : "Team Member",
    // Until the permissions module lands, a CEO/super-admin gets "*"
    // (full access); everyone else relies on server-side enforcement.
    permissions: u.is_ceo ? ["*"] : [],
    permittedBusinesses: u.is_ceo ? ["*"] : u.available_businesses,
    isCeo: u.is_ceo,
    availableBusinesses: u.available_businesses,
    defaultBusinessKey: u.default_business_key,
    isFactoryManager: roleNames.includes("factory_manager"),
  };
}

let bootstrapPromise: Promise<void> | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      status: "unknown",
      setSession: (u) => {
        const user = toUser(u);
        set({ user, status: "authed" });

        // Ensure the business context is set immediately after login
        // so X-Brand-Context is present on the very first API call.
        const { activeKey, setActive } = useBusinessStore.getState();
        const defaultKey =
          user.defaultBusinessKey ?? user.availableBusinesses[0];
        if (defaultKey && (!activeKey || activeKey !== defaultKey)) {
          setActive(defaultKey);
        }

        // Fire-and-forget: load real permission grants after login.
        get()
          .loadPermissions()
          .catch(() => {
            /* non-fatal */
          });
      },
      signOut: async () => {
        await apiLogout();
        set({ user: null, status: "anon" });
      },
      loadPermissions: async () => {
        const user = get().user;
        if (!user) return;
        // CEO already has ["*"] — no need to fetch.
        if (user.isCeo) return;
        try {
          const grants = await fetchMyPermissions();
          // CEO synthetic grant from backend: [{module:"*",action:"*"}]
          const isSuperGrant = grants.some((g) => g.module === "*");
          const permissions = isSuperGrant
            ? ["*"]
            : grants.map((g) => `${g.module}:${g.action}`);
          set({ user: { ...user, permissions } });
        } catch {
          // Non-fatal: keep whatever permissions the user already has.
        }
      },
      bootstrap: async () => {
        if (bootstrapPromise) return bootstrapPromise;
        bootstrapPromise = (async () => {
          // Already hold a live access token (e.g. just logged in).
          if (getAccessToken()) {
            set({ status: "authed" });
            return;
          }
          // A persisted profile means we were signed in — try to revive
          // the session from the refresh cookie.
          if (get().user) {
            const ok = await refreshAccessToken();
            if (ok) {
              set({ status: "authed" });
              // Reload permissions after session revival.
              get()
                .loadPermissions()
                .catch(() => {
                  /* non-fatal */
                });
              return;
            }
            setAccessToken(null);
            set({ user: null, status: "anon" });
            return;
          }
          set({ status: "anon" });
        })();
        try {
          await bootstrapPromise;
        } finally {
          bootstrapPromise = null;
        }
      },
      can: (module, action) => {
        const p = get().user?.permissions ?? [];
        return (
          p.includes("*") ||
          p.includes(`${module}:*`) ||
          p.includes(`${module}:${action}`)
        );
      },
      patchUser: (partial) => {
        const u = get().user;
        if (u) set({ user: { ...u, ...partial } });
      },
    }),
    {
      name: "pgh-auth",
      // Persist ONLY the non-sensitive profile — never the token/status.
      partialize: (s) => ({ user: s.user }),
    },
  ),
);
