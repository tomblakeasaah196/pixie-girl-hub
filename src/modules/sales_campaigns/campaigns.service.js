/**
 * Sales Campaigns & Landing Pages (V2.2 §6.22)
 * Business logic: CRUD, the three-phase state machine, approval routing
 * (via the workflow engine), products, landing config, share kit, metrics.
 *
 * State machine (status):
 *   draft → pending_approval → scheduled → live ⇄ paused → ended → archived
 *   (reject: pending_approval → draft)
 */

"use strict";

const repo = require("./campaigns.repo");
const events = require("./campaigns.events");
const wf = require("../../workflows/engine");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { config } = require("../../config/env");
const {
  NotFoundError,
  AppError,
  ConflictError,
} = require("../../utils/errors");

const REFERENCE_TABLE = "sales_campaigns";

function assertStatus(campaign, allowed, action) {
  if (!allowed.includes(campaign.status)) {
    throw new AppError(
      "INVALID_STATE",
      `Cannot ${action} a campaign in '${campaign.status}' state`,
      409,
    );
  }
}

/** Pure resolver of the public landing phase. */
function resolveState(campaign, now = new Date()) {
  if (campaign.status === "ended" || campaign.status === "archived")
    return "ended";
  const starts = new Date(campaign.starts_at);
  const ends = new Date(campaign.ends_at);
  if (now < starts) return "before";
  if (now >= starts && now < ends && campaign.status === "live") return "live";
  if (now >= ends) return "ended";
  return "before";
}

// ── Reads ────────────────────────────────────────────────

async function list({ brand, user, scope, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.findAll({
    brand,
    scope,
    user_id: user.user_id,
    filters,
    page,
    page_size,
    offset,
  });
}

async function getById({ brand, scope, user, id }) {
  const campaign = await repo.findById({ brand, id });
  if (!campaign) throw new NotFoundError("Campaign");
  if (scope === "own" && campaign.created_by !== user.user_id) {
    throw new NotFoundError("Campaign");
  }
  const products = await repo.listProducts({ brand, campaign_id: id });
  return { ...campaign, products, public_state: resolveState(campaign) };
}

// ── Create / update / archive ────────────────────────────

async function create({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const existing = await repo.findBySlug({ client, brand, slug: input.slug });
    if (existing)
      throw new ConflictError(`Slug '${input.slug}' is already in use`);

    const created = await repo.create({
      client,
      brand,
      input,
      user_id: user.user_id,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.create",
      target_type: REFERENCE_TABLE,
      target_id: created.campaign_id,
      after: created,
      request_id,
    });
    events.emit("created", {
      brand,
      id: created.campaign_id,
      user_id: user.user_id,
    });
    return created;
  });
}

async function update({ brand, user, request_id, id, patch }) {
  return transaction(async (client) => {
    const before = await repo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("Campaign");
    assertStatus(
      before,
      ["draft", "pending_approval", "scheduled", "paused"],
      "edit",
    );

    if (patch.slug && patch.slug !== before.slug) {
      const clash = await repo.findBySlug({ client, brand, slug: patch.slug });
      if (clash)
        throw new ConflictError(`Slug '${patch.slug}' is already in use`);
    }

    const updated = await repo.update({ client, brand, id, patch });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.update",
      target_type: REFERENCE_TABLE,
      target_id: id,
      before,
      after: updated,
      request_id,
    });
    events.emit("updated", { brand, id, user_id: user.user_id });
    return updated;
  });
}

async function archive({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("Campaign");
    if (["live", "paused", "pending_approval"].includes(before.status)) {
      throw new AppError(
        "INVALID_STATE",
        "End or reject the campaign before archiving",
        409,
      );
    }
    const updated = await repo.setStatus({
      client,
      brand,
      id,
      status: "archived",
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.archive",
      target_type: REFERENCE_TABLE,
      target_id: id,
      before,
      request_id,
    });
    events.emit("archived", { brand, id, user_id: user.user_id });
    return updated;
  });
}

// ── State transitions ────────────────────────────────────

async function submit({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const campaign = await repo.findById({ client, brand, id });
    if (!campaign) throw new NotFoundError("Campaign");
    assertStatus(campaign, ["draft"], "submit");

    if (campaign.product_scope !== "all") {
      const products = await repo.listProducts({
        client,
        brand,
        campaign_id: id,
      });
      const hasInclude = products.some((p) => p.include_exclude === "include");
      if (!hasInclude) {
        throw new AppError(
          "CAMPAIGN_INCOMPLETE",
          "Add at least one included product/category before submitting",
          409,
        );
      }
    }

    const updated = await repo.setStatus({
      client,
      brand,
      id,
      status: "pending_approval",
    });
    const instance = await wf.openInstance({
      client,
      business: brand,
      trigger_module: "sales_campaigns",
      trigger_action: "submit",
      reference_table: REFERENCE_TABLE,
      reference_id: id,
      opened_by: user.user_id,
      context: {
        name: campaign.name,
        slug: campaign.slug,
        starts_at: campaign.starts_at,
        ends_at: campaign.ends_at,
      },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.submit",
      target_type: REFERENCE_TABLE,
      target_id: id,
      after: {
        status: "pending_approval",
        workflow_instance_id: instance.instance_id,
      },
      request_id,
    });
    events.emit("submitted", { brand, id, instance_id: instance.instance_id });
    return { ...updated, workflow_instance_id: instance.instance_id };
  });
}

async function approve({ brand, user, request_id, id, notes }) {
  return transaction(async (client) => {
    const campaign = await repo.findById({ client, brand, id });
    if (!campaign) throw new NotFoundError("Campaign");
    assertStatus(campaign, ["pending_approval"], "approve");

    const instance = await wf.findOpenInstance({
      client,
      business: brand,
      reference_table: REFERENCE_TABLE,
      reference_id: id,
    });
    if (!instance)
      throw new AppError("NO_PENDING_APPROVAL", "No open approval found", 409);

    const result = await wf.act({
      client,
      instance_id: instance.instance_id,
      user,
      action: "approve",
      notes,
    });

    let updated = campaign;
    if (result.status === "approved") {
      updated = await repo.setStatus({
        client,
        brand,
        id,
        status: "scheduled",
        approved_by: user.user_id,
      });
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.approve",
      target_type: REFERENCE_TABLE,
      target_id: id,
      before: { status: campaign.status },
      after: {
        workflow_status: result.status,
        campaign_status: updated.status,
      },
      request_id,
    });
    events.emit("approved", { brand, id, workflow_status: result.status });
    return updated;
  });
}

async function reject({ brand, user, request_id, id, notes }) {
  return transaction(async (client) => {
    const campaign = await repo.findById({ client, brand, id });
    if (!campaign) throw new NotFoundError("Campaign");
    assertStatus(campaign, ["pending_approval"], "reject");

    const instance = await wf.findOpenInstance({
      client,
      business: brand,
      reference_table: REFERENCE_TABLE,
      reference_id: id,
    });
    if (instance) {
      await wf.act({
        client,
        instance_id: instance.instance_id,
        user,
        action: "reject",
        notes,
      });
    }
    const updated = await repo.setStatus({
      client,
      brand,
      id,
      status: "draft",
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.reject",
      target_type: REFERENCE_TABLE,
      target_id: id,
      before: { status: campaign.status },
      after: { status: "draft", notes },
      request_id,
    });
    events.emit("rejected", { brand, id });
    return updated;
  });
}

async function transition({ brand, user, request_id, id, action }) {
  const MAP = {
    launch: {
      from: ["scheduled", "paused"],
      to: "live",
      requireApproved: true,
    },
    pause: { from: ["live"], to: "paused" },
    resume: { from: ["paused"], to: "live" },
    end: { from: ["live", "paused"], to: "ended" },
  };
  const rule = MAP[action];
  if (!rule)
    throw new AppError("INVALID_ACTION", `Unknown transition ${action}`, 400);

  return transaction(async (client) => {
    const campaign = await repo.findById({ client, brand, id });
    if (!campaign) throw new NotFoundError("Campaign");
    assertStatus(campaign, rule.from, action);
    if (rule.requireApproved && !campaign.approved_at) {
      throw new AppError(
        "NOT_APPROVED",
        "Campaign must be approved before launch",
        409,
      );
    }
    const updated = await repo.setStatus({
      client,
      brand,
      id,
      status: rule.to,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: `sales_campaigns.${action}`,
      target_type: REFERENCE_TABLE,
      target_id: id,
      before: { status: campaign.status },
      after: { status: rule.to },
      request_id,
    });
    events.emit(action, { brand, id, status: rule.to });
    return updated;
  });
}

async function duplicate({ brand, user, request_id, id, overrides = {} }) {
  return transaction(async (client) => {
    const src = await repo.findById({ client, brand, id });
    if (!src) throw new NotFoundError("Campaign");

    const newSlug =
      overrides.slug || `${src.slug}-copy-${Date.now().toString(36)}`;
    const clash = await repo.findBySlug({ client, brand, slug: newSlug });
    if (clash) throw new ConflictError(`Slug '${newSlug}' is already in use`);

    const input = {
      slug: newSlug,
      name: overrides.name || `${src.name} (copy)`,
      description: src.description,
      starts_at: src.starts_at,
      ends_at: src.ends_at,
      discount_type: src.discount_type,
      discount_value: src.discount_value,
      min_order_value_ngn: src.min_order_value_ngn,
      customer_segment_id: src.customer_segment_id,
      first_time_buyers_only: src.first_time_buyers_only,
      product_scope: src.product_scope,
      landing_hero_title: src.landing_hero_title,
      landing_hero_subtitle: src.landing_hero_subtitle,
      landing_hero_image_url: src.landing_hero_image_url,
      landing_cta_text: src.landing_cta_text,
      landing_blocks: src.landing_blocks,
      countdown_message: src.countdown_message,
      signup_for_notifications: src.signup_for_notifications,
      ended_message: src.ended_message,
      ended_redirect_to: src.ended_redirect_to,
      meta_title: src.meta_title,
      meta_description: src.meta_description,
      og_image_url: src.og_image_url,
      total_usage_limit: src.total_usage_limit,
    };
    const created = await repo.create({
      client,
      brand,
      input,
      user_id: user.user_id,
    });

    const products = await repo.listProducts({
      client,
      brand,
      campaign_id: id,
    });
    for (const p of products) {
      await repo.addProduct({
        client,
        brand,
        campaign_id: created.campaign_id,
        input: {
          product_id: p.product_id,
          category_id: p.category_id,
          include_exclude: p.include_exclude,
          campaign_price_ngn: p.campaign_price_ngn,
          display_order: p.display_order,
          is_featured: p.is_featured,
        },
      });
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.duplicate",
      target_type: REFERENCE_TABLE,
      target_id: created.campaign_id,
      after: { source: id },
      request_id,
    });
    events.emit("created", {
      brand,
      id: created.campaign_id,
      user_id: user.user_id,
    });
    return created;
  });
}

// ── Products ─────────────────────────────────────────────

async function listProducts({ brand, id }) {
  await ensureExists({ brand, id });
  return repo.listProducts({ brand, campaign_id: id });
}

async function addProduct({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const campaign = await repo.findById({ client, brand, id });
    if (!campaign) throw new NotFoundError("Campaign");
    assertStatus(
      campaign,
      ["draft", "pending_approval", "scheduled", "paused"],
      "edit products of",
    );
    const link = await repo.addProduct({
      client,
      brand,
      campaign_id: id,
      input,
    });
    events.emit("updated", { brand, id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.product.add",
      target_type: REFERENCE_TABLE,
      target_id: id,
      after: link,
      request_id,
    });
    return link;
  });
}

async function updateProduct({ brand, user, request_id, id, link_id, patch }) {
  const link = await repo.findProductLink({ brand, campaign_id: id, link_id });
  if (!link) throw new NotFoundError("Campaign product");
  const updated = await repo.updateProduct({
    brand,
    campaign_id: id,
    link_id,
    patch,
  });
  events.emit("updated", { brand, id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "sales_campaigns.product.update",
    target_type: REFERENCE_TABLE,
    target_id: id,
    after: updated,
    request_id,
  });
  return updated;
}

async function removeProduct({ brand, user, request_id, id, link_id }) {
  const ok = await repo.removeProduct({ brand, campaign_id: id, link_id });
  if (!ok) throw new NotFoundError("Campaign product");
  events.emit("updated", { brand, id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "sales_campaigns.product.remove",
    target_type: REFERENCE_TABLE,
    target_id: id,
    after: { link_id },
    request_id,
  });
}

// ── Landing config / preview / share kit ─────────────────

async function getLanding({ brand, id }) {
  const c = await repo.findById({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  return {
    landing_hero_title: c.landing_hero_title,
    landing_hero_subtitle: c.landing_hero_subtitle,
    landing_hero_image_url: c.landing_hero_image_url,
    landing_cta_text: c.landing_cta_text,
    landing_blocks: c.landing_blocks,
    countdown_message: c.countdown_message,
    ended_message: c.ended_message,
    ended_redirect_to: c.ended_redirect_to,
    meta_title: c.meta_title,
    meta_description: c.meta_description,
    og_image_url: c.og_image_url,
  };
}

async function updateLanding({ brand, user, request_id, id, patch }) {
  return update({ brand, user, request_id, id, patch });
}

async function preview({ brand, id, state }) {
  const c = await repo.findById({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  const products = await repo.listProducts({ brand, campaign_id: id });
  return buildLandingPayload(c, products, state || resolveState(c));
}

function buildLandingPayload(c, products, state) {
  return {
    slug: c.slug,
    name: c.name,
    state,
    hero: {
      title: c.landing_hero_title,
      subtitle: c.landing_hero_subtitle,
      image_url: c.landing_hero_image_url,
      cta_text: c.landing_cta_text,
    },
    countdown_to:
      state === "before" ? c.starts_at : state === "live" ? c.ends_at : null,
    countdown_message: c.countdown_message,
    signup_for_notifications: state === "before" && c.signup_for_notifications,
    blocks: c.landing_blocks || [],
    products:
      state === "live"
        ? products
            .filter((p) => p.include_exclude !== "exclude")
            .map((p) => ({
              product_id: p.product_id,
              category_id: p.category_id,
              name: p.product_name || p.category_name,
              campaign_price_ngn: p.campaign_price_ngn,
              is_featured: p.is_featured,
              stock_remaining: p.current_stock_snapshot,
            }))
        : [],
    ended:
      state === "ended"
        ? { message: c.ended_message, redirect_to: c.ended_redirect_to }
        : null,
    seo: {
      meta_title: c.meta_title,
      meta_description: c.meta_description,
      og_image_url: c.og_image_url,
    },
  };
}

function shareKit({ brand_config, campaign }) {
  const domain = brand_config && brand_config.storefront_domain;
  const base = domain ? `https://${domain}` : config.APP_URL;
  const url = `${base}/sale/${campaign.slug}`;
  const utm = (source, medium) =>
    `${url}?utm_source=${source}&utm_medium=${medium}&utm_campaign=${encodeURIComponent(campaign.slug)}`;
  return {
    base_url: url,
    links: {
      instagram: utm("instagram", "social"),
      whatsapp: utm("whatsapp", "messaging"),
      email: utm("email", "email"),
      facebook: utm("facebook", "social"),
      direct: url,
    },
    copy: {
      whatsapp: `🔥 ${campaign.name} is here! Shop now before it ends: ${utm("whatsapp", "messaging")}`,
      instagram: `${campaign.name} — limited time only. Tap the link in bio 👉 ${utm("instagram", "social")}`,
      email_subject: `${campaign.name} — don't miss out`,
      email_body: `Our ${campaign.name} is live. Shop the deals here: ${utm("email", "email")}`,
    },
  };
}

async function getShareKit({ brand, brand_config, id }) {
  const campaign = await repo.findById({ brand, id });
  if (!campaign) throw new NotFoundError("Campaign");
  return shareKit({ brand, brand_config, campaign });
}

// ── Signups & metrics ────────────────────────────────────

async function listSignups({ brand, id, page, page_size }) {
  await ensureExists({ brand, id });
  const offset = (page - 1) * page_size;
  return repo.listSignups({ brand, campaign_id: id, page, page_size, offset });
}

async function getMetrics({ brand, id }) {
  const c = await repo.findById({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  return {
    campaign_id: c.campaign_id,
    status: c.status,
    public_state: resolveState(c),
    rollups: {
      total_visitors: c.total_visitors,
      total_unique_visitors: c.total_unique_visitors,
      total_signups: c.total_signups,
      total_add_to_cart: c.total_add_to_cart,
      total_orders: c.total_orders,
      total_revenue_ngn: c.total_revenue_ngn,
      total_discount_given_ngn: c.total_discount_given_ngn,
      conversion_rate:
        c.total_unique_visitors > 0
          ? Number((c.total_orders / c.total_unique_visitors).toFixed(4))
          : 0,
      average_order_value_ngn:
        c.total_orders > 0
          ? Number((c.total_revenue_ngn / c.total_orders).toFixed(2))
          : 0,
    },
  };
}

async function listDailyMetrics({ brand, id, from, to }) {
  await ensureExists({ brand, id });
  return repo.listDailyMetrics({ brand, campaign_id: id, from, to });
}

async function getReport({ brand, id, format }) {
  await ensureExists({ brand, id });
  // Lazy require to avoid a module cycle (notifications requires this service).
  const notifications = require("./campaigns.notifications.service");
  if (format === "pdf") {
    return notifications.generatePostCampaignReport({ brand, campaign_id: id });
  }
  return notifications.buildReportData({ brand, campaign_id: id });
}

async function ensureExists({ brand, id }) {
  const c = await repo.findById({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  return c;
}

module.exports = {
  resolveState,
  buildLandingPayload,
  list,
  getById,
  create,
  update,
  archive,
  submit,
  approve,
  reject,
  transition,
  duplicate,
  listProducts,
  addProduct,
  updateProduct,
  removeProduct,
  getLanding,
  updateLanding,
  preview,
  getShareKit,
  listSignups,
  getMetrics,
  listDailyMetrics,
  getReport,
};
