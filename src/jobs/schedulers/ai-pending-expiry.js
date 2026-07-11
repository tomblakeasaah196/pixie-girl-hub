/**
 * Praxis pending-action + Chief of Staff pending-plan expiry sweep.
 * Every 15 minutes. Marks unconfirmed proposals as expired once past their
 * expires_at, preventing stale confirmations.
 *
 * NB: rows are created (and confirmed from) status 'proposed' — the sweep
 * previously matched status 'pending', which exists nowhere, so it had never
 * expired a single row. Each expiry also emits pending.resolved so the
 * owner's open Praxis surfaces drop the card live (relay → user:{id}:ai_pending
 * via the Redis emitter bridge, since this runs in the worker).
 *
 * PR6: the same sweep also expires stale Chief of Staff BATCH PLANS
 * (shared.ai_pending_plans). confirmPlan already refuses an expired plan at
 * confirm-time (belt), but sweeping here (braces) flips the parent row to
 * 'expired' and emits cos `plan.resolved` so the CoS tab drops the plan card
 * without waiting for the CEO to click Approve on something already dead. The
 * per-step ai_pending_actions rows (plan_id set, status 'proposed') are expired
 * by the same first UPDATE — they carry their own expires_at.
 */

"use strict";

const { logger } = require("../../config/logger");
const { query } = require("../../config/database");
const events = require("../../modules/praxis_ai/praxis.events");
const cosEvents = require("../../modules/chief_of_staff/cos.events");

async function runPendingActionExpirySweep() {
  const { rows } = await query(
    `UPDATE shared.ai_pending_actions
        SET status = 'expired', updated_at = now()
      WHERE status = 'proposed'
        AND expires_at < now()
      RETURNING pending_id, proposed_by_user_id`,
  );
  for (const r of rows) {
    events.emit("pending.resolved", {
      pending_id: r.pending_id,
      user_id: r.proposed_by_user_id,
      status: "expired",
    });
  }
  if (rows.length > 0)
    logger.info({ expired: rows.length }, "ai pending actions expired");

  // Chief of Staff batch plans (PR6): expire un-approved plans past their window.
  const { rows: planRows } = await query(
    `UPDATE shared.ai_pending_plans
        SET status = 'expired', updated_at = now()
      WHERE status = 'proposed'
        AND expires_at < now()
      RETURNING plan_id, proposed_by_user_id`,
  );
  for (const p of planRows) {
    cosEvents.emit("plan.resolved", {
      plan_id: p.plan_id,
      user_id: p.proposed_by_user_id,
      status: "expired",
    });
  }
  if (planRows.length > 0)
    logger.info({ expired: planRows.length }, "cos pending plans expired");
}

module.exports = { runPendingActionExpirySweep };
