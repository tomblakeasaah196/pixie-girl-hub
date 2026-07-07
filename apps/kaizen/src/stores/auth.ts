import { create } from "zustand";
import type { Operator } from "@/lib/types";

type Status = "idle" | "authed" | "anon";

interface AuthState {
  accessToken: string | null;
  operator: Operator | null;
  status: Status;
  setAuth: (token: string, operator: Operator) => void;
  setOperator: (operator: Operator) => void;
  clear: () => void;
}

// Access token is held in memory ONLY (never localStorage). The refresh token
// lives in an httpOnly cookie the JS never sees; on load we silently refresh.
export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  operator: null,
  status: "idle",
  setAuth: (accessToken, operator) =>
    set({ accessToken, operator, status: "authed" }),
  setOperator: (operator) => set({ operator }),
  clear: () => set({ accessToken: null, operator: null, status: "anon" }),
}));
