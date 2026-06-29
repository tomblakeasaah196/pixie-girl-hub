/**
 * Maintenance plans service (Module 6.23). Thin CRUD + audit over
 * maintenance.repo. Brand-specific (Faitlyn salon maintenance subscriptions).
 */

"use strict";

const repo = require("./maintenance.repo");
const { audit } = require("../../middleware/audit");

const listPlans = ({ brand }) => repo.listPlans({ brand });
const listSubscriptions = ({ brand }) => repo.listSubscriptions({ brand });

async function createPlan({ brand, user, request_id, input }) {
  const plan = await repo.createPlan({ brand, input });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.maintenance.create",
    target_type: "maintenance_plan",
    target_id: plan.plan_id,
    after: { plan_key: plan.plan_key },
    request_id,
  });
  return plan;
}

async function updatePlan({ brand, user, request_id, id, patch }) {
  const plan = await repo.updatePlan({ brand, id, patch });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.maintenance.update",
    target_type: "maintenance_plan",
    target_id: id,
    after: patch,
    request_id,
  });
  return plan;
}

module.exports = { listPlans, listSubscriptions, createPlan, updatePlan };
