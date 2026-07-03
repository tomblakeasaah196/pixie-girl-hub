/**
 * App-wide toast feedback (separate from the socket-notification toasts in
 * components/notifications). This is the "did my save work?" layer: every
 * write across the admin can call `toast.success(...)` / `toast.error(...)` and
 * get an unmissable glass toast instead of a silent no-op.
 *
 * Error toasts can carry an `ErrorReportContext`; the Toaster then renders a
 * one-tap "Contact System Admin" (JBS Praxis) action that screenshots the page
 * and opens a pre-filled WhatsApp / email. See lib/error-report.ts.
 */

import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info";

/** What went wrong + where — enough for JBS Praxis to triage without a call. */
export interface ErrorReportContext {
  /** Human area, e.g. "Storefront Studio → Pages". */
  area: string;
  /** What the operator was doing, e.g. "Save page draft". */
  action: string;
  /** The error message shown to the operator. */
  message: string;
  /** Optional extra (status code, error code). */
  detail?: string;
}

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  /** Auto-dismiss after this many ms. 0 = sticky (stays until dismissed). */
  durationMs: number;
  /** Present on failures — powers the "Contact System Admin" report action. */
  report?: ErrorReportContext;
}

interface ToastStore {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let seq = 0;
const nextId = () => `t${Date.now()}-${seq++}`;

export const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (t) => {
    const id = nextId();
    // Cap the stack at 4 (drop the oldest) so a burst of errors can't bury the UI.
    set((s) => ({ items: [...s.items, { id, ...t }].slice(-4) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
  clear: () => set({ items: [] }),
}));

interface Opts {
  description?: string;
  durationMs?: number;
  report?: ErrorReportContext;
}

/**
 * Imperative helper usable outside React (event handlers, catch blocks).
 * Success/info auto-dismiss; errors default to STICKY when they carry a report
 * context so the operator has time to tap "Contact System Admin".
 */
export const toast = {
  success(title: string, opts: Opts = {}) {
    return useToastStore.getState().push({
      variant: "success",
      title,
      description: opts.description,
      durationMs: opts.durationMs ?? 3500,
    });
  },
  info(title: string, opts: Opts = {}) {
    return useToastStore.getState().push({
      variant: "info",
      title,
      description: opts.description,
      durationMs: opts.durationMs ?? 4000,
    });
  },
  error(title: string, opts: Opts = {}) {
    return useToastStore.getState().push({
      variant: "error",
      title,
      description: opts.description,
      report: opts.report,
      // Sticky when there's a report to file; otherwise a long 9s.
      durationMs: opts.durationMs ?? (opts.report ? 0 : 9000),
    });
  },
  dismiss(id: string) {
    useToastStore.getState().dismiss(id);
  },
};
