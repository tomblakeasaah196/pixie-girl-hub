/**
 * Posting map — the single source of truth for which GL account every
 * business event posts to (V2.2 §6.6; ratified accounting policy 2026-07).
 *
 * Every module that builds journal lines resolves its account codes HERE,
 * never from inline literals, so the chart stays consistent with the seed
 * (migrations/template/000035 + 000075) and a code change is one edit.
 *
 * The codes must match the per-brand chart_of_accounts seed. postEntry
 * resolves code → account_id at posting time and rejects unknown codes, so
 * a drifted map fails loudly rather than mis-posting.
 */

"use strict";

const ACCOUNTS = Object.freeze({
  // ── Assets (1xxx) ────────────────────────────────────
  CASH_ON_HAND: "1000",
  PETTY_CASH: "1010",
  BANK_MAIN: "1100", // Bank — Operating Account (NGN)
  BANK_USD: "1110",
  SETTLEMENT_PAYSTACK: "1120",
  SETTLEMENT_STRIVE: "1130",
  SETTLEMENT_NOMBA: "1140",
  SETTLEMENT_OPAY: "1150",
  SETTLEMENT_STRIPE: "1160",
  AR_CUSTOMERS: "1200",
  IC_RECEIVABLE: "1210",
  INVENTORY_FG: "1300", // Finished goods
  INVENTORY_WIP: "1310", // In production
  INVENTORY_TRANSIT: "1320", // In transit
  PREPAID_EXPENSES: "1400",
  CASH_ADVANCES: "1410",
  WHT_RECEIVABLE: "1420",
  FIXED_ASSETS_EQUIPMENT: "1500",
  ACCUM_DEPRECIATION: "1510",
  FUNDING_IN_TRANSIT: "1600",
  COD_IN_TRANSIT: "1610",

  // ── Liabilities (2xxx) ───────────────────────────────
  AP_SUPPLIERS: "2000",
  IC_PAYABLE: "2010",
  AP_FACTORY_CNY: "2020",
  GRNI: "2050",
  VAT_OUTPUT: "2100",
  VAT_INPUT: "2110",
  PAYE_PAYABLE: "2200",
  PENSION_EMPLOYEE: "2210",
  PENSION_EMPLOYER: "2220",
  NHF_PAYABLE: "2230",
  WHT_PAYABLE: "2240",
  CIT_PAYABLE: "2250",
  ACCRUED_SALARIES: "2300",
  ACCRUED_EXPENSES: "2310",
  COMMISSIONS_PAYABLE: "2260",
  CUSTOMER_DEPOSITS: "2400",
  GIFT_CARD_LIABILITY: "2410",
  LOYALTY_LIABILITY: "2420",
  LOANS_PAYABLE: "2500",

  // ── Equity (3xxx) ────────────────────────────────────
  SHARE_CAPITAL: "3000",
  RETAINED_EARNINGS: "3100",
  CURRENT_YEAR_EARNINGS: "3200",
  OWNER_DRAWINGS: "3300",

  // ── Revenue (4xxx) ───────────────────────────────────
  SALES_STOREFRONT: "4000",
  SALES_POS: "4010",
  SALES_INSTAGRAM: "4020",
  SALES_WHATSAPP: "4030",
  SALES_WHOLESALE: "4040",
  SALES_INTERCOMPANY: "4050",
  SALES_SUBSCRIPTION: "4060",
  SALES_RETURNS: "4090", // contra revenue
  SERVICE_INSTALLATION: "4100",
  SERVICE_REVAMPING: "4110",
  SERVICE_COLOUR: "4120",
  SERVICE_CUSTOMIZATION: "4130",
  SERVICE_PACKING: "4140",
  SHIPPING_REVENUE: "4200",
  OTHER_INCOME: "4900",
  FX_GAIN_REALISED: "4910",
  FX_GAIN_UNREALISED: "4920",

  // ── Expenses (5xxx) ──────────────────────────────────
  COGS: "5000",
  COGS_INTERCOMPANY: "5060",
  WASTAGE: "5080",
  SALARIES: "5100",
  COMMISSION_EXPENSE: "5110",
  BONUS_EXPENSE: "5120",
  PENSION_EMPLOYER_EXPENSE: "5130",
  NHF_EMPLOYER_EXPENSE: "5140",
  MARKETING_AD_SPEND: "5300",
  MARKETING_INFLUENCER: "5310",
  LOGISTICS_LOCAL: "5400",
  BANK_CHARGES: "5500",
  OTHER_OPERATING: "5900",
  FX_LOSS_REALISED: "5910",
  FX_LOSS_UNREALISED: "5920",
  DEPRECIATION_EXPENSE: "5930",
});

// ── Sale revenue by channel (V2.2 §6.2) ─────────────────
const REVENUE_BY_CHANNEL = Object.freeze({
  storefront: ACCOUNTS.SALES_STOREFRONT,
  pos: ACCOUNTS.SALES_POS,
  instagram: ACCOUNTS.SALES_INSTAGRAM,
  whatsapp: ACCOUNTS.SALES_WHATSAPP,
  wholesale: ACCOUNTS.SALES_WHOLESALE,
  intercompany: ACCOUNTS.SALES_INTERCOMPANY,
  subscription: ACCOUNTS.SALES_SUBSCRIPTION,
  public_form: ACCOUNTS.SALES_STOREFRONT,
  facebook: ACCOUNTS.SALES_INSTAGRAM,
  tiktok: ACCOUNTS.SALES_INSTAGRAM,
  phone: ACCOUNTS.SALES_STOREFRONT,
  event: ACCOUNTS.SALES_POS,
});

function revenueAccountForChannel(channel) {
  return REVENUE_BY_CHANNEL[channel] || ACCOUNTS.SALES_STOREFRONT;
}

// ── Payment-gateway processing fees (§6.6/§6.21) ────────
const GATEWAY_FEE_ACCOUNT = Object.freeze({
  paystack: "5511",
  opay: "5512",
  nomba: "5513",
});
const STRIPE_FEE_ACCOUNT_BY_CCY = Object.freeze({
  USD: "5514",
  GBP: "5515",
  EUR: "5516",
  CAD: "5517",
  GHS: "5518",
});

/** Fee expense account for a gateway (Stripe splits by settlement ccy). */
function gatewayFeeAccount(provider, paid_currency) {
  if (provider === "stripe")
    return (
      STRIPE_FEE_ACCOUNT_BY_CCY[(paid_currency || "USD").toUpperCase()] ||
      STRIPE_FEE_ACCOUNT_BY_CCY.USD
    );
  return GATEWAY_FEE_ACCOUNT[provider] || null;
}

// ── Gateway settlement accounts (policy Q4) ─────────────
// A captured payment debits the gateway's own settlement asset, not the
// bank — the money is float until the gateway pays out, and bank rec
// clears settlement → 1100 when the statement line lands.
const SETTLEMENT_BY_PROVIDER = Object.freeze({
  paystack: ACCOUNTS.SETTLEMENT_PAYSTACK,
  opay: ACCOUNTS.SETTLEMENT_OPAY,
  nomba: ACCOUNTS.SETTLEMENT_NOMBA,
  stripe: ACCOUNTS.SETTLEMENT_STRIPE,
});

/** Settlement account a captured payment debits (bank for direct/manual). */
function settlementAccountForProvider(provider) {
  return SETTLEMENT_BY_PROVIDER[provider] || ACCOUNTS.BANK_MAIN;
}

module.exports = {
  ACCOUNTS,
  REVENUE_BY_CHANNEL,
  revenueAccountForChannel,
  GATEWAY_FEE_ACCOUNT,
  STRIPE_FEE_ACCOUNT_BY_CCY,
  gatewayFeeAccount,
  SETTLEMENT_BY_PROVIDER,
  settlementAccountForProvider,
};
