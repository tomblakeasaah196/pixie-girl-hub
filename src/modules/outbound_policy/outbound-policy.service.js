/**
 * Outbound Channel Policy — business logic.
 */

"use strict";

const repo = require("./outbound-policy.repo");
const { audit } = require("../../middleware/audit");

function listPolicies({ brand }) {
  return repo.listPolicies({ brand });
}

function getPolicy({ brand, event_key }) {
  return repo.getPolicy({ brand, event_key });
}

async function upsertPolicy({ brand, user, request_id, input }) {
  const p = await repo.upsertPolicy({
    brand,
    user_id: user.user_id,
    input,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "outbound_policy.upsert",
    target_type: "outbound_channel_policy",
    target_id: p.policy_id,
    after: {
      event_key: p.event_key,
      channel_preference: p.channel_preference,
      block_whatsapp: p.block_whatsapp,
    },
    request_id,
  });
  return p;
}

/**
 * Resolve which channel to use for a given event + contact. Used by
 * subscribers across the codebase (sales, invoicing, retention, etc.)
 * so they all share one source of truth.
 */
function resolveChannel(args) {
  return repo.resolveChannel(args);
}

module.exports = { listPolicies, getPolicy, upsertPolicy, resolveChannel };
