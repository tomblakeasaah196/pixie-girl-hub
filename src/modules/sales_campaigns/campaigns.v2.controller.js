/**
 * Sales Campaigns v2 — HTTP controllers for bundles, tiers, cart upsells,
 * Praxis assist, ambassadors, and VIP grants. Thin glue: req/res → service.
 */

"use strict";

const bundles = require("./campaigns.bundles.service");
const praxis = require("./campaigns.praxis.service");
const vip = require("./campaigns.vip.service");
const { parsePagination } = require("../../utils/pagination");

// ── Bundles (read-only views of the Catalogue SSOT) ──────
// Authoring lives in Catalogue → Bundles (retention). Campaigns only read +
// attach; there is no campaign-side create/update/delete anymore.
async function listBundles(req, res) {
  const { page, page_size } = parsePagination(req.query);
  const result = await bundles.listBundles({
    brand: req.brand,
    filters: { q: req.query.q, status: req.query.status },
  });
  res.json({ ...result, meta: { ...(result.meta || {}), page, page_size } });
}
async function getBundle(req, res) {
  const data = await bundles.getBundle({ brand: req.brand, id: req.params.id });
  res.json({ data });
}

// ── Import (attach a Catalogue bundle by reference) ──────
async function listCatalogueBundleSources(req, res) {
  const result = await bundles.listCatalogueBundleSources({
    brand: req.brand,
  });
  res.json(result);
}

async function importCatalogueBundle(req, res) {
  const data = await bundles.importCatalogueBundle({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    campaign_slug: req.body.campaign_slug || "campaign",
    source_bundle_offer_id: req.body.source_bundle_offer_id,
  });
  res.status(201).json({ data });
}

// ── Campaign attachments ─────────────────────────────────
async function listCampaignBundles(req, res) {
  const data = await bundles.listCampaignBundles({
    brand: req.brand,
    campaign_id: req.params.id,
  });
  res.json({ data });
}
async function attachCampaignBundle(req, res) {
  const data = await bundles.attachCampaignBundle({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    input: req.body,
  });
  res.status(201).json({ data });
}
async function detachCampaignBundle(req, res) {
  await bundles.detachCampaignBundle({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    link_id: req.params.linkId,
  });
  res.status(204).end();
}

// ── Tiers ────────────────────────────────────────────────
async function listTiers(req, res) {
  const data = await bundles.listTiers({
    brand: req.brand,
    campaign_id: req.params.id,
  });
  res.json({ data });
}
async function upsertTier(req, res) {
  const data = await bundles.upsertTier({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    input: req.body,
  });
  res.status(201).json({ data });
}
async function deleteTier(req, res) {
  await bundles.deleteTier({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    tier_id: req.params.tierId,
  });
  res.status(204).end();
}

// ── Upsells ──────────────────────────────────────────────
async function listUpsells(req, res) {
  const data = await bundles.listUpsells({
    brand: req.brand,
    campaign_id: req.params.id,
  });
  res.json({ data });
}
async function upsertUpsell(req, res) {
  const data = await bundles.upsertUpsell({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    input: req.body,
  });
  res.status(201).json({ data });
}
async function deleteUpsell(req, res) {
  await bundles.deleteUpsell({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    upsell_id: req.params.upsellId,
  });
  res.status(204).end();
}

// ── Ambassadors ──────────────────────────────────────────
async function listCampaignAmbassadors(req, res) {
  const data = await bundles.listCampaignAmbassadors({
    brand: req.brand,
    campaign_id: req.params.id,
  });
  res.json({ data });
}
async function attachAmbassador(req, res) {
  const data = await bundles.addCampaignAmbassador({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    input: req.body,
  });
  res.status(201).json({ data });
}
async function detachAmbassador(req, res) {
  await bundles.removeCampaignAmbassador({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    ambassador_link_id: req.params.linkId,
  });
  res.status(204).end();
}
async function listAmbassadorContacts(req, res) {
  const data = await bundles.listAmbassadorContacts({
    brand: req.brand,
    q: req.query.q,
  });
  res.json({ data });
}
async function promoteContact(req, res) {
  const data = await bundles.promoteContactToAmbassador({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    contact_id: req.params.contactId,
    profile: req.body || {},
  });
  res.json({ data });
}
async function demoteContact(req, res) {
  await bundles.demoteAmbassador({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    contact_id: req.params.contactId,
  });
  res.status(204).end();
}

// ── Praxis assist ────────────────────────────────────────
async function praxisDraftCopy(req, res) {
  const data = await praxis.draftCopy({
    brand: req.brand,
    user: req.user,
    campaign_id: req.params.id,
    brief: req.body,
  });
  res.json({ data });
}
async function praxisSuggestLayout(req, res) {
  const data = await praxis.suggestLayout({
    brand: req.brand,
    user: req.user,
    campaign_id: req.params.id,
    brief: req.body,
  });
  res.json({ data });
}
async function praxisSuggestPricing(req, res) {
  const data = await praxis.suggestPricing({
    brand: req.brand,
    user: req.user,
    campaign_id: req.params.id,
    target_margin_pct: req.body.target_margin_pct,
    include_charm_rounding: req.body.include_charm_rounding,
    inputs: req.body.inputs,
  });
  res.json({ data });
}
async function praxisDryRunPricing(req, res) {
  const data = await praxis.dryRunPricing({
    brand: req.brand,
    user: req.user,
    campaign_id: req.params.id,
    question: req.body.question,
    payload: req.body,
  });
  res.json({ data });
}
async function praxisAnalyticsQna(req, res) {
  const data = await praxis.analyticsQna({
    brand: req.brand,
    user: req.user,
    campaign_id: req.params.id,
    question: req.body.question,
  });
  res.json({ data });
}
async function praxisDailyBriefing(req, res) {
  const data = await praxis.dailyBriefing({
    brand: req.brand,
    user: req.user,
    campaign_id: req.params.id,
  });
  res.json({ data });
}
async function praxisAccept(req, res) {
  await praxis.recordAcceptance({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    action_key: req.body.action_key,
    prompt: req.body.prompt,
    draft: req.body.draft,
    accepted: req.body.accepted,
  });
  res.status(204).end();
}

// ── VIP grants ───────────────────────────────────────────
async function listVipGrants(req, res) {
  const data = await vip.listGrants({
    brand: req.brand,
    campaign_id: req.params.id,
  });
  res.json({ data });
}
async function grantVip(req, res) {
  const data = await vip.grantTopSpenders({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    top_n: req.body.top_n,
  });
  res.json({ data });
}
async function updateGiftStatus(req, res) {
  const data = await vip.updateGiftStatus({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    campaign_id: req.params.id,
    grant_id: req.params.grantId,
    gift_status: req.body.gift_status,
  });
  res.json({ data });
}

module.exports = {
  listBundles,
  getBundle,
  listCatalogueBundleSources,
  importCatalogueBundle,
  listCampaignBundles,
  attachCampaignBundle,
  detachCampaignBundle,
  listTiers,
  upsertTier,
  deleteTier,
  listUpsells,
  upsertUpsell,
  deleteUpsell,
  listCampaignAmbassadors,
  attachAmbassador,
  detachAmbassador,
  listAmbassadorContacts,
  promoteContact,
  demoteContact,
  praxisDraftCopy,
  praxisSuggestLayout,
  praxisSuggestPricing,
  praxisDryRunPricing,
  praxisAnalyticsQna,
  praxisDailyBriefing,
  praxisAccept,
  listVipGrants,
  grantVip,
  updateGiftStatus,
};
