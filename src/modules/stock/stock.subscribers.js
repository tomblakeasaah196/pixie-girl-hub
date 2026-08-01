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
const {
  requestApproval,
  settleApproval,
} = require("../../shared/approvals/approval-requests");
const { logger } = require("../../config/logger");

let registered = false;

/**
 * A write-off / write-down went out for approval. The shared approval spine
 * raises ONE deep-linked task + notification per approver, so the approver
 * lands on this adjustment in the Adjustments queue rather than being told a
 * decision is waiting somewhere.
 */
async function askApprovers({ brand, id }) {
  const adj = await repo.getAdjustment({ brand, id });
  if (!adj) return;
  const approvers = await repo.listAdjustmentApprovers({ brand });
  const units = (adj.lines || []).reduce(
    (sum, l) => sum + (l.physical_count - l.system_count),
    0,
  );
  await requestApproval({
    brand,
    reference_type: "stock_adjustment",
    reference_id: id,
    approver_user_ids: approvers.map((u) => u.user_id),
    requested_by: adj.created_by,
    priority: "high",
    title: `Approve stock ${adj.adjustment_type.replace(/_/g, " ")} ${adj.adjustment_number}`,
    description: `${adj.reason}${units ? ` · ${units > 0 ? "+" : ""}${units} unit(s)` : ""}`,
  });
}

/**
 * The decision landed. Every approver's task for this adjustment closes
 * itself — including the second tier's, which never gets to act once the
 * first decision is final — and the person who raised it is told, with a link
 * back to the adjustment.
 */
async function closeOutApprovers({
  brand,
  id,
  outcome,
  actor,
  requested_by,
  adjustment_number,
}) {
  await settleApproval({
    brand,
    reference_type: "stock_adjustment",
    reference_id: id,
    outcome,
    requester_user_id: requested_by,
    actor_name: actor,
    title: adjustment_number
      ? `Stock adjustment ${adjustment_number}`
      : undefined,
  });
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
    askApprovers({ brand, id }).catch((err) =>
      logger.warn(
        { err, brand, id },
        "stock: adjustment.submitted approver-notify failed",
      ),
    );
  });
  // The decision retires the request. Without these, approving in the queue
  // left every approver's task open at every tier — the approver had to
  // remember to tick off work the system already knew was finished.
  for (const [event, outcome] of [
    ["adjustment.approved", "approved"],
    ["adjustment.rejected", "rejected"],
  ]) {
    events.on(event, (payload) => {
      closeOutApprovers({ ...payload, outcome }).catch((err) =>
        logger.warn(
          { err, brand: payload && payload.brand, id: payload && payload.id },
          `stock: ${event} approval close-out failed`,
        ),
      );
    });
  }
  logger.info(
    "stock subscribers registered (outbox variant.created → seed level; adjustment submit/decide → approval tasks)",
  );
}

register();

module.exports = { register };
