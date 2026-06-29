/**
 * Loyalty earn-rules admin service (Module 6.23). Thin CRUD + audit over
 * earn.repo so the owner can manage how points are earned from the UI.
 */

"use strict";

const repo = require("./earn.repo");
const { audit } = require("../../middleware/audit");

const list = ({ brand }) => repo.listAll({ brand });

async function create({ brand, user, request_id, input }) {
  const rule = await repo.create({ brand, input, user_id: user.user_id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.earn_rule.create",
    target_type: "loyalty_earn_rule",
    target_id: rule.rule_id,
    after: { rule_key: rule.rule_key },
    request_id,
  });
  return rule;
}

async function update({ brand, user, request_id, id, patch }) {
  const rule = await repo.update({ brand, id, patch });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.earn_rule.update",
    target_type: "loyalty_earn_rule",
    target_id: id,
    after: patch,
    request_id,
  });
  return rule;
}

module.exports = { list, create, update };
