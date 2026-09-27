/**
 * Payment initiation + automatic gateway fallback (C / PD §6.2, §6.21).
 *
 * The "pay now / pay any amount" link per order. Walks the active gateway chain
 * for the currency (payment-gateways.getActiveChain — NGN: Nomba → Paystack →
 * Stripe; non-NGN: Nomba → Stripe, where Stripe is the last-resort fallback) and
 * initialises a checkout on the first that succeeds. If a gateway errors at this
 * moment, it silently falls over to the next so the customer never sees a
 * failure (§6.21 redundancy).
 *
 * Every checkout carries metadata { brand, order_id, amount_ngn } so the
 * inbound webhook confirm resolves + records the payment (with per-gateway fee
 * capture, A). Nothing is recorded here — payment lands only on confirmation.
 */

"use strict";

const salesRepo = require("./sales.repo");
const campaignsRepo = require("../sales_campaigns/campaigns.repo");
const paymentSettings = require("./payment-settings.service");
const brandUrls = require("../../utils/brand-urls");
const gateways = require("../business_setup/payment-gateways.service");
const paystack = require("../../services/paystack.service");
const opay = require("../../services/opay.service");
const nomba = require("../../services/nomba.service");
const stripe = require("../../services/stripe.service");
const currencyService = require("../../services/currency.service");
const { query } = require("../../config/database");
const { config } = require("../../config/env");
const { money, toCurrencyString } = require("../../utils/money");
const { logger } = require("../../config/logger");
const { VALID } = require("../../config/brands");
const { NotFoundError, AppError } = require("../../utils/errors");

function makeReference(provider, orderNumber) {
  return `${provider}-${orderNumber}-${Date.now().toString(36)}`.replace(
    /[^A-Za-z0-9_-]/g,
    "",
  );
}

async function contactEmail(contact_id) {
  if (!contact_id) return null;
  try {
    // shared.contacts is GLOBAL — it has no `business` column (it scopes via
    // visible_to[]). The old `AND business = $2` filter referenced a column
    // that doesn't exist, so every lookup threw 42703 and fell into the catch
    // → a null email at the gateway (Paystack rejects a null email outright).
    // contact_id is the PK, so selecting on it alone is exact.
    const { rows } = await query(
      `SELECT email FROM shared.contacts WHERE contact_id = $1`,
      [contact_id],
    );
    return rows[0] ? rows[0].email : null;
  } catch {
    return null;
  }
}

/**
 * The email the gateway is given for this checkout.
 *
 * Walk-in / phone-only customers have NO email on their contact record — and
 * every gateway we use rejects a null `customerEmail` outright (Nomba 400,
 * Paystack "email required"). That made the whole chain fail and surfaced as a
 * bare "Failed to generate payment link" (FLH-SO-0109): the Nomba credentials
 * were fine, the customer simply had no email. A checkout is not a mailing
 * list, so we substitute a per-document no-reply address rather than blocking
 * the sale. It is unique per document, so a gateway that de-dupes customers by
 * email doesn't merge unrelated buyers.
 */
function fallbackEmail(doc_number) {
  const slug = String(doc_number || "checkout")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `no-reply+${slug}@pixiegirlhub.com`;
}

function isUsableEmail(email) {
  return typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/**
 * A gateway client throws an axios error whose `.message` is only
 * "Request failed with status code 400" — useless for diagnosing why a link
 * failed. Pull the provider's own status + description out of the response so
 * the recorded attempt says what actually went wrong.
 */
function describeGatewayError(err) {
  const res = err && err.response;
  if (res) {
    const body = res.data;
    const msg =
      (body &&
        (body.description ||
          body.message ||
          (body.data && body.data.message) ||
          (Array.isArray(body.errors) && body.errors.join("; ")))) ||
      (typeof body === "string" ? body : "");
    return `HTTP ${res.status}${msg ? ` — ${String(msg).slice(0, 300)}` : ""}`;
  }
  if (err && err.code) return `${err.code}: ${err.message || ""}`.trim();
  return err && err.message
    ? String(err.message).slice(0, 300)
    : "unknown error";
}

const toKobo = (amountStr) => Number(money(amountStr).times(100).toFixed(0));

/**
 * Refuse any charge outside NGN / USD. Nomba settles only those two, and this
 * is the one place every pay link is minted, so no caller (Quick Sale's old
 * GBP/EUR picker, a hand-built request) can route another currency to it.
 */
function assertSettlementCurrency(cur) {
  if (!currencyService.SETTLEMENT_CURRENCIES.includes(cur))
    throw new AppError(
      "UNSUPPORTED_CURRENCY",
      `Payments can only be taken in NGN or USD (requested ${cur})`,
      422,
      {
        user_message: "Payments can only be made in Naira (₦) or US Dollars ($).",
      },
    );
}

/**
 * The currency an order (or quotation) is locked to: its display_currency when
 * that is a settlement currency, else NGN. Customers always pay in this; only
 * staff may switch a balance to the other currency (owner decision, Sept 2026).
 */
function lockedCurrency(doc) {
  const cur = String((doc && doc.display_currency) || "NGN").toUpperCase();
  return currencyService.SETTLEMENT_CURRENCIES.includes(cur) ? cur : "NGN";
}

/**
 * The ₦ rate LOCKED on an order/quote for `currency`, or null. 1.0 is the
 * column default ("never captured"), so it never counts as a lock; nor does a
 * rate captured for a different currency.
 */
function lockedRate(doc, currency) {
  if (!doc || lockedCurrency(doc) !== currency) return null;
  const rate = Number(doc.fx_rate_used);
  return rate > 0 && rate !== 1 ? rate : null;
}

/**
 * The campaign's static NGN→foreign rate (ngn_per_usd_rate) for a foreign-
 * currency checkout. This is the SAME rate the landing page used to display the
 * buyer's price, so the gateway charges exactly what they saw. Returns null when
 * the order isn't tied to a campaign or the campaign has no rate set — the
 * caller then refuses to settle in a foreign currency rather than guess.
 */
async function campaignFxRate({ brand, order }) {
  if (!order || !order.sales_campaign_id) return null;
  try {
    const campaign = await campaignsRepo.findById({
      brand,
      id: order.sales_campaign_id,
    });
    const rate = campaign && campaign.ngn_per_usd_rate;
    return rate ? Number(rate) : null;
  } catch {
    return null;
  }
}

/**
 * The NGN→foreign rate to settle THIS order at, for `currency`. Precedence:
 *   1. The rate LOCKED on the order for this currency (fx_rate_used) — the exact
 *      rate the buyer was quoted (re-reading a live rate is unsafe: the owner can
 *      edit it after placement). 1.0 is the "never captured" default, and a rate
 *      locked for another currency doesn't apply, so both fall through.
 *   2. The campaign's static ₦/$ rate (campaign orders, USD only).
 *   3. The system SSOT rate for the settlement currency (currency.service):
 *      USD → the brand catalogue tool's usd_fx_rate.
 * Also used by the Nomba webhook to convert a USD capture back to Naira, so a
 * payment is credited at the same rate its checkout was charged at.
 */
async function settlementFxRate({ brand, order, currency }) {
  const cur = String(currency || lockedCurrency(order)).toUpperCase();
  const locked = lockedRate(order, cur);
  if (locked) return locked;
  if (cur === "USD") {
    const campaignRate = await campaignFxRate({ brand, order });
    if (campaignRate && campaignRate > 0) return campaignRate;
  }
  return currencyService.systemFxRate({ brand, currency: cur });
}

/**
 * Initialise a checkout on one gateway.
 *
 * `subject` is what the money is FOR — an order or (000090) a quotation:
 *   { doc_number, metadata, callback_params }
 * The gateway only ever sees `metadata`, and the inbound webhook keys off it to
 * decide what to do: `order_id` → record against that order; `quotation_id` →
 * convert the quote to an order first, then record against the new order.
 */
async function initOnGateway({
  provider,
  credentials,
  subject,
  amount_ngn,
  currency,
  charge_amount,
  email,
  return_url_base,
}) {
  const reference = makeReference(provider, subject.doc_number);
  if (!isUsableEmail(email)) email = fallbackEmail(subject.doc_number);
  const metadata = { ...subject.metadata, amount_ngn };
  const callbackParams = Object.entries(subject.callback_params || {})
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join("");
  const callback_url = return_url_base
    ? `${return_url_base.replace(/\/$/, "")}?ref=${encodeURIComponent(reference)}${callbackParams}`
    : `${config.APP_URL.replace(/\/$/, "")}/pay/callback?ref=${reference}`;

  if (provider === "paystack") {
    const data = await paystack.initializeTransaction({
      email,
      amount_kobo: toKobo(amount_ngn),
      reference,
      callback_url,
      metadata,
      creds: credentials,
    });
    const url = data && data.data && data.data.authorization_url;
    if (!url) throw new Error("paystack: no authorization_url");
    return { provider, reference, checkout_url: url };
  }
  if (provider === "nomba") {
    // Nomba denominates the checkout in the order's settlement currency, and
    // BOTH work for this account (confirmed by live webhooks):
    //   • NGN orders → currency NGN, Naira total. The buyer can still pick
    //     another currency on Nomba's hosted page; Nomba converts and settles
    //     NGN (e.g. an NGN order paid as £212.75 / $431.96).
    //   • USD orders → currency USD, the dollar `charge_amount`. The buyer pays
    //     by card via Nomba's Stripe-card option; funds settle to the USD wallet
    //     and the webhook returns currency USD (e.g. FLH-SO-0044 → $426.89,
    //     merchantTxRef "ch_…").
    // Amounts are MAJOR units in both cases (Naira / whole dollars, not minor).
    const data = await nomba.initializePayment({
      reference,
      amount: charge_amount,
      currency,
      amount_ngn,
      email,
      callback_url,
      creds: credentials,
    });
    const url =
      data && data.data && (data.data.checkoutLink || data.data.checkout_url);
    if (!url) throw new Error("nomba: no checkoutLink");
    return { provider, reference, checkout_url: url };
  }
  if (provider === "opay") {
    const data = await opay.initializePayment({
      reference,
      amount_kobo: toKobo(amount_ngn),
      email,
      callback_url,
      return_url: callback_url,
      metadata,
      creds: credentials,
    });
    const url =
      data && data.data && (data.data.cashierUrl || data.data.cashier_url);
    if (!url) throw new Error("opay: no cashierUrl");
    return { provider, reference, checkout_url: url };
  }
  if (provider === "stripe") {
    const session = await stripe.createCheckoutSession({
      reference,
      // Charge in the SETTLEMENT currency's minor units, derived from
      // `charge_amount` — which createPaymentLink already converted into that
      // currency's MAJOR units (Naira for NGN, whole dollars for USD). Using
      // amount_ngn here was the bug: for a USD order it billed the Naira total
      // as dollars (e.g. ₦505,300 → $505,300, ~1,300× the real $389), so the
      // card declined and the order stayed pending. Both NGN and USD are
      // 2-decimal in Stripe, so ×100 (toKobo) gives the right minor units.
      amount_minor: toKobo(charge_amount),
      currency: String(currency || "NGN").toLowerCase(),
      email,
      success_url: callback_url,
      cancel_url: callback_url,
      metadata,
      creds: credentials,
    });
    if (!session || !session.url) throw new Error("stripe: no session url");
    return { provider, reference, checkout_url: session.url };
  }
  throw new Error(`no initiator for ${provider}`);
}

/**
 * Create a checkout link for an order, trying the active gateway chain with
 * automatic fallback. `amount_ngn` optional → defaults to the order's
 * outstanding balance (the "pay any amount" link can pass a partial amount).
 * Returns { provider, reference, checkout_url, amount_ngn, attempts }.
 */
async function createPaymentLink({
  brand,
  order_id,
  amount_ngn,
  currency,
  return_url_base,
  preferred_provider,
}) {
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order) throw new NotFoundError("Order");
  if (["cancelled", "refunded"].includes(order.status))
    throw new AppError(
      "INVALID_STATE",
      `Cannot pay a ${order.status} order`,
      409,
    );

  const outstanding = money(order.total_ngn).minus(
    money(order.amount_paid_ngn || 0),
  );
  const amt =
    amount_ngn === null || amount_ngn === undefined
      ? outstanding
      : money(amount_ngn);
  if (amt.lte(0))
    throw new AppError("NOTHING_DUE", "Order has no outstanding balance", 409);
  if (amt.gt(outstanding))
    throw new AppError(
      "AMOUNT_EXCEEDS_BALANCE",
      "Payment amount exceeds the outstanding balance",
      422,
      {
        user_message: `Only ₦${toCurrencyString(outstanding)} is outstanding on this order.`,
      },
    );
  // Flexi Pay minimums (D5): the plan's first-payment / top-up floors are
  // enforced HERE, at initiation — never at webhook confirm time (money a
  // gateway already captured is never rejected). The exact balance is always
  // allowed. Full-plan orders are exempt (their link is the full balance).
  if (amount_ngn !== null && amount_ngn !== undefined) {
    const settings = await paymentSettings.getSettings(brand);
    paymentSettings.assertPaymentAmountAllowed({
      settings,
      order,
      amountNgn: amt,
    });
  }
  const amountStr = toCurrencyString(amt);

  // Settlement currency + the amount actually charged at the gateway.
  // When the caller doesn't pass a currency, fall back to the currency the
  // ORDER was sold in (display_currency) — NOT a blanket "NGN".
  //
  // This was the FLH-SO-0059 bug: the admin "Send Pay Link" button sends only
  // amount_ngn (no currency), so a USD order — sold at the campaign's locked
  // ₦/$ rate — got an NGN-denominated Nomba checkout for the full Naira total.
  // The buyer then paid by international card and Nomba converted that Naira
  // figure at ITS OWN live rate (~₦1,401/$), charging $708.25 instead of the
  // quoted $764 (₦992,400 ÷ 1,300). Honouring the order's settlement currency
  // keeps the dollar figure at the rate the buyer agreed to, on every pay-link
  // path (admin button, public tokenised link), not just the campaign checkout.
  //
  // NGN: charge the Naira figure as-is. USD: convert the NGN outstanding with
  // the order's locked rate (settlementFxRate) and ceil to a whole dollar — the
  // exact figure the landing page showed the buyer (owner: 10.29 → $11). We
  // never hardcode a rate; whatever the order locked in is what we charge.
  //
  // `currency` is a STAFF override (admin Send Pay Link) — customer-facing
  // callers never pass one, so a buyer always pays in the order's own currency.
  const settleCurrency = String(
    currency || lockedCurrency(order),
  ).toUpperCase();
  assertSettlementCurrency(settleCurrency);
  let chargeAmount = amountStr;
  if (settleCurrency !== "NGN") {
    const rate = await settlementFxRate({
      brand,
      order,
      currency: settleCurrency,
    });
    if (!rate || rate <= 0)
      throw new AppError(
        "NO_FX_RATE",
        `No exchange rate is configured for ${settleCurrency} settlement on this order`,
        422,
      );
    chargeAmount = amt.dividedBy(money(rate)).ceil().toString();
    // Currency lock: an order with no rate of its own for this currency (a
    // Quick Sale, a staff switch from NGN) is pinned to the rate this checkout
    // charges at. The webhook then credits the capture at exactly this rate,
    // and every later link on the order reuses it instead of a live rate.
    if (!lockedRate(order, settleCurrency)) {
      await salesRepo.lockSettlementCurrency({
        brand,
        id: order.order_id,
        currency: settleCurrency,
        fx_rate: rate,
        display_total: toCurrencyString(
          money(order.total_ngn).dividedBy(money(rate)).ceil(),
        ),
      });
    }
  }

  const email = await contactEmail(order.contact_id);
  // Route the gateway chain by the resolved settlement currency — a USD order
  // must hit the foreign-currency (Nomba-only) rail, never the NGN chain.
  const chain = await gateways.getActiveChain({
    brand,
    currency: settleCurrency,
  });
  if (!chain.length)
    throw new AppError(
      "NO_GATEWAY",
      "No active payment gateway is configured for this currency",
      503,
    );

  if (preferred_provider) {
    chain.sort((a, b) => {
      if (a.provider === preferred_provider) return -1;
      if (b.provider === preferred_provider) return 1;
      return 0;
    });
  }

  const attempts = [];
  for (const link of chain) {
    try {
      const res = await initOnGateway({
        provider: link.provider,
        credentials: link.credentials,
        subject: {
          doc_number: order.order_number,
          metadata: { brand, order_id: order.order_id },
          callback_params: { order_id: order.order_id },
        },
        amount_ngn: amountStr,
        currency: settleCurrency,
        charge_amount: chargeAmount,
        email,
        return_url_base,
      });
      return { ...res, amount_ngn: amountStr, attempts };
    } catch (err) {
      attempts.push({
        provider: link.provider,
        error: describeGatewayError(err),
      });
      logger.warn(
        { provider: link.provider, order_id, err: describeGatewayError(err) },
        "payment gateway init failed — trying fallback",
      );
    }
  }
  throw new AppError(
    "ALL_GATEWAYS_FAILED",
    "All configured gateways failed to initialise payment",
    502,
    { metadata: { attempts } },
  );
}

// ── Quotation pay-link (000090 — pay the quote, order minted on payment) ──
//
// The quote never holds money. The checkout carries metadata.quotation_id and
// the webhook converts the quote → order at confirmation, then records the
// payment against that order through the ordinary rail. Unlike an order link
// this is always the FULL quote total: a quote has no payment history to net
// off, and the Flexi Pay minimums are policy on an order that doesn't exist
// yet. Deposits on quotes are deliberately out of scope here — a deposit-
// triggered quote should be accepted-and-converted first (the order-first
// fallback), then paid part-way on the order's own link.

const QUOTE_PAYABLE_STATUSES = new Set(["sent", "viewed", "accepted"]);

async function assertQuotationPayable(q) {
  if (q.status === "converted")
    throw new AppError(
      "ALREADY_CONVERTED",
      "This quotation has already become an order",
      409,
      {
        user_message:
          "This quote has already been converted to an order — pay on the order instead.",
      },
    );
  if (!QUOTE_PAYABLE_STATUSES.has(q.status))
    throw new AppError(
      "INVALID_STATE",
      `Cannot pay a '${q.status}' quote`,
      409,
    );
  // valid_until is a DATE — the quote stays payable through the whole of its
  // last day, so compare against end-of-day rather than the raw timestamp.
  if (q.valid_until) {
    const expiry = new Date(q.valid_until);
    expiry.setHours(23, 59, 59, 999);
    if (Date.now() > expiry.getTime())
      throw new AppError("QUOTE_EXPIRED", "This quotation has expired", 409, {
        user_message:
          "This quote has expired. Please ask us for an updated one.",
      });
  }
}

/**
 * Create a checkout link for a QUOTATION, walking the same gateway chain with
 * the same automatic fallback as the order link. Returns
 * { provider, reference, checkout_url, amount_ngn, attempts }.
 */
async function createQuotationPaymentLink({
  brand,
  quotation_id,
  currency,
  return_url_base,
  preferred_provider,
}) {
  const quote = await salesRepo.findQuotationById({ brand, id: quotation_id });
  if (!quote) throw new NotFoundError("Quotation");
  await assertQuotationPayable(quote);

  const amt = money(quote.total_ngn);
  if (amt.lte(0))
    throw new AppError("NOTHING_DUE", "Quotation has no amount due", 409);
  const amountStr = toCurrencyString(amt);

  // Settle in the currency the quote was priced in, at the rate locked ON the
  // quote — same precedence as an order (settlementFxRate reads fx_rate_used /
  // display_currency, both of which quotations carry). A quote has no campaign,
  // so campaignFxRate short-circuits to null and we fall through to the system
  // rate when nothing was locked.
  const settleCurrency = String(
    currency || lockedCurrency(quote),
  ).toUpperCase();
  assertSettlementCurrency(settleCurrency);
  let chargeAmount = amountStr;
  if (settleCurrency !== "NGN") {
    const rate = await settlementFxRate({
      brand,
      order: quote,
      currency: settleCurrency,
    });
    if (!rate || rate <= 0)
      throw new AppError(
        "NO_FX_RATE",
        `No exchange rate is configured for ${settleCurrency} settlement on this quotation`,
        422,
      );
    chargeAmount = amt.dividedBy(money(rate)).ceil().toString();
  }

  const email = await contactEmail(quote.contact_id);
  const chain = await gateways.getActiveChain({
    brand,
    currency: settleCurrency,
  });
  if (!chain.length)
    throw new AppError(
      "NO_GATEWAY",
      "No active payment gateway is configured for this currency",
      503,
    );
  if (preferred_provider) {
    chain.sort((a, b) => {
      if (a.provider === preferred_provider) return -1;
      if (b.provider === preferred_provider) return 1;
      return 0;
    });
  }

  const attempts = [];
  for (const link of chain) {
    try {
      const res = await initOnGateway({
        provider: link.provider,
        credentials: link.credentials,
        subject: {
          doc_number: quote.quotation_number,
          metadata: { brand, quotation_id: quote.quotation_id },
          callback_params: { quotation_id: quote.quotation_id },
        },
        amount_ngn: amountStr,
        currency: settleCurrency,
        charge_amount: chargeAmount,
        email,
        return_url_base,
      });
      return { ...res, amount_ngn: amountStr, attempts };
    } catch (err) {
      attempts.push({
        provider: link.provider,
        error: describeGatewayError(err),
      });
      logger.warn(
        {
          provider: link.provider,
          quotation_id,
          err: describeGatewayError(err),
        },
        "quotation payment gateway init failed — trying fallback",
      );
    }
  }
  throw new AppError(
    "ALL_GATEWAYS_FAILED",
    "All configured gateways failed to initialise payment",
    502,
    { metadata: { attempts } },
  );
}

/**
 * Mint (idempotently) the quote's public pay token and return the customer-
 * facing `/quote/:token` URL — what staff paste into WhatsApp or an email.
 */
async function quotationPayLink({ brand, quotation_id }) {
  const quote = await salesRepo.findQuotationById({ brand, id: quotation_id });
  if (!quote) throw new NotFoundError("Quotation");
  const token = await salesRepo.ensureQuotationPayToken({
    brand,
    id: quotation_id,
  });
  let url = "";
  try {
    url = await brandUrls.quotePayUrl(brand, token);
  } catch {
    url = "";
  }
  return {
    quotation_id,
    quotation_number: quote.quotation_number,
    status: quote.status,
    total_ngn: toCurrencyString(money(quote.total_ngn)),
    public_pay_token: token,
    pay_url: url,
  };
}

async function resolveQuotationByToken(token) {
  if (!token) return null;
  for (const brand of VALID) {
    const quote = await salesRepo.findQuotationByPayToken({ brand, token });
    if (quote) return { brand, quote };
  }
  return null;
}

/** Public, no-auth preview of a quotation for its pay page. */
async function previewQuotationByToken({ token }) {
  const found = await resolveQuotationByToken(token);
  if (!found) throw new NotFoundError("Quotation");
  const { brand, quote } = found;
  return {
    brand,
    quotation_number: quote.quotation_number,
    status: quote.status,
    // Already paid → the page redirects the customer to the order's own pay
    // page (balance, receipts) instead of offering to charge them twice.
    converted_sales_order_id: quote.converted_sales_order_id || null,
    display_currency: quote.display_currency || "NGN",
    display_fx_rate:
      quote.fx_rate_used !== null && quote.fx_rate_used !== undefined
        ? Number(quote.fx_rate_used)
        : null,
    total_ngn: toCurrencyString(money(quote.total_ngn)),
    valid_until: quote.valid_until || null,
    payment_terms: quote.payment_terms || null,
    // Server-computed so the page never has to reason about expiry or status.
    payable: await assertQuotationPayable(quote).then(
      () => true,
      () => false,
    ),
  };
}

/**
 * Public, no-auth: generate a checkout link for a tokenised quotation. Always
 * settles in the quote's own currency — a client-sent `currency` is ignored
 * (currency lock: only staff may switch).
 */
async function createPublicQuotationPaymentLink({ token }) {
  const found = await resolveQuotationByToken(token);
  if (!found) throw new NotFoundError("Quotation");
  // Return the buyer to THIS quote page after the gateway. Resolved server-side
  // from the brand's own public base — never a client-supplied URL — so it
  // can't become an open redirect.
  let returnUrlBase;
  try {
    returnUrlBase = await brandUrls.quotePayUrl(found.brand, token);
  } catch {
    returnUrlBase = undefined;
  }
  return createQuotationPaymentLink({
    brand: found.brand,
    quotation_id: found.quote.quotation_id,
    return_url_base: returnUrlBase,
  });
}

// ── Public (tokenised) pay-link (§6.2 — customer-facing "pay any amount") ──
// Resolves the order by its public_tracking_token across brands (no login).
async function resolveByToken(token) {
  if (!token) return null;
  for (const brand of VALID) {
    const order = await salesRepo.findByPublicToken({ brand, token });
    if (order) return { brand, order };
  }
  return null;
}

/**
 * Public, no-auth preview of what's owed on an order (for the pay page).
 * Enriched for Flexi Pay (D12/D15): the plan, its display name + terms, the
 * minimum acceptable next payment, and the payment history — everything the
 * /pay/{token} page renders. All figures are server-computed; the page never
 * does its own math.
 */
async function previewByToken({ token }) {
  const found = await resolveByToken(token);
  if (!found) throw new NotFoundError("Order");
  const { brand, order } = found;
  const outstanding = money(order.total_ngn).minus(
    money(order.amount_paid_ngn || 0),
  );
  const settings = await paymentSettings.getSettings(brand);
  const minNext = paymentSettings.minNextPaymentNgn(settings, order);
  const payments = await salesRepo.listPayments({
    brand,
    order_id: order.order_id,
  });
  return {
    brand,
    order_number: order.order_number,
    status: order.status,
    payment_plan: order.payment_plan || "full",
    plan_display_name: settings.plan_display_name,
    plan_terms: settings.plan_terms,
    display_currency: order.display_currency || "NGN",
    // The rate locked on the order at placement (NGN per unit of the display
    // currency). The pay page uses it to show USD/GBP figures at exactly the
    // rate the buyer agreed to — never a live rate. 1.0 (or NGN) means no
    // conversion. All amounts below stay NGN base; conversion is display-only.
    display_fx_rate:
      order.fx_rate_used !== null && order.fx_rate_used !== undefined
        ? Number(order.fx_rate_used)
        : null,
    total_ngn: toCurrencyString(money(order.total_ngn)),
    amount_paid_ngn: toCurrencyString(money(order.amount_paid_ngn || 0)),
    outstanding_ngn: toCurrencyString(
      outstanding.lt(0) ? money(0) : outstanding,
    ),
    min_next_payment_ngn: toCurrencyString(minNext),
    payments: payments
      .filter((p) => p.status === "captured")
      .map((p) => ({
        payment_number: p.payment_number,
        amount_ngn: toCurrencyString(money(p.amount_ngn)),
        method: p.method,
        paid_at: p.captured_at || p.recorded_at,
      })),
  };
}

/**
 * Public, no-auth: generate a checkout link for a tokenised order. Always
 * settles in the order's own currency — a client-sent `currency` is ignored.
 * Letting the public choose was the exploit: flip a Naira order to USD, pay a
 * $1 "any amount" checkout, and the webhook used to credit the whole balance.
 */
async function createPublicPaymentLink({ token, amount_ngn }) {
  const found = await resolveByToken(token);
  if (!found) throw new NotFoundError("Order");
  // Return the buyer to THIS pay page after the gateway so they see the updated
  // balance (the page re-fetches the preview on return). Resolved server-side
  // from the brand's own public base — never a client-supplied URL — so this
  // can't become an open redirect. The gateway appends ?ref & order_id.
  let returnUrlBase;
  try {
    returnUrlBase = await brandUrls.payLinkUrl(found.brand, token);
  } catch {
    returnUrlBase = undefined;
  }
  // No currency is passed: createPaymentLink settles in the order's own locked
  // currency. (Forcing "NGN" here would push a USD order's "pay any amount"
  // link back into Naira, the FLH-SO-0059 bug; passing the client's value
  // through would let anyone flip the order's currency.)
  return createPaymentLink({
    brand: found.brand,
    order_id: found.order.order_id,
    amount_ngn,
    return_url_base: returnUrlBase,
  });
}

module.exports = {
  createPaymentLink,
  settlementFxRate,
  lockedCurrency,
  previewByToken,
  createPublicPaymentLink,
  createQuotationPaymentLink,
  quotationPayLink,
  previewQuotationByToken,
  createPublicQuotationPaymentLink,
};
