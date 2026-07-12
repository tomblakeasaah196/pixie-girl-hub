/** Date helpers for the retail-partners module (kept out of parts.tsx so
 *  that file only exports components — react-refresh rule). Delegates to the
 *  app-wide canon so every surface reads the same "HH:MM, DD/MM/YYYY". */

import { formatDate, formatDateTime } from "@/lib/format";

/** Canonical "11/07/2026" (— for empty/invalid). */
export function fmtDate(iso: string | null | undefined): string {
  return formatDate(iso);
}

/** Canonical "23:57, 11/07/2026". */
export function fmtDateTime(iso: string | null | undefined): string {
  return formatDateTime(iso);
}

/** Today (or a given day) as the YYYY-MM-DD the Zod .date() schemas want. */
export function isoDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
