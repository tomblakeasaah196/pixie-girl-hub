/**
 * Stock subscriber — seeds a zero stock_levels row when a variant is created so
 * the variant is immediately trackable (SSOT). Durable + POST-COMMIT via the
 * transactional outbox (H-2): the variant is committed before this runs, which
 * removes the previous pre-commit ordering risk. Idempotent (seedLevel is a
 * no-op if the level already exists), so at-least-once redelivery is safe.
 *
 * Registered in the worker (the outbox dispatcher) — see src/jobs/worker.js —
 * and harmlessly in the web process via stock.service (it never dispatches).
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const repo = require("./stock.repo");
const { logger } = require("../../config/logger");

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("variant.created", "stock-seed-level", async (payload) => {
    const { brand, variant_id } = payload || {};
    if (!brand || !variant_id) return;
    const loc = await repo.getDefaultLocation({ brand });
    if (loc)
      await repo.seedLevel({ brand, variant_id, location_id: loc.location_id });
  });
  logger.info(
    "stock subscribers registered (outbox variant.created → seed level)",
  );
}

register();

module.exports = { register };
