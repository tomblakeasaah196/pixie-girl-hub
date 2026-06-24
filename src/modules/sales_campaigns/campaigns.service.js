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

const crypto = require("crypto");
const repo = require("./campaigns.repo");
const styledRepo = require("../catalogue/styled.repo");
const events = require("./campaigns.events");
const readiness = require("./campaigns.readiness.service");
const wf = require("../../workflows/engine");
const storage = require("../../services/storage.service");
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
      ["draft", "pending_approval", "scheduled", "live", "paused"],
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
    // Go-live readiness gate (launch/resume only). Auto-repairs document
    // sequences and blocks only on issues that would 500 buyer checkouts.
    // Runs solely on the transition, so an already-live campaign is never
    // re-checked — enabling this can't pull a running sale offline.
    if (rule.to === "live") {
      await readiness.assertReadyForLaunch({ brand, campaign, client });
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

/**
 * When a styled product is being added, enforce that product_id is always
 * the styled product's own base_product_id — never trust the caller to
 * supply this correctly. A mismatch causes the campaign stock LATERAL join
 * to sum from the wrong base product, making the product appear out of stock
 * on the landing page even when inventory exists.
 */
async function resolveStyledInput(client, brand, input) {
  if (!input.styled_id) return input;
  const styled = await styledRepo.getById({ client, brand, id: input.styled_id });
  if (!styled) throw new NotFoundError("Styled product");
  return { ...input, product_id: styled.base_product_id };
}

async function addProduct({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const campaign = await repo.findById({ client, brand, id });
    if (!campaign) throw new NotFoundError("Campaign");
    assertStatus(
      campaign,
      ["draft", "pending_approval", "scheduled", "live", "paused"],
      "edit products of",
    );
    const resolved = await resolveStyledInput(client, brand, input);
    const link = await repo.addProduct({
      client,
      brand,
      campaign_id: id,
      input: resolved,
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

/**
 * Batch-insert up to 200 product links in a single transaction.
 * Rows that collide with a unique constraint are silently skipped.
 */
async function addProductsBatch({ brand, user, request_id, id, items }) {
  return transaction(async (client) => {
    const campaign = await repo.findById({ client, brand, id });
    if (!campaign) throw new NotFoundError("Campaign");
    assertStatus(
      campaign,
      ["draft", "pending_approval", "scheduled", "live", "paused"],
      "edit products of",
    );
    const resolved = await Promise.all(
      items.map((item) => resolveStyledInput(client, brand, item)),
    );
    const created = await repo.addProductsBatch({
      client,
      brand,
      campaign_id: id,
      items: resolved,
    });
    events.emit("updated", { brand, id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.products.batch_add",
      target_type: REFERENCE_TABLE,
      target_id: id,
      after: { count: created.length },
      request_id,
    });
    return created;
  });
}

// ── Landing config / preview / share kit ─────────────────

async function getLanding({ brand, id }) {
  const c = await repo.findById({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  return {
    // Campaign identity — used by the studio header and preview model.
    id: c.campaign_id,
    name: c.name,
    slug: c.slug,
    starts_at: c.starts_at,
    ends_at: c.ends_at,
    // Landing fields.
    landing_hero_title: c.landing_hero_title,
    landing_hero_subtitle: c.landing_hero_subtitle,
    landing_hero_image_url: c.landing_hero_image_url,
    landing_cta_text: c.landing_cta_text,
    landing_blocks: c.landing_blocks || [],
    countdown_message: c.countdown_message,
    ended_message: c.ended_message,
    ended_redirect_to: c.ended_redirect_to,
    meta_title: c.meta_title,
    meta_description: c.meta_description,
    og_image_url: c.og_image_url,
    landing_extras: c.landing_extras || {},
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
  const extras = c.landing_extras || {};
  return {
    slug: c.slug,
    name: c.name,
    state,
    hero: {
      title: c.landing_hero_title,
      subtitle: c.landing_hero_subtitle,
      image_url: c.landing_hero_image_url,
      cta_text: c.landing_cta_text,
      // Extra campaign landing fields surfaced to Next.js components.
      live_now_pill: extras.live_now_pill || null,
      browse_cta_text: extras.browse_cta_text || null,
      overlay_opacity:
        extras.hero_overlay_opacity != null
          ? Number(extras.hero_overlay_opacity)
          : null,
      watermark_opacity:
        extras.watermark_opacity != null
          ? Number(extras.watermark_opacity)
          : null,
    },
    countdown_to:
      state === "before" ? c.starts_at : state === "live" ? c.ends_at : null,
    countdown_message:
      extras.countdown_closes_label || c.countdown_message || null,
    signup_for_notifications: state === "before" && c.signup_for_notifications,
    blocks: c.landing_blocks || [],
    // Customer-facing FX SSOT: the static "1 USD = N NGN" rate the campaign
    // owner sets in the builder. The landing currency toggle uses this so the
    // visitor sees a stable price for the whole drop. Order settlement uses
    // the LIVE rate captured into sales_orders.fx_rate_used at payment.
    ngn_per_usd_rate:
      c.ngn_per_usd_rate !== null && c.ngn_per_usd_rate !== undefined
        ? Number(c.ngn_per_usd_rate)
        : null,
    // Top-level discount — surfaced so the landing card can render a
    // "save ₦X per wig" estimate alongside the price.
    discount_type: c.discount_type || null,
    discount_value:
      c.discount_value !== null && c.discount_value !== undefined
        ? Number(c.discount_value)
        : null,
    // ── v3 deals engine fields ───────────────────────────────
    // Pre-orders are always accepted — a sold-out item never blocks checkout,
    // it ships on the pre-order timeline (delivery_weeks + preorder_extra_weeks).
    preorder_enabled: true,
    delivery_weeks: c.delivery_weeks || null,
    preorder_extra_weeks: c.preorder_extra_weeks ?? 4,
    position_ladder: c.position_ladder || null,
    stacking_bonus: c.stacking_bonus || null,
    bulk_tiers: c.bulk_tiers || null,
    // Gateways this campaign offers at checkout. Falls back to both rails for
    // older rows created before the column existed. USD still forces Nomba.
    allowed_payment_gateways:
      Array.isArray(c.allowed_payment_gateways) &&
      c.allowed_payment_gateways.length
        ? c.allowed_payment_gateways
        : ["paystack", "nomba"],
    products:
      state === "live"
        ? products
            .filter((p) => p.include_exclude !== "exclude")
            .map((p) => ({
              product_id: p.product_id,
              styled_id: p.styled_id,
              category_id: p.category_id,
              name: p.styled_name || p.product_name || p.category_name,
              // Long + short copy: prefer the snapshot taken on add, fall back to
              // the live styled product so older links still render description.
              short_description:
                p.short_description ?? p.styled_short_description ?? null,
              long_description:
                p.long_description ?? p.styled_long_description ?? null,
              campaign_price_ngn: p.campaign_price_ngn,
              campaign_price_usd: p.campaign_price_usd,
              // Both-currency reference prices (snapshot, else live styled retail).
              regular_price_ngn:
                p.regular_price_ngn ?? p.styled_retail_price_ngn ?? null,
              regular_price_usd:
                p.regular_price_usd ?? p.styled_retail_price_usd ?? null,
              is_featured: p.is_featured,
              // live_base_stock is computed from stock_levels across all
              // storefront locations for the base product. All styled products
              // sharing the same base product draw from this single pool, so
              // their stock_remaining values move in lockstep and cannot
              // collectively oversell the base.
              stock_remaining: p.live_base_stock,
              preorder:
                p.live_base_stock !== null &&
                p.live_base_stock !== undefined &&
                Number(p.live_base_stock) <= 0,
              image_url: p.resolved_image_url || p.image_url,
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

/**
 * Public base URL for a brand's sales landing pages.
 *
 * Sales campaigns are served from the brand's dedicated sales subdomain
 * (business_config.sales_subdomain, e.g. sales.pixiegirlglobal.com), which
 * the CEO sets in Settings → Business Setup. We prefer it over the general
 * storefront_domain so share links, go-live blasts and the payment-gateway
 * return URL all point at the live sale site — never the admin hub. Falls
 * back to storefront_domain, then APP_URL (dev / unconfigured).
 *
 * Accepts a value with or without scheme; trims trailing slashes and
 * prepends https:// when no scheme is present.
 */
function publicSaleBaseUrl(brand_config) {
  const raw =
    (brand_config &&
      (brand_config.sales_subdomain || brand_config.storefront_domain)) ||
    null;
  const trimmed = raw ? String(raw).trim().replace(/\/+$/, "") : "";
  if (!trimmed) return config.APP_URL || "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function shareKit({ brand_config, campaign }) {
  const base = publicSaleBaseUrl(brand_config);
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

/**
 * Read-only checkout-readiness report for the campaign screen (no repair, no
 * state change) so an operator can see — and fix — what would break checkout
 * before going live.
 */
async function getReadiness({ brand, id }) {
  const c = await repo.findById({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  const result = await readiness.check({
    brand,
    campaign: c,
    autofix: false,
  });
  return {
    campaign_id: c.campaign_id,
    status: c.status,
    public_state: resolveState(c),
    ...result,
  };
}

// ── Landing image upload ─────────────────────────────────
// Stores a hero / look-book image for a campaign and returns its public URL.
// Brand-scoped (the campaign must exist in the caller's brand) so a campaign
// editor can upload without needing the platform branding permission.
async function uploadImage({ brand, id, file }) {
  if (!file || !file.buffer || !file.buffer.length) {
    throw new AppError("NO_FILE", "No image was uploaded", 400);
  }
  if (!/^image\//.test(file.mimetype || "")) {
    throw new AppError("BAD_FILE_TYPE", "Only image files are allowed", 400);
  }
  const campaign = await repo.findById({ brand, id });
  if (!campaign) throw new NotFoundError("Campaign");

  const ext =
    String(file.originalname || "")
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 5) || "jpg";
  const key = `campaigns/${brand}/${id}/${crypto.randomBytes(12).toString("hex")}.${ext}`;
  const stored = await storage.put(file.buffer, {
    key,
    contentType: file.mimetype,
  });
  return { url: stored.public_url };
}

module.exports = {
  resolveState,
  buildLandingPayload,
  publicSaleBaseUrl,
  buildShareKit: shareKit,
  list,
  getById,
  create,
  uploadImage,
  update,
  archive,
  submit,
  approve,
  reject,
  transition,
  duplicate,
  listProducts,
  addProduct,
  addProductsBatch,
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
  getReadiness,
};
