/**
 * Social platform registry — business logic. Deliberately thin: this is a
 * config table an admin edits directly, not a workflow.
 */

"use strict";

const repo = require("./social-platforms.repo");
const { audit } = require("../../middleware/audit");
const { AppError, NotFoundError } = require("../../utils/errors");

function listPlatforms({ includeInactive = true } = {}) {
  return repo.list({ includeInactive });
}

async function createPlatform({ user, request_id, input }) {
  const existing = await repo.get({ key: input.platform_key });
  if (existing) {
    throw new AppError(
      "PLATFORM_EXISTS",
      `"${input.platform_key}" is already registered`,
      409,
    );
  }
  const row = await repo.create({ input, created_by: user.user_id });
  await audit({
    business: null,
    user_id: user.user_id,
    action_key: "social_platforms.create",
    target_type: "social_platform",
    target_id: row.platform_key,
    after: { display_name: row.display_name, apify_actor_id: row.apify_actor_id },
    request_id,
  });
  return row;
}

async function updatePlatform({ user, request_id, key, input }) {
  const row = await repo.update({ key, fields: input });
  if (!row) throw new NotFoundError("Platform");
  await audit({
    business: null,
    user_id: user.user_id,
    action_key: "social_platforms.update",
    target_type: "social_platform",
    target_id: key,
    after: input,
    request_id,
  });
  return row;
}

async function setActive({ user, request_id, key, is_active }) {
  const row = await repo.setActive({ key, is_active });
  if (!row) throw new NotFoundError("Platform");
  await audit({
    business: null,
    user_id: user.user_id,
    action_key: "social_platforms.set_active",
    target_type: "social_platform",
    target_id: key,
    after: { is_active },
    request_id,
  });
  return row;
}

module.exports = { listPlatforms, createPlatform, updatePlatform, setActive };
