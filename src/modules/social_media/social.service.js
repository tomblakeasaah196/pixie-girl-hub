/**
 * Social Studio (V2.2 §6.14) — business logic.
 *
 * Manual-first, proof-of-publish: a creator plans a whole month of posts as
 * one "content plan", submits it as a single approval to the CEO (workflow
 * engine), then posts natively from their own device and proves it here with
 * a link (verified server-side via oEmbed — no OAuth) + a screenshot. A
 * missed deadline nudges the creator, then escalates straight to the CEO —
 * flat, two-tier, no team-lead stage.
 *
 * Also carries the §6.1 integration: an inbound DM bridged into the
 * customer's Smartcomm thread — unrelated to the rework above, unchanged.
 */

"use strict";

const crypto = require("crypto");
const repo = require("./social.repo");
const platformsRepo = require("../social_platforms/social-platforms.repo");
const events = require("./social.events");
const smartcomm = require("../smartcomm/smartcomm.service");
const proof = require("../../services/social-proof.service");
const storage = require("../../services/storage.service");
const { compressUpload } = require("../../services/media-compression.service");
const wf = require("../../workflows/engine");
const scoring = require("./social.scoring");
const deadlines = require("./social.deadlines");
const notifications = require("../../services/notifications.service");
const { audit } = require("../../middleware/audit");
const { transaction, query } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

const PLAN_REFERENCE_TABLE = "social_content_plans";
const EDITABLE_POST_STATUSES = new Set(["draft", "assigned", "scheduled"]);
const PROOFABLE_STATUSES = new Set(["scheduled", "assigned", "flagged"]);

// Best-effort per-post engagement extraction from an Apify post-scrape item.
// Each actor names its fields differently, so we probe a list of aliases per
// metric (mirrors social-scraper's profile approach). Missing keys stay unset.
const POST_METRIC_ALIASES = {
  likes: [
    "likes", "likesCount", "likeCount", "diggCount", "favoriteCount",
    "reactionsCount", "reactions", "likes_count",
  ],
  comments: ["comments", "commentsCount", "commentCount", "replyCount", "comments_count"],
  shares: ["shares", "sharesCount", "shareCount", "reshareCount", "repostCount"],
  saves: ["saves", "savesCount", "saveCount", "collectCount", "bookmarks", "bookmarkCount"],
  video_views: ["videoViews", "viewsCount", "viewCount", "playCount", "views", "video_view_count"],
  reach: ["reach", "reachCount"],
  impressions: ["impressions", "impressionsCount"],
};

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

// ── Accounts (handle registry) ──────────────────────────────
function listAccounts({ brand }) {
  return repo.listAccounts({ brand });
}
/** Active staff on this brand — the "assign to" picker's data source. */
function listAssignableStaff({ brand }) {
  return repo.listAssignableStaff({ brand });
}
async function connectAccount({ brand, user, request_id, input }) {
  const platform = await platformsRepo.get({ key: input.platform });
  if (!platform || !platform.is_active) {
    throw new AppError(
      "UNKNOWN_PLATFORM",
      `"${input.platform}" isn't a registered platform yet — add it under Social Studio → Accounts → Add platform.`,
      422,
    );
  }
  const account = await repo.createAccount({
    brand,
    account: input,
    connected_by: user.user_id,
  });
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

/** Manually trigger a single account's Apify scrape right now — the
 *  dashboard's "Sync now" action. Shares its scrape logic with the
 *  twice-daily cron sweep (jobs/schedulers/social-metrics-sync.js) via
 *  social-scraper.service, so both paths behave identically. */
async function syncAccount({ brand, user, request_id, id }) {
  const account = await repo.getAccount({ brand, id });
  if (!account) throw new NotFoundError("Social account");

  const apifySettings = require("../apify_settings/apify-settings.service");
  const scraper = require("../../services/social-scraper.service");
  const apiKey = await apifySettings.resolveActiveApiKey();
  if (!apiKey) {
    throw new AppError(
      "APIFY_NOT_CONFIGURED",
      "Apify isn't configured yet — add an API key under Configure Apify.",
      412,
    );
  }
  const platform = await platformsRepo.get({ key: account.platform });
  const result = await scraper.scrapeAccount({ account, platform, apiKey });
  await repo.recordScrapeResult({ account_id: id, result });
  await A(
    brand,
    user,
    "social.account.sync",
    "social_account",
    id,
    { ok: result.ok, error: result.ok ? undefined : result.error },
    request_id,
  );
  return repo.getAccount({ brand, id });
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

// ── Content plans (monthly batch, submitted + approved as ONE entity) ──
async function createPlan({
  brand,
  user,
  request_id,
  period_start,
  period_end,
}) {
  const plan = await repo.createPlan({
    brand,
    created_by: user.user_id,
    period_start,
    period_end,
  });
  await A(
    brand,
    user,
    "social.plan.create",
    "social_content_plan",
    plan.plan_id,
    { period_start, period_end },
    request_id,
  );
  events.emit("plan.created", { brand, plan_id: plan.plan_id });
  return plan;
}
function listPlans({ brand, status }) {
  return repo.listPlans({ brand, status });
}
async function getPlan({ brand, id }) {
  const plan = await repo.getPlan({ brand, id });
  if (!plan) throw new NotFoundError("Content plan");
  plan.posts = (
    await repo.listPosts({ brand, plan_id: id, page_size: 500 })
  ).data;
  return plan;
}

/** Grid bulk-plan: add many draft rows to a plan in one round trip — the
 *  fast path for planning 10+ posts in one sitting instead of opening a
 *  composer per post. Only while the plan is still editable. */
async function addPostsToPlan({ brand, user, request_id, plan_id, rows }) {
  const plan = await repo.getPlan({ brand, id: plan_id });
  if (!plan) throw new NotFoundError("Content plan");
  if (!["draft", "changes_requested"].includes(plan.status))
    throw new AppError(
      "PLAN_LOCKED",
      `Cannot edit a '${plan.status}' plan`,
      409,
    );
  if (!Array.isArray(rows) || !rows.length)
    throw new AppError("NO_ROWS", "At least one post row is required", 422);

  // Resolve each distinct platform's account once, not per row — only for
  // platforms where at least one row didn't already specify an account_id.
  const accountByPlatform = new Map();
  const platformsNeedingResolve = new Set(
    rows.filter((r) => !r.account_id).map((r) => r.platform),
  );
  for (const platform of platformsNeedingResolve) {
    accountByPlatform.set(
      platform,
      await resolveAccountId({ brand, platform, account_id: null }),
    );
  }
  const resolvedRows = rows.map((r) => ({
    ...r,
    account_id: r.account_id || accountByPlatform.get(r.platform),
    status: "draft",
  }));

  const created = await repo.bulkCreatePosts({
    brand,
    created_by: user.user_id,
    plan_id,
    rows: resolvedRows,
  });
  await repo.refreshPlanPostCount({ brand, id: plan_id });
  await A(
    brand,
    user,
    "social.plan.add_posts",
    "social_content_plan",
    plan_id,
    { added: created.length },
    request_id,
  );
  events.emit("plan.posts_added", { brand, plan_id, count: created.length });
  return created;
}

async function submitPlan({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const plan = await repo.getPlan({ client, brand, id });
    if (!plan) throw new NotFoundError("Content plan");
    if (!["draft", "changes_requested"].includes(plan.status))
      throw new AppError(
        "INVALID_STATE",
        `Cannot submit a '${plan.status}' plan`,
        409,
      );
    const refreshed = await repo.refreshPlanPostCount({ client, brand, id });
    if (!refreshed.post_count)
      throw new AppError(
        "EMPTY_PLAN",
        "Add at least one post before submitting",
        422,
      );

    const instance = await wf.openInstance({
      client,
      business: brand,
      trigger_module: "social",
      trigger_action: "submit_plan",
      reference_table: PLAN_REFERENCE_TABLE,
      reference_id: id,
      opened_by: user.user_id,
      context: {
        post_count: refreshed.post_count,
        period_start: plan.period_start,
        period_end: plan.period_end,
      },
    });
    const updated = await repo.setPlanStatus({
      client,
      brand,
      id,
      status: "pending_approval",
      fields: {
        submitted_by: user.user_id,
        submitted_at: new Date().toISOString(),
        workflow_instance_id: instance.instance_id,
      },
    });
    await A(
      brand,
      user,
      "social.plan.submit",
      "social_content_plan",
      id,
      { workflow_instance_id: instance.instance_id },
      request_id,
    );
    events.emit("plan.submitted", { brand, plan_id: id });
    return updated;
  });
}

async function approvePlan({ brand, user, request_id, id, notes }) {
  return transaction(async (client) => {
    const plan = await repo.getPlan({ client, brand, id });
    if (!plan) throw new NotFoundError("Content plan");
    if (plan.status !== "pending_approval")
      throw new AppError(
        "INVALID_STATE",
        `Cannot approve a '${plan.status}' plan`,
        409,
      );

    const instance = await wf.findOpenInstance({
      client,
      business: brand,
      reference_table: PLAN_REFERENCE_TABLE,
      reference_id: id,
    });
    if (instance)
      await wf.act({
        client,
        instance_id: instance.instance_id,
        user,
        action: "approve",
        notes,
      });

    // The whole batch clears at once: every draft post in the plan is now
    // authorised to execute on its scheduled day.
    await client.query(
      `UPDATE shared.social_posts SET status = 'scheduled', updated_at = now()
        WHERE plan_id = $1 AND business = $2 AND status = 'draft'`,
      [id, brand],
    );
    const updated = await repo.setPlanStatus({
      client,
      brand,
      id,
      status: "approved",
      fields: {
        decided_by: user.user_id,
        decided_at: new Date().toISOString(),
        decision_notes: notes || null,
      },
    });
    await A(
      brand,
      user,
      "social.plan.approve",
      "social_content_plan",
      id,
      null,
      request_id,
    );
    events.emit("plan.approved", { brand, plan_id: id });
    return updated;
  });
}

async function requestPlanChanges({ brand, user, request_id, id, notes }) {
  return transaction(async (client) => {
    const plan = await repo.getPlan({ client, brand, id });
    if (!plan) throw new NotFoundError("Content plan");
    if (plan.status !== "pending_approval")
      throw new AppError(
        "INVALID_STATE",
        `Cannot request changes on a '${plan.status}' plan`,
        409,
      );
    const instance = await wf.findOpenInstance({
      client,
      business: brand,
      reference_table: PLAN_REFERENCE_TABLE,
      reference_id: id,
    });
    if (instance)
      await wf.act({
        client,
        instance_id: instance.instance_id,
        user,
        action: "request_changes",
        notes,
      });
    const updated = await repo.setPlanStatus({
      client,
      brand,
      id,
      status: "changes_requested",
      fields: {
        decided_by: user.user_id,
        decided_at: new Date().toISOString(),
        decision_notes: notes || null,
      },
    });
    await A(
      brand,
      user,
      "social.plan.request_changes",
      "social_content_plan",
      id,
      { notes },
      request_id,
    );
    events.emit("plan.changes_requested", { brand, plan_id: id });
    return updated;
  });
}

// ── Posts ──────────────────────────────────────────────────
function inferStatus(input) {
  if (input.status) return input.status;
  if (input.assigned_to) return "assigned";
  if (input.scheduled_for) return "scheduled";
  return "draft";
}
/** A post always posts from a concrete registered account. An explicit
 *  account_id wins; otherwise fall back to the platform's one connected
 *  account (the common case — most brands run a single handle per platform). */
async function resolveAccountId({ brand, platform, account_id }) {
  if (account_id) return account_id;
  const accounts = await repo.listActiveAccounts({ brand, platform });
  if (accounts.length === 1) return accounts[0].account_id;
  if (accounts.length === 0)
    throw new AppError(
      "ACCOUNT_REQUIRED",
      `Connect a ${platform} account before planning a post for it`,
      422,
    );
  throw new AppError(
    "ACCOUNT_AMBIGUOUS",
    `More than one ${platform} account is connected — specify account_id`,
    422,
  );
}
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
  const status = inferStatus(input);
  const account_id = await resolveAccountId({
    brand,
    platform: input.platform,
    account_id: input.account_id,
  });
  const post = await repo.createPost({
    brand,
    created_by: user.user_id,
    post: { ...input, account_id, status },
  });
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
async function updatePost({ brand, user, request_id, id, input }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  if (!EDITABLE_POST_STATUSES.has(p.status))
    throw new AppError(
      "NOT_EDITABLE",
      `A '${p.status}' post can't be edited`,
      409,
    );
  const updated = await repo.updatePost({ brand, id, fields: input });
  await A(
    brand,
    user,
    "social.post.update",
    "social_post",
    id,
    null,
    request_id,
  );
  events.emit("post.updated", { brand, post_id: id });
  return updated;
}
/** (Re)schedule a post to a date — also used to put a detached draft, an
 *  unclaimed assignment, or a flagged (missed) post back on the calendar. */
async function reschedule({ brand, user, request_id, id, scheduled_for }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  if (p.status === "posted")
    throw new AppError(
      "ALREADY_POSTED",
      "A posted post can't be rescheduled",
      409,
    );
  const updated = await repo.setPostStatus({
    brand,
    id,
    status: "scheduled",
    fields: {
      scheduled_for: new Date(scheduled_for).toISOString(),
      flag_reason: null,
    },
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

/**
 * Proof of publish: paste the live link + upload a screenshot. Server-side
 * we fetch oEmbed (best-effort — never blocks the submission) for the live
 * embed card and a soft handle check, store the screenshot, and compute the
 * timeliness half of the Post Grade (the engagement half fills in once
 * metrics are recorded).
 */
async function submitProof({
  brand,
  user,
  request_id,
  id,
  external_url,
  screenshot,
}) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  if (!PROOFABLE_STATUSES.has(p.status))
    throw new AppError(
      "INVALID_STATE",
      `Cannot submit proof for a '${p.status}' post`,
      409,
    );
  if (!external_url)
    throw new AppError("LINK_REQUIRED", "Paste the link to the live post", 422);
  if (!screenshot || !screenshot.buffer || !screenshot.buffer.length)
    throw new AppError(
      "SCREENSHOT_REQUIRED",
      "A screenshot of the live post is required as proof",
      422,
    );

  const shrunk = await compressUpload(screenshot);
  if (!/^image\//.test(shrunk.mime_type || ""))
    throw new AppError("BAD_FILE_TYPE", "Only image files are allowed", 400);
  const ext =
    String(shrunk.filename || "")
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 5) || "jpg";
  const key = `social/${brand}/${id}/${crypto.randomBytes(12).toString("hex")}.${ext}`;
  const stored = await storage.put(shrunk.buffer, {
    key,
    contentType: shrunk.mime_type,
  });

  const embed = await proof.fetchOEmbed(external_url);
  let handle_mismatch = false;
  if (embed.ok && embed.author_handle) {
    const accounts = await repo.listActiveAccounts({
      brand,
      platform: p.platform,
    });
    handle_mismatch = !proof.matchesRegisteredHandle(
      embed.author_handle,
      accounts,
    );
  }

  const published_at = new Date().toISOString();
  const performance_score = scoring.computePerformanceScore({
    status: "posted",
    scheduledFor: p.scheduled_for,
    postedAt: published_at,
    metrics: null,
  });

  const updated = await repo.setPostStatus({
    brand,
    id,
    status: "posted",
    fields: {
      published_at,
      external_url,
      proof_screenshot_url: stored.public_url,
      oembed_html: embed.embed_html,
      oembed_thumbnail_url: embed.thumbnail_url,
      oembed_author_handle: embed.author_handle,
      oembed_verified_at: embed.ok ? published_at : null,
      handle_mismatch,
      performance_score,
      performance_computed_at: performance_score === null ? null : published_at,
      flag_reason: null,
    },
  });
  await A(
    brand,
    user,
    "social.post.proof",
    "social_post",
    id,
    { handle_mismatch },
    request_id,
  );
  events.emit("post.posted", { brand, post_id: id, handle_mismatch });
  return updated;
}

/** Fallback platform detection for non-canonical registered platforms: does
 *  the pasted link's host belong to any registered account's profile_url?
 *  This is what lets a platform added from the UI (Pinterest, X, …) work in
 *  the quick-log without a code change. Never throws — null on no match. */
async function matchPlatformByAccountHost({ brand, url }) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
  const accounts = await repo.listAccounts({ brand });
  for (const a of accounts) {
    if (a.is_active === false || !a.profile_url) continue;
    try {
      const accountHost = new URL(a.profile_url).hostname
        .replace(/^www\./i, "")
        .toLowerCase();
      if (host === accountHost || host.endsWith(`.${accountHost}`)) {
        return a.platform;
      }
    } catch {
      /* malformed stored profile_url — skip */
    }
  }
  return null;
}

/**
 * Quick-log (simplified Social Studio): the calendar's one and only write.
 * Paste the link to something already posted natively; we detect the platform
 * from the URL (canonical hosts first, then any registered account's host),
 * resolve the brand's account for it, and store it as a proven `posted` row —
 * oEmbed enriched (best-effort), no content, no screenshot, no plan/approval.
 * The whole friction stack the old Board carried is gone.
 */
async function quickLog({ brand, user, request_id, input }) {
  const platform =
    input.platform ||
    proof.detectPlatform(input.external_url) ||
    (await matchPlatformByAccountHost({ brand, url: input.external_url }));
  if (!platform) {
    throw new AppError(
      "UNSUPPORTED_LINK",
      "That link doesn't match any registered platform — add the account's handle under Social Studio → Account first.",
      422,
    );
  }
  const account_id = await resolveAccountId({
    brand,
    platform,
    account_id: input.account_id,
  });
  const published_at = input.published_at
    ? new Date(input.published_at).toISOString()
    : new Date().toISOString();

  // Create the row first (post_type is a NOT NULL legacy column; content is
  // wiped from the product, so it carries a harmless placeholder), then finalise
  // it as posted with the oEmbed enrichment.
  const created = await repo.createPost({
    brand,
    created_by: user.user_id,
    post: { account_id, platform, post_type: "image", status: "posted" },
  });

  const embed = await proof.fetchOEmbed(input.external_url);
  let handle_mismatch = false;
  if (embed.ok && embed.author_handle) {
    const accounts = await repo.listActiveAccounts({ brand, platform });
    handle_mismatch = !proof.matchesRegisteredHandle(embed.author_handle, accounts);
  }
  const performance_score = scoring.computePerformanceScore({
    status: "posted",
    scheduledFor: null,
    postedAt: published_at,
    metrics: null,
  });

  const updated = await repo.setPostStatus({
    brand,
    id: created.post_id,
    status: "posted",
    fields: {
      published_at,
      external_url: input.external_url,
      oembed_html: embed.embed_html,
      oembed_thumbnail_url: embed.thumbnail_url,
      oembed_author_handle: embed.author_handle,
      oembed_verified_at: embed.ok ? new Date().toISOString() : null,
      handle_mismatch,
      performance_score,
      performance_computed_at: performance_score === null ? null : published_at,
      flag_reason: null,
    },
  });
  await A(
    brand,
    user,
    "social.post.quick_log",
    "social_post",
    created.post_id,
    { platform, handle_mismatch },
    request_id,
  );
  events.emit("post.posted", { brand, post_id: created.post_id, handle_mismatch });
  return updated;
}

/** Remove a logged link — the undo for a wrong paste. */
async function deletePost({ brand, user, request_id, id }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  await repo.deletePost({ brand, id });
  await A(brand, user, "social.post.delete", "social_post", id, null, request_id);
  events.emit("post.updated", { brand, post_id: id });
  return { deleted: true };
}

/**
 * Best-effort per-post reactions scrape — reuses the existing Apify infra on
 * demand (the "refresh reactions" button). Never throws: if there's no API key,
 * no actor for the platform, or the actor returns nothing useful, it's a soft
 * no-op and the caller just keeps whatever numbers it already had.
 */
async function scrapePostReactions({ post }) {
  if (!post.external_url) return null;
  const apifySettings = require("../apify_settings/apify-settings.service");
  const scraper = require("../../services/social-scraper.service");
  const apify = require("../../services/apify.service");
  const apiKey = await apifySettings.resolveActiveApiKey();
  if (!apiKey) return null;
  const platform = await platformsRepo.get({ key: post.platform });
  if (!platform || !platform.apify_actor_id) return null;
  const input = apify.buildActorInput(platform.apify_input_template, {
    handle: post.external_url,
    profile_url: post.external_url,
  });
  const items = await apify.runActorSync({
    apiKey,
    actorId: platform.apify_actor_id,
    input,
  });
  const item = items[0];
  if (!item) return null;
  const m = {};
  for (const [key, aliases] of Object.entries(POST_METRIC_ALIASES)) {
    const raw = scraper.pluck(item, aliases);
    const n = Number(raw);
    if (Number.isFinite(n)) m[key] = Math.round(n);
  }
  return Object.keys(m).length ? m : null;
}

/**
 * Refresh a logged post's embed card and (best-effort) its reactions. Freshens
 * the oEmbed thumbnail/author, attempts an on-demand reactions scrape, and
 * recomputes the performance score from whatever engagement it finds. Returns
 * the post with its metrics attached (like getPost).
 */
async function refreshReactions({ brand, user, request_id, id }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");

  const fields = {};
  if (p.external_url) {
    try {
      const embed = await proof.fetchOEmbed(p.external_url);
      if (embed.ok) {
        fields.oembed_html = embed.embed_html;
        fields.oembed_thumbnail_url = embed.thumbnail_url;
        fields.oembed_author_handle = embed.author_handle || p.oembed_author_handle;
        fields.oembed_verified_at = new Date().toISOString();
      }
    } catch {
      /* embed refresh is best-effort */
    }
  }
  if (Object.keys(fields).length) await repo.updatePost({ brand, id, fields });

  let scraped = null;
  try {
    scraped = await scrapePostReactions({ post: p });
  } catch {
    /* reactions scrape is best-effort */
  }
  if (scraped) {
    await repo.upsertMetrics({
      post_id: id,
      metric_date: new Date().toISOString().slice(0, 10),
      m: scraped,
    });
    const latest = await repo.latestMetrics({ post_id: id });
    const performance_score = scoring.computePerformanceScore({
      status: "posted",
      scheduledFor: p.scheduled_for,
      postedAt: p.published_at,
      metrics: latest,
    });
    await repo.setPostStatus({
      brand,
      id,
      status: "posted",
      fields: {
        performance_score,
        performance_computed_at: new Date().toISOString(),
      },
    });
  }
  await A(
    brand,
    user,
    "social.post.refresh_reactions",
    "social_post",
    id,
    { scraped: Boolean(scraped) },
    request_id,
  );
  return getPost({ brand, id });
}

/** Manager's subjective creative-quality star rating — kept separate from
 *  performance_score, never blended into one number (Post Grade shows both). */
async function rateCreative({ brand, user, request_id, id, rating }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  const updated = await repo.setPostStatus({
    brand,
    id,
    status: p.status,
    fields: {
      creative_rating: rating,
      creative_rated_by: user.user_id,
      creative_rated_at: new Date().toISOString(),
    },
  });
  await A(
    brand,
    user,
    "social.post.rate",
    "social_post",
    id,
    { rating },
    request_id,
  );
  events.emit("post.rated", { brand, post_id: id });
  return updated;
}

async function recordMetrics({ brand, id, metric_date, metrics }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  const saved = await repo.upsertMetrics({
    post_id: id,
    metric_date: metric_date || new Date().toISOString().slice(0, 10),
    m: metrics || {},
  });
  if (p.status === "posted") {
    const latest = await repo.latestMetrics({ post_id: id });
    const performance_score = scoring.computePerformanceScore({
      status: "posted",
      scheduledFor: p.scheduled_for,
      postedAt: p.published_at,
      metrics: latest,
    });
    await repo.setPostStatus({
      brand,
      id,
      status: "posted",
      fields: {
        performance_score,
        performance_computed_at: new Date().toISOString(),
      },
    });
  }
  return saved;
}

/** Silence a deadline nudge for a while without submitting proof yet — the
 *  one quick-action button on the push notification itself. */
async function snoozePost({ brand, id }) {
  const p = await repo.getPost({ brand, id });
  if (!p) throw new NotFoundError("Post");
  await repo.recordNudge({ id });
  return { snoozed: true };
}

// ── Targets ────────────────────────────────────────────────
async function setTarget({
  brand,
  user,
  request_id,
  platform,
  user_id,
  period_month,
  target_count,
}) {
  const target = await repo.upsertTarget({
    brand,
    platform,
    user_id: user_id || null,
    period_month,
    target_count,
    set_by: user.user_id,
  });
  await A(
    brand,
    user,
    "social.target.set",
    "social_target",
    target.target_id,
    { platform, user_id, period_month, target_count },
    request_id,
  );
  events.emit("target.set", { brand, target_id: target.target_id });
  return target;
}
function listTargets({ brand, period_month }) {
  return repo.listTargets({ brand, period_month });
}

// ── Performance / Team ───────────────────────────────────────
function attainmentPct(posted, target) {
  if (!target) return null;
  return Math.round((posted / target) * 1000) / 10;
}
function onTimePct(row) {
  return row.posted_count
    ? Math.round((row.on_time_count / row.posted_count) * 1000) / 10
    : null;
}

async function getPerformance({ brand, period_month }) {
  const [summary, targets] = await Promise.all([
    repo.performanceSummary({ brand, period_month }),
    repo.listTargets({ brand, period_month }),
  ]);
  const teamTargetByPlatform = new Map(
    targets.filter((t) => !t.user_id).map((t) => [t.platform, t.target_count]),
  );
  return summary.map((row) => {
    const target = teamTargetByPlatform.get(row.platform) || null;
    return {
      ...row,
      target_count: target,
      attainment_pct: attainmentPct(row.posted_count, target),
      on_time_pct: onTimePct(row),
    };
  });
}

async function getTeam({ brand, period_month }) {
  const [summary, targets] = await Promise.all([
    repo.teamSummary({ brand, period_month }),
    repo.listTargets({ brand, period_month }),
  ]);
  const targetByUserPlatform = new Map(
    targets
      .filter((t) => t.user_id)
      .map((t) => [`${t.user_id}:${t.platform}`, t.target_count]),
  );
  const teamTargetByPlatform = new Map(
    targets.filter((t) => !t.user_id).map((t) => [t.platform, t.target_count]),
  );
  return summary.map((row) => {
    const target =
      targetByUserPlatform.get(`${row.user_id}:${row.platform}`) ??
      teamTargetByPlatform.get(row.platform) ??
      null;
    return {
      ...row,
      target_count: target,
      attainment_pct: attainmentPct(row.posted_count, target),
      on_time_pct: onTimePct(row),
    };
  });
}

function getCreatorDrilldown({ brand, user_id, period_month }) {
  return repo.creatorDrilldown({ brand, user_id, period_month });
}

// ── Deadline sweep (called by the hourly scheduler adapter) ─────────
async function findCeo() {
  const { rows } = await query(
    `SELECT user_id FROM shared.users WHERE is_ceo = true ORDER BY created_at LIMIT 1`,
  );
  return rows[0] || null;
}

/** One brand's pass of the hourly deadline sweep: nudge creators whose posts
 *  are overdue, escalate straight to the CEO once a miss goes unresolved past
 *  the escalation window. Flat, two-tier — no team-lead stage. */
async function runDeadlineSweep({ brand }) {
  const now = new Date();
  const quiet = deadlines.isQuietHour(now);
  const due = await repo.findDuePosts({
    brand,
    graceMinutes: deadlines.GRACE_MINUTES,
  });

  let nudged = 0;
  let escalated = 0;
  for (const post of due) {
    const action = deadlines.decideSweepAction({
      now,
      scheduledFor: post.scheduled_for,
      lastNudgedAt: post.last_nudged_at,
    });
    if (action === "wait") continue;

    if (action === "escalate") {
      const hoursLate = Math.floor(
        (now.getTime() - new Date(post.scheduled_for).getTime()) / 3_600_000,
      );
      await repo.flagOverdue({
        id: post.post_id,
        reason: `No proof submitted ${hoursLate}h after the deadline`,
      });
      events.emit("post.flagged", { brand, post_id: post.post_id });
      escalated += 1;
      if (quiet) continue;
      const ceo = await findCeo();
      if (ceo) {
        await notifications.notify({
          user_id: ceo.user_id,
          business: brand,
          type: "social_deadline_escalation",
          title: "Social Studio — missed deadline",
          body: `A ${post.platform} post scheduled for ${new Date(post.scheduled_for).toLocaleString()} still has no proof of posting.`,
          priority: "urgent",
          reference_type: "social_post",
          reference_id: post.post_id,
          action_url: `/social?tab=calendar&post=${post.post_id}`,
          email: true,
        });
      }
      continue;
    }

    // action === "nudge"
    if (quiet) continue;
    const recipient = post.assigned_to || post.created_by;
    await notifications.notify({
      user_id: recipient,
      business: brand,
      type: "social_deadline_nudge",
      title: "Post it, then prove it",
      body: `Your ${post.platform} post was due ${new Date(post.scheduled_for).toLocaleString()} — paste the link once it's live.`,
      priority: "high",
      reference_type: "social_post",
      reference_id: post.post_id,
      action_url: `/social?tab=board&post=${post.post_id}`,
      actions: [
        {
          label: "Snooze 2h",
          value: "snooze",
          endpoint: `/social/posts/${post.post_id}/snooze`,
        },
      ],
    });
    await repo.recordNudge({ id: post.post_id });
    nudged += 1;
  }
  return { checked: due.length, nudged, escalated };
}

/**
 * §6.1 connection — bridge an inbound social DM into the customer's Smartcomm
 * thread (linked to their contact). Requires a known contact_id. Unrelated to
 * the proof-of-publish rework above.
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
  listAssignableStaff,
  connectAccount,
  revokeAccount,
  syncAccount,
  createPlan,
  listPlans,
  getPlan,
  addPostsToPlan,
  submitPlan,
  approvePlan,
  requestPlanChanges,
  listPosts,
  getPost,
  createPost,
  quickLog,
  deletePost,
  refreshReactions,
  updatePost,
  reschedule,
  submitProof,
  rateCreative,
  recordMetrics,
  snoozePost,
  setTarget,
  listTargets,
  getPerformance,
  getTeam,
  getCreatorDrilldown,
  runDeadlineSweep,
  ingestInboundDM,
};
