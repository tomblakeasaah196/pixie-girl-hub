/**
 * Nomba ledger reconciliation sweep. Runs every 10 minutes — see
 * modules/pos/ledger-sync.service.js for why this exists (webhook delivery
 * can silently fail; this asks Nomba's own account ledger directly so
 * nothing that touched the business's Nomba account goes unseen).
 */

"use strict";

const { logger } = require("../../config/logger");
const { runNombaLedgerSync } = require("../../modules/pos/ledger-sync.service");

async function runNombaLedgerSyncSweep() {
  try {
    return await runNombaLedgerSync();
  } catch (err) {
    logger.error({ err: err.message }, "nomba ledger sync sweep failed");
    return { results: [], totalParked: 0 };
  }
}

module.exports = { runNombaLedgerSyncSweep };
