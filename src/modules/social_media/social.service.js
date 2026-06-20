/**
 * Social Media Management (V2.2 §6.14) — business logic.
 *
 * Connected accounts, scheduled/published posts + metrics, and the §6.1
 * integration: an inbound DM is bridged into the customer's Smartcomm thread,
 * linked to their contact profile — so social conversations live in the Hub,
 * not a silo.
 */

"use strict";

const repo = require("./social.repo");
const events = require("./social.events");
const smartcomm = require("../smartcomm/smartcomm.service");
const publisher = require("../../services/social-publisher.service");
const { audit } = require("../../middleware/audit");
const { NotFoundError, AppError } = require("../../utils/errors");

const A = (
  brand,
  user,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
) =>
  audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

// ── Accounts ───────────────────────────────────────────────
function listAccounts({ brand }) {
  return repo.listAccounts({ brand });
}
async function connectAccount({ brand, user, request_id, input }) {
  const account = await repo.createAccount({ brand, account: input });
  await A(
    brand,
    user,
    "social.account.connect",
    "social_account",
    account.account_id,
    { platform: input.platform },
    request_id,
  );
  events.emit("account.connected", { brand, account_id: account.account_id });
  return account;
}
async function revokeAccount({ brand, user, request_id, id }) {
  const ok = await repo.deactivateAccount({ brand, id });
  if (!ok) throw new NotFoundError("Social account");
  await A(
    brand,
    user,
    "social.account.revoke",
    "social_account",
    id,
    null,
    request_id,
  );
}

// ── Posts ──────────────────────────────────────────────────
async function listPosts(args) {
  // Free any planned drafts whose date has passed before returning the feed.
  await repo.detachStaleDrafts({ brand: args.brand });
  return repo.listPosts(args);
}
async function getPost({ brand, id }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  p.metrics = await repo.listMetrics({ post_id: id });
  return p;
}
async function createPost({ brand, user, request_id, input }) {
  // An explicit status wins (a planned draft carries scheduled_for as its
  // calendar date but stays a draft); otherwise infer from scheduled_for.
  const status = input.status || (input.scheduled_for ? "scheduled" : "draft");
  const post = await repo.createPost({ brand, post: { ...input, status } });
  await A(
    brand,
    user,
    "social.post.create",
    "social_post",
    post.post_id,
    { status },
    request_id,
  );
  events.emit("post.created", { brand, post_id: post.post_id });
  return post;
}
/**
 * Publish a post. Two paths:
 *   - external_post_id supplied → record an already-published post (manual).
 *   - otherwise → actually publish to the platform via the publisher service,
 *     marking the row publishing → published (+ external id/url) or failed.
 */
async function publishPost({ brand, user, request_id, id, external_post_id }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");

  if (external_post_id) {
    const updated = await repo.setPostStatus({
      brand,
      id,
      status: "published",
      fields: {
        published_at: new Date().toISOString(),
        external_post_id,
      },
    });
    await A(
      brand,
      user,
      "social.post.publish",
      "social_post",
      id,
      { manual: true },
      request_id,
    );
    events.emit("post.published", { brand, post_id: id });
    return updated;
  }

  if (!publisher.isPlatformConfigured(p.platform))
    throw new AppError(
      "SOCIAL_NOT_CONFIGURED",
      `${p.platform} publishing is not configured`,
      503,
    );

  await repo.setPostStatus({ brand, id, status: "publishing" });
  try {
    const res = await publisher.publish(p);
    const updated = await repo.setPostStatus({
      brand,
      id,
      status: "published",
      fields: {
        published_at: new Date().toISOString(),
        external_post_id: res.external_post_id || null,
        external_url: res.permalink || null,
        failure_message: null,
      },
    });
    await A(
      brand,
      user,
      "social.post.publish",
      "social_post",
      id,
      { platform: p.platform, external_post_id: res.external_post_id },
      request_id,
    );
    events.emit("post.published", { brand, post_id: id });
    return updated;
  } catch (err) {
    await repo.setPostStatus({
      brand,
      id,
      status: "failed",
      fields: { failure_message: String((err && err.message) || err) },
    });
    if (err instanceof AppError) throw err;
    throw new AppError(
      "PUBLISH_FAILED",
      `Publish to ${p.platform} failed`,
      502,
      {
        metadata: { cause: err.message },
      },
    );
  }
}
/**
 * (Re)schedule a post to a date — also used to put a detached draft back on
 * the calendar. Sets status 'scheduled' + scheduled_for. Published/publishing
 * posts can't be rescheduled.
 */
async function reschedule({ brand, user, request_id, id, scheduled_for }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  if (p.status === "published" || p.status === "publishing")
    throw new AppError(
      "ALREADY_PUBLISHED",
      "A published post can't be rescheduled",
      409,
    );
  const updated = await repo.setPostStatus({
    brand,
    id,
    status: "scheduled",
    fields: { scheduled_for: new Date(scheduled_for).toISOString() },
  });
  await A(
    brand,
    user,
    "social.post.reschedule",
    "social_post",
    id,
    { scheduled_for },
    request_id,
  );
  events.emit("post.updated", { brand, post_id: id });
  return updated;
}

async function recordMetrics({ brand, id, metric_date, metrics }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  return repo.upsertMetrics({
    brand,
    post_id: id,
    metric_date: metric_date || new Date().toISOString().slice(0, 10),
    m: metrics || {},
  });
}

/** Pull live metrics from the platform for a published post and upsert them. */
async function refreshMetrics({ brand, id }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  if (!p.external_post_id)
    throw new AppError(
      "NOT_PUBLISHED",
      "Post has no external id to pull metrics for",
      409,
    );
  const m = await publisher.fetchMetrics(p.platform, p.external_post_id);
  if (!m) return null;
  return repo.upsertMetrics({
    brand,
    post_id: id,
    metric_date: new Date().toISOString().slice(0, 10),
    m,
  });
}

/**
 * §6.1 connection — bridge an inbound social DM into the customer's Smartcomm
 * thread (linked to their contact). Requires a known contact_id.
 */
async function ingestInboundDM({ brand, user, request_id, input }) {
  if (!input.contact_id)
    throw new AppError(
      "CONTACT_REQUIRED",
      "A contact_id is required to link the DM to a profile",
      422,
    );
  const result = await smartcomm.recordInboundFromCustomer({
    brand,
    contact_id: input.contact_id,
    platform: input.platform || "instagram",
    body: input.body,
    external_ref: input.external_ref,
  });
  await A(
    brand,
    user,
    "social.dm.ingest",
    "message",
    result.message.message_id,
    { contact_id: input.contact_id },
    request_id,
  );
  return result;
}

module.exports = {
  listAccounts,
  connectAccount,
  revokeAccount,
  listPosts,
  getPost,
  createPost,
  publishPost,
  reschedule,
  recordMetrics,
  refreshMetrics,
  ingestInboundDM,
};
