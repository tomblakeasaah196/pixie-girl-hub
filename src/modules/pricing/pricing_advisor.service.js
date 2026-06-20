/**
 * Pricing advisor — business logic. The product-centric, ADVISORY heart of the
 * pricing module:
 *   • recommend() — given a variant + target margin/markup/price, ground a
 *     suggestion in the TRUE landed cost (Cost Vault, falling back to the
 *     operational cost), gross up for a channel's fee, add VAT only when the
 *     business charges it, clamp to floors, round, and report the real margin.
 *   • apply() — threshold governance: small changes apply instantly; larger
 *     ones (or anything below a floor) route to a CEO proposal via the existing
 *     scenario→proposal machinery.
 *   • config / USD setters.
 *
 * Catalogue owns the live prices; this only ever suggests, or writes the exact
 * number the user accepted.
 */

"use strict";

const advisorRepo = require("./pricing_advisor.repo");
const pricingRepo = require("./pricing.repo");
const pricing = require("./pricing.service");
const vault = require("../catalogue/cost_vault.service");
const events = require("./pricing.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { money, toCurrencyString, Decimal } = require("../../utils/money");
const { NotFoundError } = require("../../utils/errors");

const A = (
  brand,
  user,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
) =>
  audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

const num = (v) => (v === null || v === undefined ? null : Number(v));

function roundTo(price, step) {
  const s = money(step);
  if (s.lte(0)) return money(price);
  return money(price)
    .dividedBy(s)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .times(s);
}

function channelFee(config, channel) {
  const fees = Array.isArray(config && config.channel_fees)
    ? config.channel_fees
    : [];
  return fees.find((f) => f.channel === channel) || null;
}

/** Effective VAT fraction for a variant (product override → business default),
 *  and whether VAT applies at all (only when the product is taxable AND the
 *  business actually charges VAT — a no-VAT business stays no-VAT). */
function effectiveVat(tax, brief) {
  const r =
    brief.product_vat_rate !== null && brief.product_vat_rate !== undefined
      ? Number(brief.product_vat_rate)
      : Number(tax.vat_rate || 0);
  const applies = !!brief.taxable && r > 0;
  return { rate: applies ? r : 0, applies };
}

/** Resolve a variant's cost: explicit override → Cost Vault (if the caller may
 *  see it) → operational cost_price_ngn (ALSO vault-gated, since it is cost) →
 *  none. Cost never leaks to a user without vault access; they must supply a
 *  cost override to get a margin-grounded suggestion. */
async function resolveCost({
  brand,
  user,
  request_id,
  variant_id,
  brief,
  override,
}) {
  if (override !== undefined && override !== null) {
    return { cost: money(override), source: "override" };
  }
  if (await vault.canSeeCost({ user, brand })) {
    try {
      const c = await vault.getCost({ brand, user, request_id, variant_id });
      if (c && c.cost_ngn !== null && c.cost_ngn !== undefined) {
        return { cost: money(c.cost_ngn), source: "vault" };
      }
    } catch {
      /* fall through to operational */
    }
    if (brief.cost_price_ngn !== null && brief.cost_price_ngn !== undefined) {
      return { cost: money(brief.cost_price_ngn), source: "operational" };
    }
  }
  return { cost: money(0), source: "none" };
}

async function floorFloorPrice({ brand, variant_id, channel, cost }) {
  const floors = await pricingRepo.effectiveFloors({
    brand,
    variant_id,
    channel,
  });
  let minEx = null;
  for (const f of floors) {
    let cand = null;
    if (f.floor_type === "min_price_ngn") cand = money(f.floor_value);
    else if (f.floor_type === "min_margin_pct")
      cand = pricing.priceForTargetMargin(cost, f.floor_value);
    else if (f.floor_type === "min_markup_pct")
      cand = pricing.priceForTargetMarkup(cost, f.floor_value);
    if (cand && (minEx === null || cand.gt(minEx))) minEx = cand;
  }
  return minEx;
}

// ── recommend ────────────────────────────────────────────
async function recommend({ brand, user, request_id, input }) {
  const {
    variant_id,
    channel = "storefront",
    basis = "margin",
    target_value,
    cost_override_ngn,
    net_of_channel_fee = false,
  } = input;

  const brief = await advisorRepo.variantBrief({ brand, variant_id });
  if (!brief) throw new NotFoundError("Variant");
  const config = (await advisorRepo.getConfig({ brand })) || {};
  const tax = await advisorRepo.businessTax({ brand });

  const { cost, source: cost_source } = await resolveCost({
    brand,
    user,
    request_id,
    variant_id,
    brief,
    override: cost_override_ngn,
  });

  const vat = effectiveVat(tax, brief);
  const fee = net_of_channel_fee ? channelFee(config, channel) : null;
  const defaultMargin = config.default_target_margin_pct || 55;
  const tgt =
    target_value !== undefined && target_value !== null
      ? target_value
      : defaultMargin;

  // Ex-VAT selling price (before VAT, after any channel gross-up).
  let sellEx;
  const minEx = await floorFloorPrice({ brand, variant_id, channel, cost });

  if (basis === "price") {
    // target is the customer (VAT-inclusive) price → back VAT out to ex.
    sellEx = money(tgt).dividedBy(new Decimal(1).plus(money(vat.rate)));
  } else {
    // The ex-VAT, ex-fee figure we want to KEEP at the target margin/markup.
    const net =
      basis === "markup"
        ? pricing.priceForTargetMarkup(cost, tgt)
        : pricing.priceForTargetMargin(cost, tgt);
    // Gross up so the kept amount survives the channel's cut.
    sellEx = fee
      ? money(net)
          .plus(fee.fixed_ngn || 0)
          .dividedBy(new Decimal(1).minus(money(fee.pct || 0)))
      : money(net);
  }

  // Floor clamp (ex-VAT base).
  let floor_breached = false;
  if (minEx !== null && sellEx.lt(minEx)) {
    sellEx = minEx;
    floor_breached = true;
  }

  // VAT-inclusive customer price, then round to a clean figure.
  let sellInc = sellEx.times(new Decimal(1).plus(money(vat.rate)));
  const step = config.round_to_ngn !== undefined ? config.round_to_ngn : 0;
  let rounded = false;
  const r = roundTo(sellInc, step);
  if (!r.equals(sellInc)) rounded = true;
  sellInc = r;

  // Back out the amount actually KEPT (after VAT + channel fee) for the true
  // margin the owner cares about.
  const actualEx = vat.rate
    ? sellInc.dividedBy(new Decimal(1).plus(money(vat.rate)))
    : sellInc;
  const actualNet = fee
    ? actualEx
        .times(new Decimal(1).minus(money(fee.pct || 0)))
        .minus(fee.fixed_ngn || 0)
    : actualEx;

  const currentCol = pricingRepo.variantColumn(channel);
  const current = brief[currentCol];
  const delta =
    current !== null && current !== undefined && money(current).gt(0)
      ? Number(
          sellInc
            .minus(money(current))
            .dividedBy(money(current))
            .times(100)
            .toFixed(2),
        )
      : null;
  const threshold =
    config.instant_apply_threshold_pct !== undefined
      ? Number(config.instant_apply_threshold_pct)
      : 10;

  return {
    variant_id,
    channel,
    basis,
    product_name: brief.product_name,
    sku: brief.sku,
    variant_name: brief.variant_name,
    cost_ngn: toCurrencyString(cost),
    cost_source,
    current_price_ngn:
      current !== null && current !== undefined
        ? toCurrencyString(money(current))
        : null,
    suggested_price_ngn: toCurrencyString(sellInc),
    net_ngn: toCurrencyString(actualNet),
    margin_pct: Number(pricing.marginPct(actualNet, cost).toFixed(2)),
    markup_pct: Number(pricing.markupPct(actualNet, cost).toFixed(2)),
    floor_ngn: minEx !== null ? toCurrencyString(minEx) : null,
    floor_breached,
    channel_fee: fee
      ? { pct: Number(fee.pct || 0), fixed_ngn: Number(fee.fixed_ngn || 0) }
      : null,
    vat_rate: Number(money(vat.rate).times(100).toFixed(2)),
    vat_amount_ngn: toCurrencyString(sellInc.minus(actualEx)),
    rounded,
    price_usd:
      brief.price_usd !== null && brief.price_usd !== undefined
        ? toCurrencyString(money(brief.price_usd))
        : null,
    delta_pct: delta,
    within_threshold:
      delta !== null && Math.abs(delta) <= threshold && !floor_breached,
    threshold_pct: threshold,
  };
}

// ── apply (threshold governance) ─────────────────────────
async function apply({ brand, user, request_id, input }) {
  const { variant_id, channel = "storefront", new_price_ngn, reason } = input;
  const brief = await advisorRepo.variantBrief({ brand, variant_id });
  if (!brief) throw new NotFoundError("Variant");
  const config = (await advisorRepo.getConfig({ brand })) || {};

  const { cost, source: costSource } = await resolveCost({
    brand,
    user,
    request_id,
    variant_id,
    brief,
  });
  const knownCost = costSource !== "none";
  const np = money(new_price_ngn);
  const currentCol = pricingRepo.variantColumn(channel);
  const current = brief[currentCol];
  const delta =
    current !== null && current !== undefined && money(current).gt(0)
      ? Number(
          np
            .minus(money(current))
            .dividedBy(money(current))
            .times(100)
            .toFixed(4),
        )
      : null;

  const minEx = await floorFloorPrice({ brand, variant_id, channel, cost });
  const belowFloor = minEx !== null && np.lt(minEx);
  const threshold =
    config.instant_apply_threshold_pct !== undefined
      ? Number(config.instant_apply_threshold_pct)
      : 10;
  const instant = delta !== null && Math.abs(delta) <= threshold && !belowFloor;

  if (instant) {
    await transaction(async (client) => {
      await pricingRepo.applyVariantPrice({
        client,
        brand,
        variant_id,
        channel,
        new_price_ngn,
      });
      await pricingRepo.insertPriceHistory({
        client,
        brand,
        h: {
          variant_id,
          channel,
          old_price_ngn:
            current !== null && current !== undefined
              ? toCurrencyString(money(current))
              : null,
          new_price_ngn: toCurrencyString(np),
          delta_pct: delta,
          cost_at_change_ngn: knownCost ? toCurrencyString(cost) : null,
          margin_at_change_pct: knownCost
            ? Number(pricing.marginPct(np, cost).toFixed(4))
            : null,
          source: "manual",
          changed_by: user.user_id,
        },
      });
    });
    await A(
      brand,
      user,
      "pricing.advisor.apply",
      "product_variant",
      variant_id,
      { channel, new_price_ngn, delta },
      request_id,
    );
    events.emit("price.applied", { brand, variant_id, channel });
    return {
      applied: true,
      variant_id,
      channel,
      new_price_ngn: toCurrencyString(np),
      delta_pct: delta,
    };
  }

  // Over threshold (or below floor) → CEO proposal via the scenario machinery.
  const reasonCode = belowFloor ? "below_floor" : "over_threshold";
  const sc = await pricing.createScenario({
    brand,
    user,
    request_id,
    input: {
      scenario_name: `Advisor · ${brief.product_name} (${channel})`,
      description: reason || `Advisor price change (${reasonCode})`,
      scope_type: "specific_variants",
      variant_ids: [variant_id],
      goal_type: "target_price",
      goal_value: Number(new_price_ngn),
      channel,
      cost_basis: "latest",
    },
  });
  await pricing.computeScenario({
    brand,
    user,
    request_id,
    id: sc.scenario_id,
  });
  const proposal = await pricing.createProposalFromScenario({
    brand,
    user,
    request_id,
    input: {
      scenario_id: sc.scenario_id,
      title: `Advisor · ${brief.product_name} → ${toCurrencyString(np)} (${channel})`,
      description:
        reason ||
        `Requires approval (${reasonCode}; Δ ${delta === null ? "n/a" : delta + "%"}).`,
    },
  });
  await A(
    brand,
    user,
    "pricing.advisor.propose",
    "price_proposal",
    proposal.proposal_id,
    { reasonCode, delta, channel },
    request_id,
  );
  return {
    applied: false,
    reason: reasonCode,
    delta_pct: delta,
    proposal_id: proposal.proposal_id,
    proposal_number: proposal.proposal_number,
  };
}

// ── config + USD ─────────────────────────────────────────
async function getConfig({ brand }) {
  let cfg = await advisorRepo.getConfig({ brand });
  if (!cfg)
    cfg = await advisorRepo.upsertConfig({ brand, patch: {}, user_id: null });
  return cfg;
}

async function updateConfig({ brand, user, request_id, patch }) {
  const cfg = await advisorRepo.upsertConfig({
    brand,
    patch,
    user_id: user.user_id,
  });
  await A(
    brand,
    user,
    "pricing.config.update",
    "pricing_config",
    brand,
    { keys: Object.keys(patch) },
    request_id,
  );
  events.emit("pricing.config.updated", { brand });
  return cfg;
}

async function setUsd({ brand, user, request_id, variant_id, price_usd }) {
  const row = await advisorRepo.setUsdPrice({
    brand,
    variant_id,
    price_usd: num(price_usd),
  });
  if (!row) throw new NotFoundError("Variant");
  await A(
    brand,
    user,
    "pricing.advisor.set_usd",
    "product_variant",
    variant_id,
    { price_usd: num(price_usd) },
    request_id,
  );
  return row;
}

module.exports = {
  recommend,
  apply,
  getConfig,
  updateConfig,
  setUsd,
  roundTo,
  effectiveVat,
};
