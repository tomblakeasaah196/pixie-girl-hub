/**
 * Campaign go-live readiness (checkout-failure prevention).
 *
 * Before a campaign is allowed to go LIVE we verify the preconditions that, if
 * missing, would turn buyer checkouts into 500s or dead-ends:
 *
 *   • document-number sequences (sales_order / sales_order_payment /
 *     stock_movement) exist for the brand — a missing one RAISEs inside the
 *     order transaction (auto-repaired here);
 *   • a default stock location exists (orders reserve/fulfil against it);
 *   • the settlement currencies exist in shared.currencies (NOT NULL FK on the
 *     order);
 *   • at least one active payment gateway resolves for each offered currency;
 *   • the discount config is coherent (a type without a value).
 *
 * IMPORTANT: this gate runs ONLY on the launch/resume transition. An already
 * LIVE campaign is never re-evaluated, so turning this on cannot take a running
 * sale offline. Repairable issues (sequences) are fixed in place; only the
 * non-repairable, genuinely-blocking issues stop a go-live.
 */

"use strict";

const { query } = require("../../config/database");
const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const stockRepo = require("../stock/stock.repo");
const gateways = require("../business_setup/payment-gateways.service");

const REQUIRED_SEQUENCES = [
  "sales_order",
  "sales_order_payment",
  "stock_movement",
];
const SEQ_SUFFIX = {
  sales_order: "SO",
  sales_order_payment: "PAY",
  stock_movement: "MOV",
};

async function ensureSequences(brand, ex) {
  const { rows } = await ex(
    `SELECT document_type, split_part(prefix,'-',1) AS root
       FROM shared.document_numbering
      WHERE business = $1`,
    [brand],
  );
  const have = new Set(rows.map((r) => r.document_type));
  const root =
    (rows.find((r) => r.root) || {}).root ||
    brand.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() ||
    "DOC";
  const repaired = [];
  for (const type of REQUIRED_SEQUENCES) {
    if (have.has(type)) continue;
    await ex(
      `INSERT INTO shared.document_numbering (business, document_type, prefix, padding, next_number)
       VALUES ($1, $2, $3, 4, 1)
       ON CONFLICT DO NOTHING`,
      [brand, type, `${root}-${SEQ_SUFFIX[type]}`],
    );
    repaired.push(type);
  }
  return repaired;
}

/**
 * Inspect (and optionally auto-repair) a campaign's checkout preconditions.
 * @returns {{ ready: boolean, issues: Array<{code,severity,message}>, repaired: string[] }}
 */
async function check({ brand, campaign, client = null, autofix = true }) {
  const ex = client ? client.query.bind(client) : query;
  const issues = [];
  let repaired = [];

  // 1. Document sequences (auto-repairable).
  try {
    if (autofix) {
      repaired = await ensureSequences(brand, ex);
    } else {
      const { rows } = await ex(
        `SELECT document_type FROM shared.document_numbering WHERE business = $1`,
        [brand],
      );
      const have = new Set(rows.map((r) => r.document_type));
      for (const type of REQUIRED_SEQUENCES) {
        if (!have.has(type))
          issues.push({
            code: "MISSING_DOC_SEQUENCE",
            severity: "block",
            message: `Document number sequence '${type}' is not configured for this brand.`,
          });
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, brand }, "readiness: sequence check failed");
    issues.push({
      code: "DOC_SEQUENCE_CHECK_FAILED",
      severity: "block",
      message: "Could not verify document number sequences.",
    });
  }

  // 2. Default stock location.
  try {
    const loc = await stockRepo.getDefaultLocation({ client, brand });
    if (!loc)
      issues.push({
        code: "NO_STOCK_LOCATION",
        severity: "block",
        message:
          "No default stock location exists — orders cannot reserve or fulfil stock.",
      });
  } catch (err) {
    logger.warn({ err: err.message, brand }, "readiness: stock location check failed");
    issues.push({
      code: "STOCK_LOCATION_CHECK_FAILED",
      severity: "block",
      message: "Could not verify the default stock location.",
    });
  }

  // 3. Settlement currencies present.
  const wantsUsd = !!campaign.allow_multi_currency_display;
  const ccy = wantsUsd ? ["NGN", "USD"] : ["NGN"];
  try {
    const { rows } = await ex(
      `SELECT currency_code FROM shared.currencies WHERE currency_code = ANY($1)`,
      [ccy],
    );
    const have = new Set(rows.map((r) => r.currency_code));
    for (const code of ccy) {
      if (!have.has(code))
        issues.push({
          code: "MISSING_CURRENCY",
          severity: "block",
          message: `Currency '${code}' is missing from the currency table.`,
        });
    }
  } catch (err) {
    logger.warn({ err: err.message, brand }, "readiness: currency check failed");
  }

  // 4. At least one active gateway per offered currency — intersected with the
  //    gateways this campaign still has enabled (the builder can turn rails off).
  const allowedGateways =
    Array.isArray(campaign.allowed_payment_gateways) &&
    campaign.allowed_payment_gateways.length
      ? campaign.allowed_payment_gateways
      : ["paystack", "nomba"];
  try {
    const ngnChain = await gateways.getActiveChain({ brand, currency: "NGN" });
    const ngnUsable = ngnChain.filter((g) =>
      allowedGateways.includes(g.provider),
    );
    if (!ngnUsable.length)
      issues.push({
        code: "NO_NGN_GATEWAY",
        severity: "block",
        message: ngnChain.length
          ? "Every NGN gateway is turned off for this campaign — buyers cannot pay. Enable a gateway in the brief."
          : "No active payment gateway is configured for NGN — buyers cannot pay.",
      });
    if (wantsUsd) {
      const usdChain = await gateways.getActiveChain({ brand, currency: "USD" });
      const usdUsable = usdChain.filter((g) =>
        allowedGateways.includes(g.provider),
      );
      if (!usdUsable.length)
        issues.push({
          code: "NO_USD_GATEWAY",
          severity: "block",
          message: usdChain.length
            ? "USD display is on but Nomba (the only USD rail) is turned off for this campaign — USD buyers cannot pay."
            : "USD display is on but no USD gateway (Nomba) is configured — USD buyers cannot pay.",
        });
    }
  } catch (err) {
    logger.warn({ err: err.message, brand }, "readiness: gateway check failed");
    issues.push({
      code: "GATEWAY_CHECK_FAILED",
      severity: "block",
      message: "Could not verify payment gateways.",
    });
  }

  // 5. Discount config coherence (non-blocking — the engine now tolerates it).
  if (
    campaign.discount_type &&
    (campaign.discount_value === null || campaign.discount_value === undefined)
  ) {
    issues.push({
      code: "DISCOUNT_VALUE_MISSING",
      severity: "warn",
      message: `Discount type '${campaign.discount_type}' has no value — no top-level discount will apply.`,
    });
  }

  const ready = !issues.some((i) => i.severity === "block");
  return { ready, issues, repaired };
}

/**
 * Gate a launch/resume: auto-repair what we safely can, then block only on the
 * remaining blocking issues. Throws CAMPAIGN_NOT_READY (409) with a field map.
 */
async function assertReadyForLaunch({ brand, campaign, client }) {
  const { ready, issues, repaired } = await check({
    brand,
    campaign,
    client,
    autofix: true,
  });
  if (repaired.length) {
    logger.info(
      { brand, campaign_id: campaign.campaign_id, repaired },
      "readiness: auto-provisioned document sequences before launch",
    );
  }
  if (ready) return { repaired, issues };
  const blocking = issues.filter((i) => i.severity === "block");
  throw new AppError(
    "CAMPAIGN_NOT_READY",
    "Campaign is not ready to go live",
    409,
    {
      user_message: `This campaign can't go live yet: ${blocking
        .map((i) => i.message)
        .join(" ")}`,
      fields: blocking.reduce((acc, i) => {
        acc[i.code] = [i.message];
        return acc;
      }, {}),
      metadata: { issues },
    },
  );
}

module.exports = { check, assertReadyForLaunch };
