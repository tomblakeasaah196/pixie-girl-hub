/**
 * Pre-order history + on-demand backfill — the "Fulfilled pre-orders" modal on
 * the Sales → Pre-orders tab.
 *
 * READ (`getHistory`): what the allocator has done and what's still stuck —
 * fulfilled pre-orders (stock applied) alongside the ones still waiting, plus
 * the last reconcile run so the screen is proof the automation ran.
 *
 * RUN (`runBackfill`): the manual escape hatch. Runs the same idempotent
 * reconcile the deploy sweep runs, but for the ACTIVE BRAND only and with
 * notifications ON — so a manual run behaves exactly like a real stock receipt
 * (ops + sales are told what it fulfilled). Idempotent, so clicking it when
 * nothing is pending is a harmless no-op.
 */

"use strict";

const repo = require("./sales.repo");
const allocation = require("./preorder-allocation.service");

async function getHistory({ brand, limit = 100 }) {
  const [fulfilled, waiting, last_run] = await Promise.all([
    repo.listFulfilledPreorders({ brand, limit }),
    repo.listWaitingPreorders({ brand, limit }),
    repo.lastAllocationRun({ brand }),
  ]);
  return { fulfilled, waiting, last_run };
}

/**
 * Run the pre-order reconcile for one brand, on demand, notifying ops + sales.
 * @returns {Promise<{ok:boolean, variants_scanned:number, orders_fulfilled:number,
 *                     units_deducted:number, units_reserved:number}>}
 */
async function runBackfill({ brand, user }) {
  return allocation.allocateForBrand({
    brand,
    mode: "manual",
    actor_user_id: user && user.user_id,
    notify: true,
  });
}

module.exports = { getHistory, runBackfill };
