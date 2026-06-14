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
