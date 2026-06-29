/**
 * Referral programme admin service (Module 6.23). Manage settings + the
 * tiered ladder + read the dashboard. Wraps referral-config.repo with audit.
 */

"use strict";

const repo = require("./referral-config.repo");
const { audit } = require("../../middleware/audit");

const getSettings = ({ brand }) => repo.getSettings({ brand });
const listTiers = ({ brand }) => repo.listTiers({ brand });
const dashboard = ({ brand }) => repo.dashboard({ brand });

async function saveSettings({ brand, user, request_id, patch }) {
  const settings = await repo.upsertSettings({ brand, patch, user_id: user.user_id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.referral.settings",
    target_type: "referral_program_settings",
    target_id: brand,
    after: patch,
    request_id,
  });
  return settings;
}

async function createTier({ brand, user, request_id, input }) {
  const tier = await repo.createTier({ brand, input });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.referral.tier_create",
    target_type: "referral_reward_tier",
    target_id: tier.tier_id,
    request_id,
  });
  return tier;
}

async function updateTier({ brand, id, patch }) {
  return repo.updateTier({ brand, id, patch });
}

async function deleteTier({ brand, id }) {
  await repo.deleteTier({ brand, id });
  return { deleted: true };
}

module.exports = {
  getSettings,
  listTiers,
  dashboard,
  saveSettings,
  createTier,
  updateTier,
  deleteTier,
};
