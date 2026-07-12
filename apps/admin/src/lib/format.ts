/** Formatting helpers. Money is NGN-based with a display currency (canon §4.6). */

const SYMBOLS: Record<string, string> = {
  NGN: "₦",
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "C$",
  GHS: "₵",
};

export function money(amount: number, currency = "NGN"): string {
  const sym = SYMBOLS[currency] ?? "";
  return `${sym}${Math.round(amount).toLocaleString("en-NG")}`;
}

/** Compact money for KPIs/tiles: ₦18.4M, ₦497k. */
export function moneyCompact(amount: number, currency = "NGN"): string {
  const sym = SYMBOLS[currency] ?? "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${sym}${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${Math.round(amount / 1_000)}k`;
  return `${sym}${amount}`;
}

export function initials(name: string): string {
  return name
    .split(/\s|-/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function hexToTriplet(hex: string): string {
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
}

/* ── Date / time formatting ───────────────────────────────────────────── */
/**
 * Canonical human-friendly timestamp format across the admin app.
 * Renders a machine ISO string (e.g. "2026-07-06T23:00:00.000Z") as
 * "19:17, 07/04/2026" — 24-hour local time, then day/month/year.
 * Returns "—" for null/undefined/invalid values.
 */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${hhmm(d)}, ${ddmmyyyy(d)}`;
}

/** "07/04/2026" — date only, DD/MM/YYYY. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return ddmmyyyy(d);
}

/** "19:17" — 24-hour local time only. */
export function formatTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return hhmm(d);
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // A bare calendar date ("2026-07-11", a DATE column) must render as that
  // same day for every viewer — parse it at local midnight so a browser west
  // of UTC can't roll it back to the previous day.
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function ddmmyyyy(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
