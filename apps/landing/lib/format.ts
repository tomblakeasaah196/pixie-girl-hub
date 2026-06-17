export type Currency = "NGN" | "USD" | "GBP" | "EUR" | "CAD" | "GHS";

const SYMBOLS: Record<string, string> = {
  NGN: "₦",
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "C$",
  GHS: "₵",
};

export function money(amount: number, currency: Currency | string = "NGN"): string {
  const sym = SYMBOLS[currency] ?? "";
  const value = Math.round(Number(amount || 0));
  return `${sym}${value.toLocaleString("en-NG")}`;
}

export function moneyDecimal(amount: number, currency: Currency | string = "NGN"): string {
  const sym = SYMBOLS[currency] ?? "";
  const value = Number(amount || 0);
  return `${sym}${value.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function moneyCompact(amount: number, currency: Currency | string = "NGN"): string {
  const sym = SYMBOLS[currency] ?? "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${sym}${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${Math.round(amount / 1_000)}k`;
  return `${sym}${amount}`;
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : plural ?? `${singular}s`;
}

/** Returns "in 3 days · 04 hrs" style relative copy. */
export function humanizeRemaining(ms: number): string {
  if (ms <= 0) return "ended";
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days} ${pluralize(days, "day")} · ${String(hours).padStart(2, "0")}h`;
  if (hours > 0) return `${hours} ${pluralize(hours, "hour")} · ${String(mins).padStart(2, "0")}m`;
  return `${mins} ${pluralize(mins, "minute")}`;
}

export function citySlug(name: string | null | undefined): string {
  if (!name) return "Lagos";
  return name.split(",")[0].trim();
}
