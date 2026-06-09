/**
 * Sales Campaigns — PUBLIC service (V2.2 §6.22 + §6.4).
 *
 * Powers the no-login landing page at /sale/:slug. Resolves the campaign
 * (by brand hint or by scanning brands, since slugs are brand-scoped) and
 * returns only public-safe data — never cost prices, never the other
 * brand's data, never draft/pending campaigns.
 */

"use strict";

const repo = require("./campaigns.repo");
const main = require("./campaigns.service");
const events = require("./campaigns.events");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

const { BRANDS } = require("../../config/brands");

// Statuses that are publicly visible (the landing page exists for these).
const PUBLIC_STATUSES = new Set(["scheduled", "live", "paused", "ended"]);

async function resolveCampaign(slug, brandHint) {
  if (brandHint && BRANDS.includes(brandHint)) {
    const c = await repo.findBySlug({ brand: brandHint, slug });
    return c ? { campaign: c, brand: brandHint } : null;
  }
  for (const brand of BRANDS) {
    const c = await repo.findBySlug({ brand, slug });
    if (c) return { campaign: c, brand };
  }
  return null;
}

async function getLanding({ slug, brandHint }) {
  const found = await resolveCampaign(slug, brandHint);
  if (!found || !PUBLIC_STATUSES.has(found.campaign.status)) {
    throw new NotFoundError("Campaign");
  }
  const { campaign, brand } = found;
  const products = await repo.listProducts({
    brand,
    campaign_id: campaign.campaign_id,
  });
  return main.buildLandingPayload(
    campaign,
    products,
    main.resolveState(campaign),
  );
}

async function getStock({ slug, brandHint }) {
  const found = await resolveCampaign(slug, brandHint);
  if (!found || !PUBLIC_STATUSES.has(found.campaign.status)) {
    throw new NotFoundError("Campaign");
  }
  const { campaign, brand } = found;
  const products = await repo.listProducts({
    brand,
    campaign_id: campaign.campaign_id,
  });
  return products
    .filter((p) => p.include_exclude !== "exclude" && p.product_id)
    .map((p) => ({
      product_id: p.product_id,
      stock_remaining: p.current_stock_snapshot,
    }));
}

async function signup({ slug, brandHint, input, ip, user_agent }) {
  const found = await resolveCampaign(slug, brandHint);
  if (!found) throw new NotFoundError("Campaign");
  const { campaign, brand } = found;

  const state = main.resolveState(campaign);
  if (state === "ended") {
    throw new AppError("CAMPAIGN_ENDED", "This campaign has ended", 409);
  }
  if (!campaign.signup_for_notifications) {
    throw new AppError(
      "SIGNUPS_DISABLED",
      "Notifications are not enabled for this campaign",
      409,
    );
  }

  return transaction(async (client) => {
    const existing = await repo.findSignup({
      client,
      brand,
      campaign_id: campaign.campaign_id,
      email: input.email,
      phone: input.phone,
    });
    if (existing) {
      return { already_signed_up: true, signup_id: existing.signup_id };
    }
    const created = await repo.createSignup({
      client,
      brand,
      campaign_id: campaign.campaign_id,
      input,
      ip,
      user_agent,
    });
    await repo.incrementCounters({
      client,
      brand,
      id: campaign.campaign_id,
      deltas: { total_signups: 1 },
    });
    events.emit("signup_received", {
      brand,
      id: campaign.campaign_id,
      signup_id: created.signup_id,
    });
    return { already_signed_up: false, signup_id: created.signup_id };
  });
}

module.exports = { getLanding, getStock, signup };
