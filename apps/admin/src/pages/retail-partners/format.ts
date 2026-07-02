/** Date helpers for the retail-partners module (kept out of parts.tsx so
 *  that file only exports components — react-refresh rule). */

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Today (or a given day) as the YYYY-MM-DD the Zod .date() schemas want. */
export function isoDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
