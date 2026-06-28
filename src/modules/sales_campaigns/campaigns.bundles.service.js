/**
 * Sales Campaigns v2 — Bundles service.
 *
 * Bundles have ONE source of truth: the Catalogue (retention `bundle_offers`).
 * Campaigns never author bundles — they only REFERENCE a Catalogue bundle by
 * attaching it (`sales_campaign_bundles.bundle_id → bundle_offers`). There is
 * no campaign-side mirror anymore, so a change to a Catalogue bundle
 * (composition, price, hero) reflects on the live campaign immediately.
 *
 * This service therefore exposes: read-only views of the Catalogue bundles
 * (for the campaign-builder picker + the read-only list), attach/detach, and
 * the campaign-scoped tiers / cart-upsells / ambassadors. Transactional +
 * audited.
 */

"use strict";

const repo = require("./campaigns.bundles.repo");
// The Catalogue the user manages bundles in is the Retention engine's
// bundle_offers (Catalogue → Bundles tab) — the single source of truth.
const retentionBundleRepo = require("../retention/bundle.repo");
// Brand-wide head-size ladder (S/M/L/XL + absolute premium) — drives the
// customer-facing per-size bundle price on the live campaign.
const styledVariantsRepo = require("../catalogue/styled_variants.repo");
const events = require("./campaigns.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError } = require("../../utils/errors");

/**
 * Resolve a campaign bundle's price LIVE from its source Catalogue offer's
 * current pricing, given the live component subtotal and unit count. Mirrors the
 * retention bundle.service `priceBundle` semantics exactly so the campaign
 * storefront, the standalone Catalogue bundle, and checkout all agree:
 *   - fixed_bundle_price → the offer's bundle_price_ngn
 *   - pct_off           → subtotal × (1 − discount_value)   (discount_value is a fraction)
 *   - amount_off        → subtotal − discount_value × units  (₦ off EACH unit, owner
 *                          directive — a 6-piece "₦35k off each" saves ₦210k)
 *   - buy_x_get_y / tiered_qty → null (no single bundle price; caller falls back)
 *
 * Returns null when there's no resolvable source price, so callers keep the
 * stored snapshot for one-off (non-Catalogue) bundles.
 *
 * @param {{src_pricing_model?:string, src_discount_value?:number|string, src_bundle_price_ngn?:number|string}} src
 * @param {number} componentSubtotal  live Σ(component price × qty)
 * @param {number} totalUnits         live Σ(component qty) — the number of items in the bundle
 * @returns {number|null}
 */
function liveBundlePriceFromSource(src, componentSubtotal, totalUnits) {
  if (!src || !src.src_pricing_model) return null;
  const sub = Number(componentSubtotal) || 0;
  const units = Math.max(1, Number(totalUnits) || 1);
  switch (src.src_pricing_model) {
    case "fixed_bundle_price": {
      const p = Number(src.src_bundle_price_ngn);
      return Number.isFinite(p) && p > 0 ? p : null;
    }
    case "pct_off": {
      const pct = Number(src.src_discount_value) || 0;
      if (pct <= 0) return null;
      return Math.round(sub * (1 - pct) * 100) / 100;
    }
    case "amount_off": {
      // ₦ off EACH unit: multiply by the unit count, clamp the discount ≤ subtotal.
      const amt = Number(src.src_discount_value) || 0;
      if (amt <= 0) return null;
      const discount = Math.min(sub, amt * units);
      return Math.max(0, Math.round((sub - discount) * 100) / 100);
    }
    default:
      // buy_x_get_y / tiered_qty need per-line context — no single price here.
      return null;
  }
}

/**
 * Whole-bundle price at a chosen head size (PURE): the discounted-at-S bundle
 * price plus the size premium on EVERY wig (units = Σ component qty). S premium
 * is 0, so the S option equals the bundle price. This is the single formula the
 * storefront displays and checkout charges, so they can never disagree.
 *
 * @param {{ bundlePrice:number|string, premium_ngn:number|string, units:number }} a
 * @returns {number}
 */
function bundleSizePrice({ bundlePrice, premium_ngn, units }) {
  const base = Number(bundlePrice) || 0;
  const premium = Number(premium_ngn) || 0;
  const n = Number(units) || 0;
  return Math.round((base + premium * n) * 100) / 100;
}

/**
 * Map a Catalogue bundle_offer row to the shape the campaign admin already
 * consumes (the `Bundle` type: name/slug/status/…). Keeps the campaign UI and
 * checkout reading one stable shape while the data lives in the Catalogue.
 */
function mapOfferToBundle(o) {
  if (!o) return null;
  return {
    bundle_id: o.bundle_id,
    name: o.display_name,
    slug: o.bundle_code,
    description: o.description ?? null,
    hero_image_url: o.hero_image_url ?? null,
    pricing_model: o.pricing_model,
    bundle_price_ngn: o.bundle_price_ngn ?? null,
    discount_value: o.discount_value ?? null,
    // Surface amount_off as the per-item ₦ default so the detail modal's
    // legacy fallback math still resolves a sensible discounted total.
    default_per_item_discount_ngn:
      o.pricing_model === "amount_off" ? Number(o.discount_value || 0) : 0,
    default_preorder_loss_pct: 0,
    status: o.is_active ? "active" : "archived",
    display_order: o.display_order ?? 0,
    created_at: o.created_at,
  };
}

// ── Bundles (read-only views of the Catalogue SSOT) ──────
async function listBundles({ brand, filters = {} }) {
  const offers = await retentionBundleRepo.list({ brand, only_active: false });
  let data = offers.map(mapOfferToBundle);
  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    data = data.filter(
      (b) =>
        (b.name || "").toLowerCase().includes(q) ||
        (b.slug || "").toLowerCase().includes(q),
    );
  }
  if (filters.status) {
    data = data.filter((b) => b.status === filters.status);
  }
  return { data, meta: { total: data.length, has_more: false } };
}

async function getBundle({ brand, id }) {
  const offer = await retentionBundleRepo.getById({ brand, id });
  if (!offer) throw new NotFoundError("Bundle");
  const items = await repo.listBundleItems({ brand, bundle_id: id });
  return { ...mapOfferToBundle(offer), items };
}

/**
 * List the Catalogue bundles available to import into a campaign. These are
 * the active retention bundle_offers rows — the same ones the user manages
 * under Catalogue → Bundles. Component count is attached for the picker
 * (so the user can see "5 products" at a glance) and the per-bundle pricing
 * summary is surfaced so the campaign view matches the source of truth.
 */
async function listCatalogueBundleSources({ brand }) {
  const offers = await retentionBundleRepo.list({ brand, only_active: true });
  const data = [];
  for (const o of offers) {
    const comps = await retentionBundleRepo.listComponents({
      brand,
      bundle_id: o.bundle_id,
    });
    data.push({
      bundle_offer_id: o.bundle_id,
      bundle_code: o.bundle_code,
      display_name: o.display_name,
      description: o.description,
      hero_image_url: o.hero_image_url,
      pricing_model: o.pricing_model,
      bundle_price_ngn: o.bundle_price_ngn,
      bundle_price_usd: o.bundle_price_usd,
      discount_value: o.discount_value,
      component_count: comps.length,
      components_total_ngn: comps.reduce(
        (sum, c) =>
          sum + Number(c.unit_price_ngn || 0) * (Number(c.quantity) || 1),
        0,
      ),
      is_active: o.is_active,
    });
  }
  return { data };
}

/**
 * Import ONE Catalogue bundle into a campaign = attach it by reference. No
 * copy is made — the link points straight at the Catalogue bundle_offer, so
 * every later edit in Catalogue → Bundles is reflected live.
 */
async function importCatalogueBundle({
  brand,
  user,
  request_id,
  campaign_id,
  source_bundle_offer_id,
}) {
  const offer = await retentionBundleRepo.getById({
    brand,
    id: source_bundle_offer_id,
  });
  if (!offer) throw new NotFoundError("Catalogue bundle");
  const link = await repo.attachCampaignBundle({
    brand,
    campaign_id,
    input: { bundle_id: source_bundle_offer_id, is_featured: false },
  });
  events.emit("updated", { brand, id: campaign_id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "sales_campaigns.bundle.import",
    target_type: "sales_campaign_bundles",
    target_id: link.link_id,
    after: {
      source_bundle_offer_id,
      bundle_id: source_bundle_offer_id,
      link_id: link.link_id,
    },
    request_id,
  });
  return { bundle: mapOfferToBundle(offer), link };
}

// ── Campaign attachment ──────────────────────────────────
/**
 * List a campaign's attached bundles, each enriched with its component
 * breakdown and live pricing math so the public landing page can render a
 * bundle-detail modal (the component wigs, each one's live price, the
 * discounted bundle price, and the savings vs sum-of-parts) with no extra
 * round-trips.
 *
 * Component prices + composition are read LIVE from the Catalogue inside
 * listBundleItems, so an edit in the Catalogue (products, price, hero) reflects
 * on the campaign bundle immediately — the Catalogue is the single source of truth.
 */
async function listCampaignBundles({ brand, campaign_id }) {
  const rows = await repo.listCampaignBundles({ brand, campaign_id });
  // Brand head-size ladder (S=0 premium). Fetched once; each bundle exposes a
  // per-size price so the storefront can let the buyer pick a size. The price
  // is computed the SAME way checkout charges it (discounted-at-S + premium ×
  // units), so the displayed figure always equals the till.
  const sizeTiers = await styledVariantsRepo
    .listSizeTiers({ brand, activeOnly: true })
    .catch(() => []);
  return Promise.all(
    rows.map(async (b) => {
      const items = await repo.listBundleItems({
        brand,
        bundle_id: b.bundle_id,
      });
      const components = items.map((it) => {
        const qty = Number(it.quantity) || 1;
        const unit = Number(it.unit_price_ngn) || 0;
        return {
          bundle_item_id: it.bundle_item_id,
          styled_id: it.styled_id,
          styled_slug: it.styled_slug,
          product_id: it.product_id,
          variant_id: it.variant_id,
          display_name: it.display_name,
          hero_image_url: it.hero_image_url,
          quantity: qty,
          unit_price_ngn: unit,
          line_total_ngn: unit * qty,
        };
      });
      const totalRetail = components.reduce((s, c) => s + c.line_total_ngn, 0);
      const totalQty = components.reduce((s, c) => s + c.quantity, 0);
      // Price priority:
      //   1. LIVE from the source Catalogue offer — so a discount edited + saved
      //      in Catalogue → Bundles shows on the storefront immediately. SSOT.
      //   2. The stored campaign snapshot (manual CEO override).
      //   3. The stored per-item discount.
      //   4. The live component subtotal (no campaign discount).
      const liveSourcePrice = liveBundlePriceFromSource(b, totalRetail, totalQty);
      const perItemDiscount = Number(b.per_item_discount_ngn) || 0;
      let bundlePrice;
      if (liveSourcePrice !== null) {
        bundlePrice = liveSourcePrice;
      } else if (b.campaign_bundle_price_ngn !== null && b.campaign_bundle_price_ngn !== undefined) {
        bundlePrice = Number(b.campaign_bundle_price_ngn);
      } else if (perItemDiscount > 0) {
        bundlePrice = Math.max(0, totalRetail - perItemDiscount * totalQty);
      } else {
        bundlePrice = totalRetail;
      }
      // A campaign price may only ever DISCOUNT, never inflate above the parts.
      bundlePrice = Math.min(bundlePrice, totalRetail);
      const savings = Math.max(0, totalRetail - bundlePrice);
      // Per-size prices: the discounted-at-S bundle price plus each size's
      // brand premium applied to every wig in the bundle (S premium = 0, so the
      // S option equals the bundle price). The buyer picks a size; the premium
      // rides on top of the discount, exactly as checkout charges it.
      const sizeOptions = (sizeTiers || []).map((t) => {
        const premium = Number(t.premium_ngn) || 0;
        return {
          size_code: t.size_code,
          label: t.label || t.size_code,
          premium_ngn: premium,
          price_ngn: bundleSizePrice({
            bundlePrice,
            premium_ngn: premium,
            units: totalQty,
          }),
        };
      });
      // Live stock from the SSOT (the snapshot column is no longer maintained).
      const liveStock = b.live_bundle_stock !== null && b.live_bundle_stock !== undefined
        ? Number(b.live_bundle_stock)
        : b.current_stock_snapshot;
      return {
        ...b,
        description: b.bundle_description ?? null,
        current_stock_snapshot: liveStock,
        components,
        component_count: components.length,
        total_retail_ngn: totalRetail,
        campaign_bundle_price_ngn: bundlePrice,
        total_savings_ngn: savings,
        total_units: totalQty,
        size_options: sizeOptions,
      };
    }),
  );
}

async function attachCampaignBundle({
  brand,
  user,
  request_id,
  campaign_id,
  input,
}) {
  return transaction(async (client) => {
    const offer = await retentionBundleRepo.getById({
      brand,
      id: input.bundle_id,
    });
    if (!offer) throw new NotFoundError("Bundle");
    const link = await repo.attachCampaignBundle({
      client,
      brand,
      campaign_id,
      input,
    });
    events.emit("updated", { brand, id: campaign_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.bundle.attach",
      target_type: "sales_campaign_bundles",
      target_id: link.link_id,
      after: link,
      request_id,
    });
    return link;
  });
}

async function detachCampaignBundle({
  brand,
  user,
  request_id,
  campaign_id,
  link_id,
}) {
  return transaction(async (client) => {
    const ok = await repo.detachCampaignBundle({ client, brand, link_id });
    if (!ok) throw new NotFoundError("Campaign bundle");
    events.emit("updated", { brand, id: campaign_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.bundle.detach",
      target_type: "sales_campaign_bundles",
      target_id: link_id,
      request_id,
    });
  });
}

// ── Quantity tiers ───────────────────────────────────────
async function listTiers({ brand, campaign_id }) {
  return repo.listTiers({ brand, campaign_id });
}

async function upsertTier({ brand, user, request_id, campaign_id, input }) {
  return transaction(async (client) => {
    const tier = await repo.upsertTier({ client, brand, campaign_id, input });
    events.emit("updated", { brand, id: campaign_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.tier.upsert",
      target_type: "sales_campaign_quantity_tiers",
      target_id: tier.tier_id,
      after: tier,
      request_id,
    });
    return tier;
  });
}

async function deleteTier({ brand, user, request_id, campaign_id, tier_id }) {
  return transaction(async (client) => {
    const ok = await repo.deleteTier({ client, brand, tier_id });
    if (!ok) throw new NotFoundError("Tier");
    events.emit("updated", { brand, id: campaign_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.tier.delete",
      target_type: "sales_campaign_quantity_tiers",
      target_id: tier_id,
      request_id,
    });
  });
}

// ── Cart upsells ─────────────────────────────────────────
async function listUpsells({ brand, campaign_id }) {
  return repo.listUpsells({ brand, campaign_id });
}

async function upsertUpsell({ brand, user, request_id, campaign_id, input }) {
  return transaction(async (client) => {
    const row = await repo.upsertUpsell({ client, brand, campaign_id, input });
    events.emit("updated", { brand, id: campaign_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.upsell.upsert",
      target_type: "sales_campaign_cart_upsells",
      target_id: row.upsell_id,
      after: row,
      request_id,
    });
    return row;
  });
}

async function deleteUpsell({
  brand,
  user,
  request_id,
  campaign_id,
  upsell_id,
}) {
  return transaction(async (client) => {
    const ok = await repo.deleteUpsell({ client, brand, upsell_id });
    if (!ok) throw new NotFoundError("Upsell");
    events.emit("updated", { brand, id: campaign_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.upsell.delete",
      target_type: "sales_campaign_cart_upsells",
      target_id: upsell_id,
      request_id,
    });
  });
}

// ── Ambassadors ──────────────────────────────────────────
async function listCampaignAmbassadors({ brand, campaign_id }) {
  return repo.listCampaignAmbassadors({ brand, campaign_id });
}

async function addCampaignAmbassador({
  brand,
  user,
  request_id,
  campaign_id,
  input,
}) {
  return transaction(async (client) => {
    const row = await repo.addCampaignAmbassador({
      client,
      brand,
      campaign_id,
      input,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.ambassador.attach",
      target_type: "sales_campaign_ambassadors",
      target_id: row.ambassador_link_id,
      after: row,
      request_id,
    });
    return row;
  });
}

async function removeCampaignAmbassador({
  brand,
  user,
  request_id,
  ambassador_link_id,
}) {
  return transaction(async (client) => {
    const ok = await repo.removeCampaignAmbassador({
      client,
      brand,
      ambassador_link_id,
    });
    if (!ok) throw new NotFoundError("Ambassador link");
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.ambassador.detach",
      target_type: "sales_campaign_ambassadors",
      target_id: ambassador_link_id,
      request_id,
    });
  });
}

async function listAmbassadorContacts({ brand, q }) {
  return repo.listAmbassadorContacts({ brand, q });
}

async function promoteContactToAmbassador({
  brand,
  user,
  request_id,
  contact_id,
  profile,
}) {
  return transaction(async (client) => {
    const contact = await repo.promoteContactToAmbassador({
      client,
      brand,
      contact_id,
      profile,
    });
    if (!contact) throw new NotFoundError("Contact");
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "contacts.ambassador.promote",
      target_type: "contacts",
      target_id: contact_id,
      after: contact,
      request_id,
    });
    return contact;
  });
}

async function demoteAmbassador({ brand, user, request_id, contact_id }) {
  return transaction(async (client) => {
    await repo.demoteAmbassador({ client, brand, contact_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "contacts.ambassador.demote",
      target_type: "contacts",
      target_id: contact_id,
      request_id,
    });
  });
}

module.exports = {
  listBundles,
  getBundle,
  importCatalogueBundle,
  listCatalogueBundleSources,
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
  addCampaignAmbassador,
  removeCampaignAmbassador,
  listAmbassadorContacts,
  promoteContactToAmbassador,
  demoteAmbassador,
  liveBundlePriceFromSource,
  bundleSizePrice,
};
