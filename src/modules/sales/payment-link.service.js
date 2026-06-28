/**
 * Payment initiation + automatic gateway fallback (C / PD §6.2, §6.21).
 *
 * The "pay now / pay any amount" link per order. Walks the active gateway chain
 * for the currency (payment-gateways.getActiveChain — NGN: primary then
 * fallback; non-NGN: Stripe) and initialises a checkout on the first that
 * succeeds. If the primary errors at this moment, it silently falls over to the
 * secondary so the customer never sees a failure (§6.21 redundancy).
 *
 * Every checkout carries metadata { brand, order_id, amount_ngn } so the
 * inbound webhook confirm resolves + records the payment (with per-gateway fee
 * capture, A). Nothing is recorded here — payment lands only on confirmation.
 */

"use strict";

const salesRepo = require("./sales.repo");
const campaignsRepo = require("../sales_campaigns/campaigns.repo");
const gateways = require("../business_setup/payment-gateways.service");
const paystack = require("../../services/paystack.service");
const opay = require("../../services/opay.service");
const nomba = require("../../services/nomba.service");
const stripe = require("../../services/stripe.service");
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

const toKobo = (amountStr) => Number(money(amountStr).times(100).toFixed(0));

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

// Storefront orders aren't tied to a campaign, so they have no ngn_per_usd_rate.
// They settle foreign currency at the brand's catalogue rate — the SAME rate the
// website displayed and recorded on the order (sales_orders.fx_rate_used). This
// is the storefront analogue of campaignFxRate.
async function catalogueFxRate({ brand }) {
  try {
    const { rows } = await query(
      `SELECT usd_fx_rate FROM ${brand}.catalogue_config WHERE singleton = true`,
    );
    const rate = rows[0] && rows[0].usd_fx_rate;
    return rate ? Number(rate) : null;
  } catch {
    return null;
  }
}

// Resolve the NGN→foreign settlement rate: a campaign order uses the campaign's
// static rate; a storefront (non-campaign) order uses the brand catalogue rate.
async function settlementFxRate({ brand, order }) {
  const campaignRate = await campaignFxRate({ brand, order });
  if (campaignRate && campaignRate > 0) return campaignRate;
  return catalogueFxRate({ brand });
}

async function initOnGateway({
  provider,
  credentials,
  brand,
  order,
  amount_ngn,
  currency,
  charge_amount,
  email,
  return_url_base,
}) {
  const reference = makeReference(provider, order.order_number);
  const metadata = { brand, order_id: order.order_id, amount_ngn };
  const callback_url = return_url_base
    ? `${return_url_base.replace(/\/$/, "")}?ref=${encodeURIComponent(reference)}&order_id=${encodeURIComponent(order.order_id)}`
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
  currency = "NGN",
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
  const amountStr = toCurrencyString(amt);

  // Settlement currency + the amount actually charged at the gateway.
  // NGN: charge the Naira figure as-is. USD: convert the NGN outstanding with
  // the CAMPAIGN's static rate (ngn_per_usd_rate) and ceil to a whole dollar —
  // the exact figure the landing page showed the buyer (owner: 10.29 → $11).
  // We never hardcode a rate; whatever the campaign carries is what we charge.
  const settleCurrency = String(currency || "NGN").toUpperCase();
  let chargeAmount = amountStr;
  if (settleCurrency !== "NGN") {
    // Campaign order → campaign rate; storefront order → catalogue rate.
    const rate = await settlementFxRate({ brand, order });
    if (!rate || rate <= 0)
      throw new AppError(
        "NO_FX_RATE",
        `No exchange rate is configured for ${settleCurrency} settlement on this order`,
        422,
      );
    chargeAmount = amt.dividedBy(money(rate)).ceil().toString();
  }

  const email = await contactEmail(order.contact_id);
  const chain = await gateways.getActiveChain({ brand, currency });
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
        brand,
        order,
        amount_ngn: amountStr,
        currency: settleCurrency,
        charge_amount: chargeAmount,
        email,
        return_url_base,
      });
      return { ...res, amount_ngn: amountStr, attempts };
    } catch (err) {
      attempts.push({ provider: link.provider, error: err.message });
      logger.warn(
        { provider: link.provider, order_id, err: err.message },
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

/** Public, no-auth preview of what's owed on an order (for the pay page). */
async function previewByToken({ token }) {
  const found = await resolveByToken(token);
  if (!found) throw new NotFoundError("Order");
  const { brand, order } = found;
  const outstanding = money(order.total_ngn).minus(
    money(order.amount_paid_ngn || 0),
  );
  return {
    brand,
    order_number: order.order_number,
    status: order.status,
    total_ngn: toCurrencyString(money(order.total_ngn)),
    outstanding_ngn: toCurrencyString(
      outstanding.lt(0) ? money(0) : outstanding,
    ),
  };
}

/** Public, no-auth: generate a checkout link for a tokenised order. */
async function createPublicPaymentLink({
  token,
  amount_ngn,
  currency = "NGN",
}) {
  const found = await resolveByToken(token);
  if (!found) throw new NotFoundError("Order");
  return createPaymentLink({
    brand: found.brand,
    order_id: found.order.order_id,
    amount_ngn,
    currency,
  });
}

module.exports = {
  createPaymentLink,
  previewByToken,
  createPublicPaymentLink,
};
