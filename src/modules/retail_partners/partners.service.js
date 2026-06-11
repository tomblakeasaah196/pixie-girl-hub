/**
 * Retail Partners (V2.2 §6.29) — business logic.
 *
 * Consignment wholesale: ship to a partner, they sell to end customers, a
 * periodic settlement splits the proceeds (margin_share_pct). System
 * connections:
 *   - dispatch_to_partner / recall_to_warehouse also move OUR warehouse stock
 *     (stock.recordMovement → consignment_out / consignment_return).
 *   - partner is a shared.contact (Contacts 360); settlement carries an
 *     invoice_id hook for Invoicing.
 */

"use strict";

const crypto = require("crypto");
const repo = require("./partners.repo");
const events = require("./partners.events");
const stock = require("../stock/stock.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { logger } = require("../../config/logger");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

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

const code = (prefix) =>
  `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

// Goods added to the partner are positive; removed are negative.
const SIGN = {
  dispatch_to_partner: 1,
  partner_sale: -1,
  partner_return: -1,
  partner_damage: -1,
  recall_to_warehouse: -1,
  partner_count_adjustment: 1,
};

// ── Partners ───────────────────────────────────────────────
function listPartners(args) {
  return repo.listPartners(args);
}
async function getPartner({ brand, id }) {
  const p = await repo.findPartner({ brand, id });
  if (!p) throw new NotFoundError("Retail partner");
  const [locations, stockRows] = await Promise.all([
    repo.listLocations({ brand, partner_id: id }),
    repo.listStock({ brand, partner_id: id }),
  ]);
  return { ...p, locations, stock: stockRows };
}
async function createPartner({ brand, user, request_id, input }) {
  const p = await repo.createPartner({
    brand,
    p: {
      ...input,
      partner_code: code("RTL"),
      created_by: user.user_id,
      onboarded_at: input.onboarded_at || new Date().toISOString().slice(0, 10),
    },
  });
  await A(
    brand,
    user,
    "retail_partner.create",
    "retail_partner",
    p.partner_id,
    { partner_code: p.partner_code },
    request_id,
  );
  events.emit("partner.created", { brand, partner_id: p.partner_id });
  return p;
}
async function updatePartner({ brand, user, request_id, id, patch }) {
  const before = await repo.findPartner({ brand, id });
  if (!before) throw new NotFoundError("Retail partner");
  const p = await repo.updatePartner({ brand, id, patch });
  await A(
    brand,
    user,
    "retail_partner.update",
    "retail_partner",
    id,
    p,
    request_id,
  );
  return p;
}
async function setStatus({ brand, user, request_id, id, status, reason }) {
  const before = await repo.findPartner({ brand, id });
  if (!before) throw new NotFoundError("Retail partner");
  const fields = {};
  if (status === "suspended") {
    fields.suspended_at = new Date().toISOString();
    fields.suspended_reason = reason || null;
  }
  const p = await repo.setPartnerStatus({ brand, id, status, fields });
  await A(
    brand,
    user,
    "retail_partner.status",
    "retail_partner",
    id,
    { status },
    request_id,
  );
  return p;
}

// ── Locations ──────────────────────────────────────────────
function listLocations({ brand, partner_id }) {
  return repo.listLocations({ brand, partner_id });
}
async function createLocation({ brand, user, request_id, partner_id, input }) {
  const partner = await repo.findPartner({ brand, id: partner_id });
  if (!partner) throw new NotFoundError("Retail partner");
  const loc = await repo.createLocation({
    brand,
    loc: { ...input, partner_id },
  });
  await A(
    brand,
    user,
    "retail_partner.location.create",
    "consignment_location",
    loc.consignment_location_id,
    null,
    request_id,
  );
  return loc;
}

// ── Consignment stock + movements ──────────────────────────
function listStock(args) {
  return repo.listStock(args);
}
function listMovements(args) {
  return repo.listMovements(args);
}

/**
 * Record a consignment movement and keep consignment_stock in step. For
 * dispatch/recall, also post the matching warehouse stock movement so our
 * books reflect the goods leaving / returning (best-effort).
 */
async function recordMovement({ brand, user, request_id, input }) {
  const sign = SIGN[input.movement_type];
  if (sign === undefined)
    throw new AppError(
      "BAD_TYPE",
      `Unknown movement_type ${input.movement_type}`,
      422,
    );
  const units = Number(input.units);
  if (!Number.isInteger(units) || units <= 0)
    throw new AppError("BAD_UNITS", "units must be a positive integer", 422);

  return transaction(async (client) => {
    const loc = await repo.findLocation({
      client,
      brand,
      id: input.consignment_location_id,
    });
    if (!loc) throw new NotFoundError("Consignment location");
    const partner = await repo.findPartner({
      client,
      brand,
      id: loc.partner_id,
    });
    if (!partner) throw new NotFoundError("Retail partner");

    // Shares for a sale.
    let unit_retail =
      input.unit_retail_price_ngn !== undefined &&
      input.unit_retail_price_ngn !== null
        ? money(input.unit_retail_price_ngn)
        : null;
    let partnerShare = null;
    let brandShare = null;
    if (input.movement_type === "partner_sale") {
      const cur = await repo.getStockRow({
        client,
        brand,
        consignment_location_id: input.consignment_location_id,
        variant_id: input.variant_id,
      });
      if (!unit_retail && cur && cur.agreed_retail_price_ngn !== null)
        unit_retail = money(cur.agreed_retail_price_ngn);
      const gross = (unit_retail || money(0)).times(units);
      partnerShare = gross.times(
        money(partner.margin_share_pct || 0).dividedBy(100),
      );
      brandShare = gross.minus(partnerShare);
    }

    // Optional warehouse stock movement for dispatch / recall.
    let stock_movement_id = null;
    if (
      (input.movement_type === "dispatch_to_partner" ||
        input.movement_type === "recall_to_warehouse") &&
      input.warehouse_location_id
    ) {
      try {
        const sm = await stock.recordMovement({
          brand,
          user,
          request_id,
          input: {
            variant_id: input.variant_id,
            location_id: input.warehouse_location_id,
            quantity:
              input.movement_type === "dispatch_to_partner" ? -units : units,
            movement_type:
              input.movement_type === "dispatch_to_partner"
                ? "consignment_out"
                : "consignment_return",
            reference_type: "consignment_movement",
            counterparty_type: "retail_partner",
            counterparty_id: partner.partner_id,
            notes: `Consignment ${input.movement_type} → ${partner.display_name}`,
          },
        });
        stock_movement_id = sm ? sm.movement_id : null;
      } catch (err) {
        logger.error(
          { err: err.message, brand, partner_id: partner.partner_id },
          "retail_partners: warehouse stock movement failed",
        );
      }
    }

    const movement_number = await repo.nextNumber({
      client,
      brand,
      type: "consignment_movement",
    });
    const movement = await repo.insertMovement({
      client,
      brand,
      m: {
        movement_number,
        consignment_location_id: input.consignment_location_id,
        partner_id: partner.partner_id,
        variant_id: input.variant_id,
        movement_type: input.movement_type,
        quantity: sign * units,
        unit_retail_price_ngn: unit_retail
          ? toCurrencyString(unit_retail)
          : null,
        partner_share_ngn: partnerShare ? toCurrencyString(partnerShare) : null,
        brand_share_ngn: brandShare ? toCurrencyString(brandShare) : null,
        reported_sale_at: input.reported_sale_at,
        reported_customer_name: input.reported_customer_name,
        stock_movement_id,
        notes: input.notes,
        recorded_by: user.user_id,
      },
    });

    // Maintain consignment_stock.
    const cur = await repo.getStockRow({
      client,
      brand,
      consignment_location_id: input.consignment_location_id,
      variant_id: input.variant_id,
    });
    const onHand = (cur ? cur.qty_on_hand : 0) + sign * units;
    await repo.upsertStock({
      client,
      brand,
      row: {
        consignment_location_id: input.consignment_location_id,
        partner_id: partner.partner_id,
        variant_id: input.variant_id,
        qty_on_hand: Math.max(onHand, 0),
        qty_sold:
          (cur ? cur.qty_sold_since_last_settlement : 0) +
          (input.movement_type === "partner_sale" ? units : 0),
        qty_returned:
          (cur ? cur.qty_returned_since_last_settlement : 0) +
          (input.movement_type === "partner_return" ? units : 0),
        agreed_retail_price_ngn: unit_retail
          ? toCurrencyString(unit_retail)
          : cur
            ? cur.agreed_retail_price_ngn
            : null,
      },
    });

    await A(
      brand,
      user,
      "retail_partner.movement",
      "consignment_movement",
      movement.movement_id,
      { movement_type: input.movement_type, units },
      request_id,
    );
    events.emit("movement.recorded", {
      brand,
      partner_id: partner.partner_id,
      movement_type: input.movement_type,
    });
    return movement;
  });
}

// ── Settlements ────────────────────────────────────────────
function listSettlements(args) {
  return repo.listSettlements(args);
}
async function getSettlement({ brand, id }) {
  const s = await repo.findSettlement({ brand, id });
  if (!s) throw new NotFoundError("Settlement");
  return s;
}

/** Roll a partner's unsettled sale/return/damage movements into a settlement. */
async function generateSettlement({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const partner = await repo.findPartner({
      client,
      brand,
      id: input.partner_id,
    });
    if (!partner) throw new NotFoundError("Retail partner");
    const movements = await repo.unsettledForPeriod({
      client,
      brand,
      partner_id: input.partner_id,
      period_start: input.period_start,
      period_end: input.period_end,
    });
    if (!movements.length)
      throw new AppError(
        "NOTHING_TO_SETTLE",
        "No unsettled movements in period",
        422,
      );

    const lines = new Map(); // key: variant|location
    let gross = money(0),
      returns = money(0),
      partnerShare = money(0),
      brandShare = money(0),
      damages = money(0);
    let unitsSold = 0,
      unitsReturned = 0;

    for (const m of movements) {
      const key = `${m.variant_id}|${m.consignment_location_id}`;
      const acc = lines.get(key) || {
        variant_id: m.variant_id,
        consignment_location_id: m.consignment_location_id,
        units_sold: 0,
        units_returned: 0,
        units_damaged: 0,
        gross_sales_ngn: money(0),
        partner_share_ngn: money(0),
        brand_share_ngn: money(0),
      };
      const units = Math.abs(m.quantity);
      if (m.movement_type === "partner_sale") {
        acc.units_sold += units;
        acc.gross_sales_ngn = acc.gross_sales_ngn.plus(
          money(m.unit_retail_price_ngn || 0).times(units),
        );
        acc.partner_share_ngn = acc.partner_share_ngn.plus(
          money(m.partner_share_ngn || 0),
        );
        acc.brand_share_ngn = acc.brand_share_ngn.plus(
          money(m.brand_share_ngn || 0),
        );
        gross = gross.plus(money(m.unit_retail_price_ngn || 0).times(units));
        partnerShare = partnerShare.plus(money(m.partner_share_ngn || 0));
        brandShare = brandShare.plus(money(m.brand_share_ngn || 0));
        unitsSold += units;
      } else if (m.movement_type === "partner_return") {
        acc.units_returned += units;
        returns = returns.plus(
          money(m.unit_retail_price_ngn || 0).times(units),
        );
        unitsReturned += units;
      } else if (m.movement_type === "partner_damage") {
        acc.units_damaged += units;
        damages = damages.plus(
          money(m.unit_retail_price_ngn || 0).times(units),
        );
      }
      lines.set(key, acc);
    }

    const settlement_number = await repo.nextNumber({
      client,
      brand,
      type: "partner_settlement",
    });
    const settlement = await repo.createSettlement({
      client,
      brand,
      s: {
        settlement_number,
        partner_id: input.partner_id,
        period_start: input.period_start,
        period_end: input.period_end,
        total_gross_sales_ngn: toCurrencyString(gross),
        total_returns_ngn: toCurrencyString(returns),
        total_net_sales_ngn: toCurrencyString(gross.minus(returns)),
        total_partner_share_ngn: toCurrencyString(partnerShare),
        total_brand_share_ngn: toCurrencyString(brandShare),
        total_damages_ngn: toCurrencyString(damages),
        units_sold: unitsSold,
        units_returned: unitsReturned,
      },
    });

    let order = 0;
    for (const acc of lines.values()) {
      await repo.addSettlementLine({
        client,
        brand,
        line: {
          settlement_id: settlement.settlement_id,
          variant_id: acc.variant_id,
          consignment_location_id: acc.consignment_location_id,
          units_sold: acc.units_sold,
          units_returned: acc.units_returned,
          units_damaged: acc.units_damaged,
          gross_sales_ngn: toCurrencyString(acc.gross_sales_ngn),
          partner_share_ngn: toCurrencyString(acc.partner_share_ngn),
          brand_share_ngn: toCurrencyString(acc.brand_share_ngn),
          display_order: order++,
        },
      });
    }

    await repo.linkMovementsToSettlement({
      client,
      brand,
      movement_ids: movements.map((m) => m.movement_id),
      settlement_id: settlement.settlement_id,
    });
    await repo.resetStockCounters({
      client,
      brand,
      partner_id: input.partner_id,
    });

    await A(
      brand,
      user,
      "retail_partner.settlement.generate",
      "partner_settlement",
      settlement.settlement_id,
      { settlement_number, lines: lines.size },
      request_id,
    );
    events.emit("settlement.generated", {
      brand,
      settlement_id: settlement.settlement_id,
    });
    return { ...settlement, lines_count: lines.size };
  });
}
async function approveSettlement({ brand, user, request_id, id }) {
  const s = await repo.findSettlement({ brand, id });
  if (!s) throw new NotFoundError("Settlement");
  if (s.status !== "draft" && s.status !== "reviewed")
    throw new AppError("BAD_STATE", `Settlement is ${s.status}`, 422);
  const updated = await repo.setSettlementStatus({
    brand,
    id,
    status: "approved",
    fields: {
      approved_by: user.user_id,
      approved_at: new Date().toISOString(),
    },
  });
  await A(
    brand,
    user,
    "retail_partner.settlement.approve",
    "partner_settlement",
    id,
    null,
    request_id,
  );
  return updated;
}
async function markSettlementPaid({
  brand,
  user,
  request_id,
  id,
  payment_reference,
}) {
  const s = await repo.findSettlement({ brand, id });
  if (!s) throw new NotFoundError("Settlement");
  if (s.status !== "approved" && s.status !== "invoiced")
    throw new AppError("BAD_STATE", `Settlement is ${s.status}`, 422);
  const updated = await repo.setSettlementStatus({
    brand,
    id,
    status: "paid",
    fields: {
      paid_at: new Date().toISOString(),
      payment_reference: payment_reference || null,
    },
  });
  await A(
    brand,
    user,
    "retail_partner.settlement.paid",
    "partner_settlement",
    id,
    null,
    request_id,
  );
  events.emit("settlement.paid", { brand, settlement_id: id });
  return updated;
}

module.exports = {
  listPartners,
  getPartner,
  createPartner,
  updatePartner,
  setStatus,
  listLocations,
  createLocation,
  listStock,
  listMovements,
  recordMovement,
  listSettlements,
  getSettlement,
  generateSettlement,
  approveSettlement,
  markSettlementPaid,
};
