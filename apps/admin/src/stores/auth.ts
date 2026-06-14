import { create } from "zustand";

/**
 * Auth/session. The real app keeps the access token in memory and the refresh
 * token in an httpOnly cookie — NEVER localStorage (canon §5). This foundation
 * seeds a demo user; wire `hydrate`/`refreshFromServer` to /auth on integration.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Resolved permission keys "module:action" — drives permission-aware UI. */
  permissions: string[];
  permittedBusinesses: string[]; // "*" = all
}

interface AuthState {
  user: User | null;
  setUser: (u: User | null) => void;
  signOut: () => void;
  can: (module: string, action: string) => boolean;
}

const DEMO_USER: User = {
  id: "u_ceo",
  name: "Tom-Blake",
  email: "tomblake@pixiegirlglobal.com",
  role: "CEO · Owner",
  permissions: ["*"],
  permittedBusinesses: ["*"],
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: DEMO_USER,
  setUser: (user) => set({ user }),
  signOut: () => set({ user: null }),
  can: (module, action) => {
    const p = get().user?.permissions ?? [];
    return p.includes("*") || p.includes(`${module}:*`) || p.includes(`${module}:${action}`);
  },
}));
