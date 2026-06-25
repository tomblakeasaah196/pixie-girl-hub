"use client";

/**
 * Minimal, dependency-free toast store (Zustand — already a dep via cart-store).
 *
 * Exists so a buyer-facing failure can NEVER be silent: the checkout button and
 * the Pay submit route their errors through `toast.error(...)`, and <Toaster />
 * (mounted in the root layout) renders them on every page. Use the `toast`
 * helper from anywhere — including non-React callbacks — via `getState()`.
 */
import { create } from "zustand";

export type ToastTone = "error" | "success" | "info";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  /** ms before auto-dismiss; 0 = sticky (caller must dismiss). */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    const duration = t.duration ?? 6000;
    // Cap the stack so a retry storm can't bury the screen.
    set((s) => ({
      toasts: [...s.toasts.slice(-3), { id, duration, ...t }],
    }));
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative helper usable outside React (event handlers, catch blocks). */
export const toast = {
  error: (title: string, body?: string, duration?: number) =>
    useToasts.getState().push({ tone: "error", title, body, duration }),
  success: (title: string, body?: string, duration?: number) =>
    useToasts.getState().push({ tone: "success", title, body, duration }),
  info: (title: string, body?: string, duration?: number) =>
    useToasts.getState().push({ tone: "info", title, body, duration }),
};
