/**
 * Praxis pending-action expiry sweep.
 * Every 15 minutes. Marks unconfirmed ai_pending_actions as expired once past
 * their expires_at, preventing stale confirmations.
 *
 * NB: rows are created (and confirmed from) status 'proposed' — the sweep
 * previously matched status 'pending', which exists nowhere, so it had never
 * expired a single row. Each expiry also emits pending.resolved so the
 * owner's open Praxis surfaces drop the card live (relay → user:{id}:ai_pending
 * via the Redis emitter bridge, since this runs in the worker).
 */

"use strict";

const { logger } = require("../../config/logger");
const { query } = require("../../config/database");
const events = require("../../modules/praxis_ai/praxis.events");

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
}

module.exports = { runPendingActionExpirySweep };
