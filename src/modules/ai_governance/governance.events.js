/**
 * AI Control & Governance (V2.2 §6.31)
 * Domain events emitted by the service layer.
 *
 * These feed:
 *   - Socket.io real-time updates (via realtime/handlers)
 *   - Audit log (already written separately, but events get extra context)
 *   - AI Insights triggers
 *   - Workflow engine (some events open workflow instances)
 *
 * Use a simple emitter — keep payloads small (just IDs + brand), let
 * subscribers re-query if they need the full record.
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("ai_governance");
