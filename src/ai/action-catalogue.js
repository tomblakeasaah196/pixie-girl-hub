/**
 * Praxis Action Catalogue (V2.2 §8.3) — thin facade.
 *
 * The catalogue is owned by AI Governance (shared.ai_action_catalogue, managed
 * in AI Control). This module forwards to governance.service so `src/ai` stays
 * a coherent public path, using the real column names (method/route/
 * payload_schema/entity_scope/required_permission).
 */

"use strict";

const governance = require("../modules/ai_governance/governance.service");

/** ai_enabled catalogue entries in scope for the brand (Praxis's allowlist). */
async function findEnabledActions({ brand }) {
  const actions = await governance.listActions({ ai_enabled: true });
  return actions.filter(
    (a) =>
      !a.entity_scope || a.entity_scope === "both" || a.entity_scope === brand,
  );
}

async function findActionByKey(action_key) {
  const actions = await governance.listActions({});
  return actions.find((a) => a.action_key === action_key) || null;
}

module.exports = { findEnabledActions, findActionByKey };
