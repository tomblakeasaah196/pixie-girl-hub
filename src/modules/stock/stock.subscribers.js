/**
 * Stock subscriber — seeds a zero stock_levels row when a variant is created so
 * the variant is immediately trackable (SSOT). Durable + POST-COMMIT via the
 * transactional outbox (H-2): the variant is committed before this runs, which
 * removes the previous pre-commit ordering risk. Idempotent (seedLevel is a
 * no-op if the level already exists), so at-least-once redelivery is safe.
 *
 * Also: when an adjustment (write-off / write-down) is submitted for
 * approval, task + notify everyone who can approve it — otherwise a
 * submission just sits invisibly until someone happens to open the Stock
 * module. In-process on stock.events (not the outbox), matching how the rest
 * of this repo's submit-for-approval notifications work: best-effort, never
 * blocks the submission itself if a notify/task write fails.
 *
 * Registered in the worker (the outbox dispatcher) — see src/jobs/worker.js —
 * and harmlessly in the web process via stock.service (it never dispatches) —
 * except the adjustment.submitted listener below, which specifically NEEDS
 * the web process: that's where submitAdjustment's events.emit actually runs.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const events = require("./stock.events");
const repo = require("./stock.repo");
const tasksService = require("../../shared/tasks/tasks.service");
const { logger } = require("../../config/logger");

let registered = false;

async function notifyApprovers({ brand, id }) {
  const adj = await repo.getAdjustment({ brand, id });
  if (!adj) return;
  const approvers = await repo.listAdjustmentApprovers({ brand });
  for (const u of approvers) {
    try {
      await tasksService.createFromModule({
        brand,
        created_by: adj.created_by,
        task: {
          title: `Approve stock ${adj.adjustment_type.replace(/_/g, " ")} ${adj.adjustment_number}`,
          description: adj.reason,
          priority: "high",
          assigned_to: u.user_id,
          reference_type: "stock_adjustment",
          reference_id: id,
        },
      });
    } catch (err) {
      logger.warn(
        { err, brand, id, user_id: u.user_id },
        "stock: failed to notify/task an adjustment approver",
      );
    }
  }
}

function register() {
  if (registered) return;
  registered = true;
  // GAP-7: seed into ALL active locations, not just default
  outbox.register("variant.created", "stock-seed-level", async (payload) => {
    const { brand, variant_id } = payload || {};
    if (!brand || !variant_id) return;
    const locs = await repo.listLocations({ brand });
    for (const loc of locs) {
      if (loc.is_active)
        await repo.seedLevel({
          brand,
          variant_id,
          location_id: loc.location_id,
        });
    }
  });
  events.on("adjustment.submitted", ({ brand, id }) => {
    notifyApprovers({ brand, id }).catch((err) =>
      logger.warn(
        { err, brand, id },
        "stock: adjustment.submitted approver-notify failed",
      ),
    );
  });
  logger.info(
    "stock subscribers registered (outbox variant.created → seed level; adjustment.submitted → notify approvers)",
  );
}

register();

module.exports = { register };
