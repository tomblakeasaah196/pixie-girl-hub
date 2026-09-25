/**
 * Pre-order auto-allocation — when stock arrives, fulfil the pre-orders waiting
 * on it, before that stock is ever exposed to a fresh walk-in sale.
 *
 * Background (000086): an out-of-stock line is accepted as a PRE-ORDER rather
 * than blocked. A paid pre-order is money taken with no stock behind it (markPaid
 * records it as a shortfall); an unpaid one is a placement waiting on its balance.
 * Either way, until now nothing linked newly-received stock back to those waiting
 * orders — ops had to notice by hand.
 *
 * This closes that loop. On every stock receipt (`stock.received`, enqueued by
 * stock.service.applyMovement for receive / production_in / adjustment_in and
 * dispatched post-commit by the worker) we run `allocateForVariant`:
 *
 *   • DRAW for a PAID pre-order   — a 'sale' movement, exactly as markPaid would
 *     have if the stock had been there. The order.paid sale journal already
 *     posted this line's COGS + inventory relief (accounting.subscribers), and a
 *     'sale' movement is GL-excluded, so the draw only relieves the *physical*
 *     shelf — no double posting. The receive that raised on_hand and this draw
 *     net to zero inventory, which is exactly right: it came in and went straight
 *     out to the buyer who already paid.
 *   • RESERVE for an UNPAID pre-order — hold the unit for that order so a walk-in
 *     can't buy it out from under them; it deducts normally when they finish
 *     paying (markPaid releases the hold then draws).
 *
 * Priority (owner's call): PAID orders first, then oldest-first within each
 * group. Partial receipts allocate down that queue until the arriving pool runs
 * out; whatever is left keeps its pre-order flag and is picked up by the next
 * receipt (or the deploy reconcile).
 *
 * IDEMPOTENT BY CONSTRUCTION. The arriving pool is `available = on_hand −
 * reserved` under a row lock, and each order's outstanding demand is re-derived
 * from the movement ledger every pass (netSold + reservations already held). So
 * an at-least-once redelivery of the same event, or the deploy sweep running on
 * top of the live path, only ever allocates a genuine deficit against genuinely
 * available stock — it can never double-draw. Using `available` (not raw
 * on_hand) as the pool also keeps the SSOT invariant reserved ≤ on_hand true for
 * both the draw and the reserve.
 */

"use strict";

const { transaction } = require("../../config/database");
const repo = require("./sales.repo");
const stockRepo = require("../stock/stock.repo");
const stockService = require("../stock/stock.service");
const events = require("./sales.events");
const { logger } = require("../../config/logger");

function emptyResult() {
  return {
    allocated: false,
    units_deducted: 0,
    units_reserved: 0,
    orders_fulfilled: 0,
    fulfilled_orders: [],
  };
}

/**
 * Allocate freshly-arrived stock of one variant to the pre-orders waiting on it.
 *
 * @param {object}  a
 * @param {string}  a.brand
 * @param {string}  a.variant_id
 * @param {string} [a.location_id]     defaults to the brand's default location
 * @param {string} [a.actor_user_id]   who to attribute the movements to (nullable)
 * @param {boolean}[a.notify=true]     emit `preorder.allocated` for ops/sales +
 *                                     customer follow-up (off for silent sweeps)
 * @returns {Promise<{allocated:boolean, units_deducted:number, units_reserved:number,
 *                    orders_fulfilled:number, fulfilled_orders:Array}>}
 */
async function allocateForVariant({
  brand,
  variant_id,
  location_id = null,
  actor_user_id = null,
  notify = true,
}) {
  if (!brand || !variant_id) return emptyResult();

  const result = await transaction(async (client) => {
    let locId = location_id;
    if (!locId) {
      const loc = await stockRepo.getDefaultLocation({ client, brand });
      if (!loc) return emptyResult();
      locId = loc.location_id;
    }

    // Lock the level and size the arriving pool. `available` = on_hand −
    // reserved is the correct budget for BOTH a draw (lowers on_hand) and a
    // reserve (raises reserved) — each consumes one unit of headroom.
    const level = await stockRepo.lockLevel({
      client,
      brand,
      variant_id,
      location_id: locId,
    });
    if (!level) return emptyResult();
    let pool = Number(level.available);
    if (!Number.isFinite(pool) || pool <= 0) return emptyResult();

    const lines = await repo.openPreorderLinesForVariant({
      client,
      brand,
      variant_id,
    });
    if (!lines.length) return emptyResult();

    // Group lines by order, preserving the priority order of first appearance
    // (the SQL already sorted paid-first, then oldest-first).
    const orderSeq = [];
    const byOrder = new Map();
    for (const l of lines) {
      let g = byOrder.get(l.order_id);
      if (!g) {
        g = {
          order_id: l.order_id,
          order_number: l.order_number,
          status: l.status,
          sales_channel: l.sales_channel,
          contact_id: l.contact_id,
          is_paid: l.is_paid,
          lines: [],
        };
        byOrder.set(l.order_id, g);
        orderSeq.push(g);
      }
      g.lines.push(l);
    }

    let unitsDeducted = 0;
    let unitsReserved = 0;
    const fulfilled = [];

    for (const order of orderSeq) {
      if (pool <= 0) break;

      const drawn = await stockRepo.netSoldForOrder({
        client,
        brand,
        variant_id,
        location_id: locId,
        reference_id: order.order_id,
      });
      const held = await stockRepo.outstandingReservationForOrder({
        client,
        brand,
        variant_id,
        location_id: locId,
        reference_id: order.order_id,
      });
      const demand = order.lines.reduce((s, l) => s + Number(l.quantity), 0);
      const alreadyCovered = drawn + held;
      const deficit = demand - alreadyCovered;

      let allocatedNow = 0;
      if (deficit > 0) {
        allocatedNow = Math.min(deficit, pool);
        if (allocatedNow > 0) {
          if (order.is_paid) {
            // The line's captured cost is informational on a GL-excluded 'sale'
            // movement (COGS already posted at order.paid); pass it for ledger
            // fidelity. Outflow costing relieves at the running average anyway.
            const costLine = order.lines.find(
              (l) => l.unit_cost_ngn !== null && l.unit_cost_ngn !== undefined,
            );
            const unit_cost_ngn = costLine ? costLine.unit_cost_ngn : null;
            await stockService.deductForSale({
              client,
              brand,
              variant_id,
              location_id: locId,
              quantity: allocatedNow,
              reference_id: order.order_id,
              sales_channel: order.sales_channel,
              unit_cost_ngn,
              user_id: actor_user_id,
            });
            unitsDeducted += allocatedNow;
          } else {
            await stockService.reserveForOrder({
              client,
              brand,
              variant_id,
              location_id: locId,
              quantity: allocatedNow,
              reference_id: order.order_id,
              user_id: actor_user_id,
            });
            unitsReserved += allocatedNow;
          }
          pool -= allocatedNow;
        }
      }

      // Clear the pre-order flag on lines now fully backed by stock, greedily in
      // display order. A line is resolved once cumulative coverage reaches its
      // quantity; a partially-covered line stays a pre-order for the next receipt.
      let budget = alreadyCovered + allocatedNow;
      const resolvedLineIds = [];
      for (const l of order.lines) {
        if (budget >= Number(l.quantity)) {
          resolvedLineIds.push(l.line_id);
          budget -= Number(l.quantity);
        } else {
          break;
        }
      }
      if (resolvedLineIds.length) {
        await repo.resolvePreorderLines({
          client,
          brand,
          line_ids: resolvedLineIds,
        });
      }

      if (allocatedNow > 0 || resolvedLineIds.length) {
        const state = await repo.recomputeOrderPreorderState({
          client,
          brand,
          order_id: order.order_id,
        });
        if (order.is_paid && allocatedNow > 0) {
          // The paid-order shortfall for this variant is now (partly) drawn —
          // prune it from the ops-facing note once nothing of it is left owing.
          if (!state.is_preorder || drawn + allocatedNow >= demand) {
            await repo
              .clearShortfallForVariant({
                client,
                brand,
                order_id: order.order_id,
                variant_id,
              })
              .catch(() => {});
          }
        }
        if (allocatedNow > 0) {
          fulfilled.push({
            order_id: order.order_id,
            order_number: order.order_number,
            contact_id: order.contact_id,
            is_paid: order.is_paid,
            units: allocatedNow,
            action: order.is_paid ? "deducted" : "reserved",
            fully_fulfilled: !state.is_preorder,
          });
        }
      }
    }

    return {
      allocated: unitsDeducted + unitsReserved > 0,
      units_deducted: unitsDeducted,
      units_reserved: unitsReserved,
      orders_fulfilled: fulfilled.filter((f) => f.fully_fulfilled).length,
      fulfilled_orders: fulfilled,
    };
  });

  if (notify && result.allocated) {
    // In-process, best-effort: the subscriber notifies ops + sales (see
    // preorder-allocation.subscribers). Lost on a restart is acceptable — the
    // stock draw/reserve is already committed; this is the alert on top.
    try {
      events.emit("preorder.allocated", {
        brand,
        variant_id,
        units_deducted: result.units_deducted,
        units_reserved: result.units_reserved,
        orders: result.fulfilled_orders,
      });
    } catch (err) {
      logger.warn(
        { err: err.message, brand, variant_id },
        "preorder allocation: notify emit failed",
      );
    }
  }

  return result;
}

/**
 * Sweep every variant with an open pre-order for a brand and allocate any stock
 * that has arrived. Used by the deploy/backfill reconcile (scripts/backfill-
 * preorder-allocations.js) and any manual re-run. Silent by default (no
 * per-order customer/ops storm for a historical cleanup) and logs one row to
 * shared.preorder_allocation_runs so ops can see it ran and what it moved.
 *
 * @param {object}  a
 * @param {string}  a.brand
 * @param {'deploy'|'manual'|'historical'} [a.mode='manual']
 * @param {string} [a.actor_user_id]
 * @param {boolean}[a.notify=false]
 */
async function allocateForBrand({
  brand,
  mode = "manual",
  actor_user_id = null,
  notify = false,
}) {
  const startedAt = new Date();
  const totals = {
    variants_scanned: 0,
    orders_fulfilled: 0,
    units_deducted: 0,
    units_reserved: 0,
  };
  let ok = true;
  let errNote = null;

  try {
    const variants = await repo.variantsWithOpenPreorders({
      client: null,
      brand,
    });
    totals.variants_scanned = variants.length;
    for (const variant_id of variants) {
      try {
        const r = await allocateForVariant({
          brand,
          variant_id,
          actor_user_id,
          notify,
        });
        totals.orders_fulfilled += r.orders_fulfilled;
        totals.units_deducted += r.units_deducted;
        totals.units_reserved += r.units_reserved;
      } catch (err) {
        ok = false;
        errNote = err.message;
        logger.error(
          { err: err.message, brand, variant_id },
          "preorder allocation: variant sweep failed",
        );
      }
    }
  } catch (err) {
    ok = false;
    errNote = err.message;
    logger.error(
      { err: err.message, brand },
      "preorder allocation: brand sweep failed",
    );
  }

  await recordRun({ brand, mode, ok, note: errNote, totals, startedAt }).catch(
    (err) =>
      logger.warn(
        { err: err.message, brand },
        "preorder allocation: run-log write failed",
      ),
  );

  return { ok, ...totals };
}

/** Has a successful allocation sweep ever been logged for this brand? Lets the
 *  backfill script report "first historical run" vs "routine reconcile". */
async function hasEverRun({ brand }) {
  const { query } = require("../../config/database");
  const { rows } = await query(
    `SELECT 1 FROM shared.preorder_allocation_runs
      WHERE business = $1 AND ok = true LIMIT 1`,
    [brand],
  );
  return rows.length > 0;
}

async function recordRun({ brand, mode, ok, note, totals, startedAt }) {
  const { query } = require("../../config/database");
  await query(
    `INSERT INTO shared.preorder_allocation_runs
       (business, mode, variants_scanned, orders_fulfilled,
        units_deducted, units_reserved, ok, notes, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
    [
      brand,
      mode,
      totals.variants_scanned,
      totals.orders_fulfilled,
      totals.units_deducted,
      totals.units_reserved,
      ok,
      note,
      startedAt.toISOString(),
    ],
  );
}

module.exports = {
  allocateForVariant,
  allocateForBrand,
  hasEverRun,
};
