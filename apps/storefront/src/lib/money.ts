/**
 * Parametric money display for the storefront.
 *
 * All catalogue prices are anchored in NGN. A foreign figure is always
 * NGN ÷ rate, where rate = NGN per 1 unit of the currency — the SAME rate the
 * server settles at (see backend currency.service). This module holds a small
 * CLIENT-SIDE runtime cache of the active currencies + their SSOT rates,
 * hydrated once from `GET /api/public/storefront/currencies` (see
 * useCurrencyFeed). Display helpers read that cache so a new currency added in
 * admin (GBP/EUR/…) renders everywhere with zero code — the toolbar and every
 * `priceFor`/`fmt` call become currency-agnostic.
 *
 * Conversion mirrors the Sales Campaign Landing exactly: foreign amounts round
 * UP to the currency's rounding unit (e.g. ₦ ÷ 1,300 → whole dollars, 10.29 →
 * $11) so the displayed figure equals what the gateway charges. Before the feed
 * hydrates (SSR / first paint) helpers fall back to NGN, which is the default
 * for the overwhelming majority (Nigerian) of visitors.
 */

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  rounding_unit: number;
  /** NGN per 1 unit of this currency (display = ngn / rate). NGN itself = 1. */
  rate_to_ngn: number;
  /** Whether the store can CHARGE in this currency (a gateway account exists). */
  settlement: boolean;
}

/** Symbols known offline so NGN/USD render correctly before the feed loads. */
const FALLBACK_SYMBOLS: Record<string, string> = {
  NGN: "₦",
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "C$",
  GHS: "₵",
  CNY: "¥",
};

let RUNTIME: { byCode: Record<string, CurrencyInfo>; list: CurrencyInfo[] } = {
  byCode: {},
  list: [],
};

/** Hydrate the currency runtime from the server feed (called once at app root).
 *  Broadcasts so already-mounted price components re-render with live rates. */
export function setCurrencyRuntime(list: CurrencyInfo[]): void {
  const byCode: Record<string, CurrencyInfo> = {};
  for (const c of list) byCode[c.code] = c;
  RUNTIME = { byCode, list };
  try {
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("sf:currency-runtime"));
  } catch {
    /* SSR / non-DOM — no listeners to notify */
  }
}

export function activeCurrencies(): CurrencyInfo[] {
  return RUNTIME.list;
}

export function currencyInfo(code: string): CurrencyInfo | undefined {
  return RUNTIME.byCode[code];
}

export function symbolFor(code: string): string {
  return RUNTIME.byCode[code]?.symbol ?? FALLBACK_SYMBOLS[code] ?? "";
}

/** NGN per 1 unit of `code`. NGN → 1. Returns null when unknown (no rate yet). */
export function rateToNgn(code: string): number | null {
  if (code === "NGN") return 1;
  const r = RUNTIME.byCode[code]?.rate_to_ngn;
  return typeof r === "number" && r > 0 ? r : null;
}

/**
 * The currency an order will actually CHARGE in for a given display currency:
 * NGN → NGN; a settlement-enabled currency → itself; any other → USD (the buyer
 * sees their currency but pays USD). Mirrors the backend resolveSettlementCurrency.
 */
export function settlementFor(code: string): string {
  if (code === "NGN") return "NGN";
  return RUNTIME.byCode[code]?.settlement ? code : "USD";
}

/** Convert an NGN amount into `code`, rounding UP to the currency's unit. */
export function convertFromNgn(ngn: number, code: string): number | null {
  const n = Number(ngn) || 0;
  if (code === "NGN") return Math.round(n);
  const rate = rateToNgn(code);
  if (!rate) return null;
  const unit = RUNTIME.byCode[code]?.rounding_unit || 1;
  return Math.ceil(n / rate / unit) * unit;
}

/** Format an amount ALREADY denominated in `code` (no conversion). */
export function formatCurrency(
  amount: number | string | null | undefined,
  code: string,
): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (n == null || !Number.isFinite(n)) return `${symbolFor(code)}—`;
  const info = RUNTIME.byCode[code];
  const unit = info?.rounding_unit ?? (code === "NGN" ? 1 : 1);
  const maxFrac = unit < 1 ? (info?.decimals ?? 2) : 0;
  return `${symbolFor(code)}${n.toLocaleString(undefined, {
    maximumFractionDigits: maxFrac,
  })}`;
}

/** Convert an NGN amount into `code` and format it. Falls back to NGN when the
 *  currency has no rate yet (feed not hydrated), so a price is never blank. */
export function formatFromNgn(ngn: number, code: string): string {
  if (code === "NGN") return formatCurrency(Math.round(Number(ngn) || 0), "NGN");
  const v = convertFromNgn(ngn, code);
  if (v == null) return formatCurrency(Math.round(Number(ngn) || 0), "NGN");
  return formatCurrency(v, code);
}
