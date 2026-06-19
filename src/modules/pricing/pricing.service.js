/**
 * Pricing Engine (V2.2 §6.25) — business logic.
 *
 * Declarative rules + floors + channel overrides, goal-seek/sensitivity
 * scenarios, and CEO-approved price proposals. The system connection:
 *  - getEffectivePrice() is the resolver storefront/POS/sales can call
 *    (override → list price → floor clamp → optional charm rounding).
 *  - approveProposal() APPLIES the scenario's prices: it writes back to
 *    product_variants.price_*_ngn and appends price_history, so the sales
 *    spine immediately prices new orders at the approved number.
 */

"use strict";

const repo = require("./pricing.repo");
const events = require("./pricing.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const {
  money,
  toCurrencyString,
  charmRound,
  Decimal,
} = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

const A = (
  brand,
  user,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
  before,
) =>
  audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    before,
    after,
    request_id,
  });

// ── Margin math (all Decimal) ─────────────────────────────
function marginPct(price, cost) {
  const p = money(price);
  if (p.lte(0)) return money(0);
  return p.minus(money(cost)).dividedBy(p).times(100);
}
function markupPct(price, cost) {
  const c = money(cost);
  if (c.lte(0)) return money(0);
  return money(price).minus(c).dividedBy(c).times(100);
}
function priceForTargetMargin(cost, targetMarginPct) {
  const m = money(targetMarginPct).dividedBy(100);
  if (m.gte(1))
    throw new AppError("INVALID_MARGIN", "Target margin must be < 100%", 422);
  return money(cost).dividedBy(new Decimal(1).minus(m));
}
function priceForTargetMarkup(cost, targetMarkupPct) {
  return money(cost).times(
    new Decimal(1).plus(money(targetMarkupPct).dividedBy(100)),
  );
}

// Sensitivity-driver sliders (FX rate, freight, raw cost…) flex the cost basis
// so a scenario's goal-seek + margins actually move with them — not just
// stored for show. Each driver's % move is summed onto the cost.
const COST_DRIVER_KEYS = new Set([
  "fx_rate",
  "freight",
  "cost",
  "raw_cost",
  "duty",
  "landing",
]);
function sliderCostDelta(sliders) {
  let d = 0;
  for (const s of sliders || []) {
    if (!COST_DRIVER_KEYS.has(s.slider_key)) continue;
    const base = Number(s.baseline_value);
    const scn = Number(s.scenario_value);
    if (base) d += (scn - base) / base;
  }
  return d;
}

// ════════════════════════════════════════════════════════════
// Rules
// ════════════════════════════════════════════════════════════
function listRules(args) {
  return repo.listRules(args);
}
async function createRule({ brand, user, request_id, input }) {
  const rule = await repo.createRule({
    brand,
    rule: input,
    user_id: user.user_id,
  });
  await A(
    brand,
    user,
    "pricing.rule.create",
    "pricing_rule",
    rule.rule_id,
    { rule_type: rule.rule_type },
    request_id,
  );
  events.emit("rule.created", { brand, rule_id: rule.rule_id });
  return rule;
}
async function updateRule({ brand, user, request_id, id, patch }) {
  const before = await repo.findRule({ brand, id });
  if (!before) throw new NotFoundError("Pricing rule");
  const updated = await repo.updateRule({ brand, id, patch });
  await A(
    brand,
    user,
    "pricing.rule.update",
    "pricing_rule",
    id,
    updated,
    request_id,
    before,
  );
  return updated;
}
async function deactivateRule({ brand, user, request_id, id }) {
  const before = await repo.findRule({ brand, id });
  if (!before) throw new NotFoundError("Pricing rule");
  const updated = await repo.updateRule({
    brand,
    id,
    patch: { is_active: false },
  });
  await A(
    brand,
    user,
    "pricing.rule.deactivate",
    "pricing_rule",
    id,
    null,
    request_id,
    before,
  );
  return updated;
}

// ════════════════════════════════════════════════════════════
// Floors
// ════════════════════════════════════════════════════════════
function listFloors(args) {
  return repo.listFloors(args);
}
async function setFloor({ brand, user, request_id, input }) {
  const floor = await repo.setFloor({
    brand,
    floor: input,
    user_id: user.user_id,
  });
  await A(
    brand,
    user,
    "pricing.floor.set",
    "pricing_floor",
    floor.floor_id,
    { floor_type: floor.floor_type },
    request_id,
  );
  return floor;
}
async function removeFloor({ brand, user, request_id, id }) {
  const ok = await repo.deactivateFloor({ brand, id });
  if (!ok) throw new NotFoundError("Pricing floor");
  await A(
    brand,
    user,
    "pricing.floor.remove",
    "pricing_floor",
    id,
    null,
    request_id,
  );
}

// ════════════════════════════════════════════════════════════
// Channel overrides
// ════════════════════════════════════════════════════════════
function listOverrides(args) {
  return repo.listOverrides(args);
}
async function setOverride({ brand, user, request_id, input }) {
  const ov = await repo.setOverride({
    brand,
    override: input,
    user_id: user.user_id,
  });
  await A(
    brand,
    user,
    "pricing.override.set",
    "channel_price_override",
    ov.override_id,
    { channel: ov.channel },
    request_id,
  );
  events.emit("override.set", {
    brand,
    override_id: ov.override_id,
    variant_id: ov.variant_id,
  });
  return ov;
}
async function removeOverride({ brand, user, request_id, id }) {
  const ok = await repo.deactivateOverride({ brand, id });
  if (!ok) throw new NotFoundError("Channel price override");
  await A(
    brand,
    user,
    "pricing.override.remove",
    "channel_price_override",
    id,
    null,
    request_id,
  );
}

// ════════════════════════════════════════════════════════════
// Effective price resolver (the storefront/POS/sales connection)
// ════════════════════════════════════════════════════════════
/**
 * Resolve the price a customer should pay for a variant on a channel:
 *   1. active manual channel override, else
 *   2. the variant's list price column for that channel, then
 *   3. clamp UP to any active min-price floor (variant.min_price_ngn +
 *      pricing_floors min_price_ngn), then
 *   4. apply charm rounding if a charm layer is active for the channel.
 */
async function getEffectivePrice({
  brand,
  variant_id,
  channel = "storefront",
  currency = "NGN",
}) {
  const v = await repo.variantPricing({ brand, variant_id });
  if (!v) throw new NotFoundError("Variant");

  let source = "list";
  let price;
  const override = await repo.activeOverride({ brand, variant_id, channel });
  if (override) {
    price = money(override.override_price_ngn);
    source = "override";
  } else {
    const col = repo.variantColumn(channel);
    const listPrice =
      v[col] !== null && v[col] !== undefined ? v[col] : v.price_storefront_ngn;
    price = money(listPrice || 0);
  }

  // Floor clamp.
  let floorApplied = false;
  const floors = await repo.effectiveFloors({ brand, variant_id, channel });
  const cost = money(v.cost_price_ngn || 0);
  let minPrice =
    v.min_price_ngn !== null && v.min_price_ngn !== undefined
      ? money(v.min_price_ngn)
      : null;
  for (const f of floors) {
    let candidate = null;
    if (f.floor_type === "min_price_ngn") candidate = money(f.floor_value);
    else if (f.floor_type === "min_margin_pct")
      candidate = priceForTargetMargin(cost, f.floor_value);
    else if (f.floor_type === "min_markup_pct")
      candidate = priceForTargetMarkup(cost, f.floor_value);
    if (candidate && (minPrice === null || candidate.gt(minPrice)))
      minPrice = candidate;
  }
  if (minPrice !== null && price.lt(minPrice)) {
    price = minPrice;
    floorApplied = true;
  }

  // Charm rounding (only if a charm layer is configured for the channel).
  let charmed = false;
  const layers = await repo.passThroughLayers({ brand, channel });
  if (layers.some((l) => l.layer_type === "charm_rounding")) {
    price = charmRound(price, currency);
    charmed = true;
  }

  return {
    variant_id,
    channel,
    currency,
    price_ngn: toCurrencyString(price),
    margin_pct: Number(marginPct(price, cost).toFixed(2)),
    source,
    floor_applied: floorApplied,
    charm_rounded: charmed,
  };
}

// ════════════════════════════════════════════════════════════
// Scenarios (goal-seek + sensitivity)
// ════════════════════════════════════════════════════════════
function listScenarios(args) {
  return repo.listScenarios(args);
}
async function getScenario({ brand, id }) {
  const sc = await repo.findScenario({ brand, id });
  if (!sc) throw new NotFoundError("Scenario");
  const [results, sliders] = await Promise.all([
    repo.scenarioResults({ brand, scenario_id: id }),
    repo.scenarioSliders({ brand, scenario_id: id }),
  ]);
  return { ...sc, results, sliders };
}
async function createScenario({ brand, user, request_id, input }) {
  const sc = await repo.createScenario({
    brand,
    sc: input,
    user_id: user.user_id,
  });
  await A(
    brand,
    user,
    "pricing.scenario.create",
    "pricing_scenario",
    sc.scenario_id,
    { goal_type: sc.goal_type },
    request_id,
  );
  return sc;
}

function costForBasis(variant, scenario) {
  if (scenario.cost_basis === "custom" && scenario.custom_cost_ngn !== null)
    return money(scenario.custom_cost_ngn);
  return money(variant.cost_price_ngn || 0);
}

function proposedPrice(cost, scenario, currentPrice) {
  switch (scenario.goal_type) {
    case "target_margin":
      return priceForTargetMargin(cost, scenario.goal_value);
    case "target_price":
      return money(scenario.goal_value);
    case "target_revenue":
      // price = target monthly revenue / assumed monthly units
      if (scenario.assumed_monthly_units && scenario.assumed_monthly_units > 0)
        return money(scenario.goal_value).dividedBy(
          scenario.assumed_monthly_units,
        );
      return money(currentPrice || 0);
    case "sensitivity_only":
    default:
      return money(currentPrice || 0);
  }
}

/**
 * Compute the scenario: goal-seek a proposed price per variant, run the
 * cost ±10% / FX ±10% sensitivity grid, flag floor breaches, and store
 * aggregates. Optional `sliders` are persisted for the sensitivity UI.
 */
async function computeScenario({ brand, user, request_id, id, sliders }) {
  return transaction(async (client) => {
    const scenario = await repo.findScenario({ client, brand, id });
    if (!scenario) throw new NotFoundError("Scenario");

    const variants = await repo.variantsInScope({
      brand,
      scope_type: scenario.scope_type,
      category_ids: scenario.category_ids,
      variant_ids: scenario.variant_ids,
    });

    await repo.clearScenarioResults({ client, brand, scenario_id: id });
    if (sliders && sliders.length)
      await repo.replaceSliders({ client, brand, scenario_id: id, sliders });

    // Flex the cost basis by the sensitivity drivers (persisted or just-sent).
    const effSliders =
      sliders && sliders.length
        ? sliders
        : await repo.scenarioSliders({ brand, scenario_id: id });
    const costMult = new Decimal(1).plus(sliderCostDelta(effSliders));

    let sumPrice = money(0);
    let sumMargin = money(0);
    let sumRevenue = money(0);
    let analysed = 0;

    for (const v of variants) {
      const cost = costForBasis(v, scenario).times(costMult);
      const current = v.price_storefront_ngn;
      const proposed = proposedPrice(cost, scenario, current);
      const pm = marginPct(proposed, cost);

      // Sensitivity: cost moves ±10% (FX is the same driver on imported cost).
      const costUp = cost.times("1.10");
      const costDown = cost.times("0.90");

      // Floor breach: variant min_price + active floors.
      let floorBreached = false;
      let floorNotes = null;
      const floors = await repo.effectiveFloors({
        client,
        brand,
        variant_id: v.variant_id,
        channel: scenario.channel,
      });
      let minPrice =
        v.min_price_ngn !== null && v.min_price_ngn !== undefined
          ? money(v.min_price_ngn)
          : null;
      for (const f of floors) {
        let cand = null;
        if (f.floor_type === "min_price_ngn") cand = money(f.floor_value);
        else if (f.floor_type === "min_margin_pct")
          cand = priceForTargetMargin(cost, f.floor_value);
        else if (f.floor_type === "min_markup_pct")
          cand = priceForTargetMarkup(cost, f.floor_value);
        if (cand && (minPrice === null || cand.gt(minPrice))) minPrice = cand;
      }
      if (minPrice !== null && proposed.lt(minPrice)) {
        floorBreached = true;
        floorNotes = `Proposed ${toCurrencyString(proposed)} is below floor ${toCurrencyString(minPrice)}`;
      }

      const units = scenario.assumed_monthly_units || null;
      const revenue = units ? proposed.times(units) : null;

      await repo.insertScenarioResult({
        client,
        brand,
        r: {
          scenario_id: id,
          variant_id: v.variant_id,
          cost_ngn: toCurrencyString(cost),
          current_price_ngn:
            current === null || current === undefined
              ? null
              : toCurrencyString(money(current)),
          current_margin_pct: current
            ? Number(marginPct(current, cost).toFixed(4))
            : null,
          proposed_price_ngn: toCurrencyString(proposed),
          proposed_margin_pct: Number(pm.toFixed(4)),
          proposed_markup_pct: Number(markupPct(proposed, cost).toFixed(4)),
          margin_at_cost_minus_10: Number(
            marginPct(proposed, costDown).toFixed(4),
          ),
          margin_at_cost_plus_10: Number(
            marginPct(proposed, costUp).toFixed(4),
          ),
          margin_at_fx_minus_10: Number(
            marginPct(proposed, costDown).toFixed(4),
          ),
          margin_at_fx_plus_10: Number(marginPct(proposed, costUp).toFixed(4)),
          floor_breached: floorBreached,
          floor_breach_notes: floorNotes,
          projected_monthly_units: units,
          projected_monthly_revenue_ngn: revenue
            ? toCurrencyString(revenue)
            : null,
        },
      });

      sumPrice = sumPrice.plus(proposed);
      sumMargin = sumMargin.plus(pm);
      if (revenue) sumRevenue = sumRevenue.plus(revenue);
      analysed += 1;
    }

    const agg = {
      units_analysed: analysed,
      avg_new_price_ngn: analysed
        ? toCurrencyString(sumPrice.dividedBy(analysed))
        : "0.00",
      avg_margin_pct: analysed
        ? Number(sumMargin.dividedBy(analysed).toFixed(4))
        : 0,
      projected_revenue_ngn: toCurrencyString(sumRevenue),
    };
    const updated = await repo.updateScenarioComputed({
      client,
      brand,
      scenario_id: id,
      agg,
    });
    await A(
      brand,
      user,
      "pricing.scenario.compute",
      "pricing_scenario",
      id,
      agg,
      request_id,
    );
    events.emit("scenario.computed", {
      brand,
      scenario_id: id,
      variants: analysed,
    });
    return { ...updated, results_count: analysed };
  });
}

// ════════════════════════════════════════════════════════════
// Proposals (CEO approval → apply to variants)
// ════════════════════════════════════════════════════════════
function listProposals(args) {
  return repo.listProposals(args);
}
async function getProposal({ brand, id }) {
  const p = await repo.findProposal({ brand, id });
  if (!p) throw new NotFoundError("Price proposal");
  const results = p.scenario_id
    ? await repo.scenarioResults({ brand, scenario_id: p.scenario_id })
    : [];
  return { ...p, results };
}

async function createProposalFromScenario({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const scenario = await repo.findScenario({
      client,
      brand,
      id: input.scenario_id,
    });
    if (!scenario) throw new NotFoundError("Scenario");
    if (scenario.status !== "computed" && scenario.status !== "proposed")
      throw new AppError(
        "NOT_COMPUTED",
        "Scenario must be computed before proposing",
        422,
      );
    const results = await repo.scenarioResults({
      brand,
      scenario_id: scenario.scenario_id,
    });
    const number = await repo.nextProposalNumber({ client, brand });
    const proposal = await repo.createProposal({
      client,
      brand,
      p: {
        proposal_number: number,
        scenario_id: scenario.scenario_id,
        title: input.title,
        description: input.description,
        effective_from: input.effective_from,
        effective_to: input.effective_to,
        variants_count: results.length,
        submitted_by: user.user_id,
      },
    });
    await repo.setScenarioStatus({
      client,
      brand,
      scenario_id: scenario.scenario_id,
      status: "proposed",
      proposal_id: proposal.proposal_id,
    });
    await A(
      brand,
      user,
      "pricing.proposal.submit",
      "price_proposal",
      proposal.proposal_id,
      { number },
      request_id,
    );
    events.emit("proposal.submitted", {
      brand,
      proposal_id: proposal.proposal_id,
    });
    return proposal;
  });
}

/** Approve + APPLY: write each result's price to the variant + history. */
async function approveProposal({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const proposal = await repo.findProposal({ client, brand, id });
    if (!proposal) throw new NotFoundError("Price proposal");
    if (proposal.status !== "pending_approval")
      throw new AppError(
        "BAD_STATE",
        `Proposal is ${proposal.status}, not pending_approval`,
        422,
      );
    const scenario = await repo.findScenario({
      client,
      brand,
      id: proposal.scenario_id,
    });
    if (!scenario)
      throw new AppError(
        "NO_SCENARIO",
        "Proposal has no scenario to apply",
        422,
      );
    const results = await repo.scenarioResults({
      brand,
      scenario_id: scenario.scenario_id,
    });
    const channel = scenario.channel;

    let applied = 0;
    for (const r of results) {
      await repo.applyVariantPrice({
        client,
        brand,
        variant_id: r.variant_id,
        channel,
        new_price_ngn: r.proposed_price_ngn,
      });
      const oldP = r.current_price_ngn;
      const newP = money(r.proposed_price_ngn);
      const delta =
        oldP && money(oldP).gt(0)
          ? Number(
              newP
                .minus(money(oldP))
                .dividedBy(money(oldP))
                .times(100)
                .toFixed(4),
            )
          : null;
      await repo.insertPriceHistory({
        client,
        brand,
        h: {
          variant_id: r.variant_id,
          channel,
          old_price_ngn: oldP,
          new_price_ngn: r.proposed_price_ngn,
          delta_pct: delta,
          cost_at_change_ngn: r.cost_ngn,
          margin_at_change_pct: r.proposed_margin_pct,
          source: "price_proposal",
          proposal_id: id,
          effective_from: proposal.effective_from,
          changed_by: user.user_id,
        },
      });
      applied += 1;
    }

    const updated = await repo.setProposalStatus({
      client,
      brand,
      id,
      status: "applied",
      fields: {
        approved_by: user.user_id,
        approved_at: new Date().toISOString(),
        applied_at: new Date().toISOString(),
      },
    });
    await repo.setScenarioStatus({
      client,
      brand,
      scenario_id: scenario.scenario_id,
      status: "applied",
    });
    await A(
      brand,
      user,
      "pricing.proposal.apply",
      "price_proposal",
      id,
      { applied },
      request_id,
    );
    events.emit("proposal.applied", {
      brand,
      proposal_id: id,
      channel,
      variants: applied,
    });
    return { ...updated, applied };
  });
}

async function rejectProposal({ brand, user, request_id, id, reason }) {
  const proposal = await repo.findProposal({ brand, id });
  if (!proposal) throw new NotFoundError("Price proposal");
  if (proposal.status !== "pending_approval")
    throw new AppError("BAD_STATE", `Proposal is ${proposal.status}`, 422);
  const updated = await repo.setProposalStatus({
    brand,
    id,
    status: "rejected",
    fields: {
      rejected_at: new Date().toISOString(),
      rejection_reason: reason || null,
    },
  });
  await A(
    brand,
    user,
    "pricing.proposal.reject",
    "price_proposal",
    id,
    { reason },
    request_id,
  );
  return updated;
}

/** Revert an applied proposal: restore the prior price for each variant. */
async function revertProposal({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const proposal = await repo.findProposal({ client, brand, id });
    if (!proposal) throw new NotFoundError("Price proposal");
    if (proposal.status !== "applied")
      throw new AppError(
        "BAD_STATE",
        `Only applied proposals can be reverted (is ${proposal.status})`,
        422,
      );
    const history = await repo.historyByProposal({
      client,
      brand,
      proposal_id: id,
    });
    let reverted = 0;
    for (const h of history) {
      if (h.old_price_ngn === null || h.old_price_ngn === undefined) continue;
      await repo.applyVariantPrice({
        client,
        brand,
        variant_id: h.variant_id,
        channel: h.channel,
        new_price_ngn: h.old_price_ngn,
      });
      await repo.insertPriceHistory({
        client,
        brand,
        h: {
          variant_id: h.variant_id,
          channel: h.channel,
          old_price_ngn: h.new_price_ngn,
          new_price_ngn: h.old_price_ngn,
          delta_pct: null,
          cost_at_change_ngn: h.cost_at_change_ngn,
          margin_at_change_pct: null,
          source: "price_proposal",
          proposal_id: id,
          changed_by: user.user_id,
          notes: `Revert: ${reason || "no reason given"}`,
        },
      });
      reverted += 1;
    }
    const updated = await repo.setProposalStatus({
      client,
      brand,
      id,
      status: "reverted",
      fields: {
        reverted_at: new Date().toISOString(),
        reversion_reason: reason || null,
      },
    });
    await A(
      brand,
      user,
      "pricing.proposal.revert",
      "price_proposal",
      id,
      { reverted },
      request_id,
    );
    events.emit("proposal.reverted", {
      brand,
      proposal_id: id,
      variants: reverted,
    });
    return { ...updated, reverted };
  });
}

// ════════════════════════════════════════════════════════════
// History
// ════════════════════════════════════════════════════════════
function priceHistory({ brand, variant_id, limit }) {
  return repo.priceHistory({ brand, variant_id, limit });
}

module.exports = {
  // math (reused by the advisor)
  marginPct,
  markupPct,
  priceForTargetMargin,
  priceForTargetMarkup,
  // rules
  listRules,
  createRule,
  updateRule,
  deactivateRule,
  // floors
  listFloors,
  setFloor,
  removeFloor,
  // overrides
  listOverrides,
  setOverride,
  removeOverride,
  // resolver
  getEffectivePrice,
  // scenarios
  listScenarios,
  getScenario,
  createScenario,
  computeScenario,
  // proposals
  listProposals,
  getProposal,
  createProposalFromScenario,
  approveProposal,
  rejectProposal,
  revertProposal,
  // history
  priceHistory,
};
