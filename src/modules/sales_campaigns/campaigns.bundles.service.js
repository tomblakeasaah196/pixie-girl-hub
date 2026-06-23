/**
 * Sales Campaigns v2 — Bundles service.
 *
 * Business logic for bundles (catalogue entities), campaign attachments,
 * quantity tiers, cart upsells, and ambassadors. Transactional + audited.
 */

"use strict";

const repo = require("./campaigns.bundles.repo");
// The "Catalogue" the user manages bundles in is the Retention engine's
// bundle_offers (Catalogue → Bundles tab). "Clone from catalogue" pulls those
// into the campaign, so we read them through the retention bundle repo.
const retentionBundleRepo = require("../retention/bundle.repo");
const events = require("./campaigns.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, ConflictError } = require("../../utils/errors");

/** Kebab-case a bundle code / name for a campaign bundle slug (≤80 chars). */
function slugifyBundle(s) {
  return (
    String(s || "bundle")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "bundle"
  );
}

// ── Bundles ──────────────────────────────────────────────
async function listBundles({ brand, filters, limit, offset }) {
  return repo.listBundles({ brand, filters, limit, offset });
}
async function getBundle({ brand, id }) {
  const bundle = await repo.findBundle({ brand, id });
  if (!bundle) throw new NotFoundError("Bundle");
  const items = await repo.listBundleItems({ brand, bundle_id: id });
  return { ...bundle, items };
}

async function createBundle({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const clash = await repo.findBundleBySlug({
      client,
      brand,
      slug: input.slug,
    });
    if (clash)
      throw new ConflictError(`Bundle slug '${input.slug}' is already in use`);
    const created = await repo.createBundle({
      client,
      brand,
      input,
      user_id: user.user_id,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.bundle.create",
      target_type: "product_bundles",
      target_id: created.bundle_id,
      after: created,
      request_id,
    });
    return created;
  });
}

async function updateBundle({ brand, user, request_id, id, patch }) {
  return transaction(async (client) => {
    const before = await repo.findBundle({ client, brand, id });
    if (!before) throw new NotFoundError("Bundle");
    if (patch.slug && patch.slug !== before.slug) {
      const clash = await repo.findBundleBySlug({
        client,
        brand,
        slug: patch.slug,
      });
      if (clash)
        throw new ConflictError(
          `Bundle slug '${patch.slug}' is already in use`,
        );
    }
    const updated = await repo.updateBundle({ client, brand, id, patch });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.bundle.update",
      target_type: "product_bundles",
      target_id: id,
      before,
      after: updated,
      request_id,
    });
    return updated;
  });
}

async function archiveBundle({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const ok = await repo.deleteBundle({ client, brand, id });
    if (!ok) throw new NotFoundError("Bundle");
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.bundle.archive",
      target_type: "product_bundles",
      target_id: id,
      request_id,
    });
  });
}

// ── Bundle items ─────────────────────────────────────────
async function addBundleItem({ brand, user, request_id, bundle_id, input }) {
  return transaction(async (client) => {
    const bundle = await repo.findBundle({ client, brand, id: bundle_id });
    if (!bundle) throw new NotFoundError("Bundle");
    const item = await repo.addBundleItem({ client, brand, bundle_id, input });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.bundle.item.add",
      target_type: "product_bundle_items",
      target_id: item.bundle_item_id,
      after: item,
      request_id,
    });
    return item;
  });
}

async function removeBundleItem({ brand, user, request_id, bundle_item_id }) {
  return transaction(async (client) => {
    const ok = await repo.removeBundleItem({ client, brand, bundle_item_id });
    if (!ok) throw new NotFoundError("Bundle item");
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.bundle.item.remove",
      target_type: "product_bundle_items",
      target_id: bundle_item_id,
      request_id,
    });
  });
}

async function reorderBundleItems({
  brand,
  user,
  request_id,
  bundle_id,
  ordered_ids,
}) {
  return transaction(async (client) => {
    await repo.reorderBundleItems({ client, brand, bundle_id, ordered_ids });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.bundle.item.reorder",
      target_type: "product_bundles",
      target_id: bundle_id,
      after: { ordered_ids },
      request_id,
    });
  });
}

/**
 * Mirror ONE Catalogue bundle (retention bundle_offers row) into the campaign's
 * own product_bundles table and attach it. Idempotent — re-importing the same
 * offer into the same campaign upserts the link rather than duplicating items.
 *
 * Pricing model + bundle price + per-item discount are inherited from the
 * source offer so the campaign view matches what the user sees in Catalogue.
 */
async function mirrorAndAttach({
  client,
  brand,
  user,
  campaign_id,
  campaign_slug,
  offer,
}) {
  const components = await retentionBundleRepo.listComponents({
    client,
    brand,
    bundle_id: offer.bundle_id,
  });
  const newSlug = `${campaign_slug}-${slugifyBundle(
    offer.bundle_code || offer.display_name,
  )}`.slice(0, 120);

  let target = await repo.findBundleBySlug({
    client,
    brand,
    slug: newSlug,
  });
  if (!target) {
    // Carry the offer's amount_off / discount_value through as the per-item
    // default so the campaign-bundle row inherits the discount the user set
    // in Catalogue. Fixed-bundle-price offers use campaign_bundle_price_ngn
    // instead (handled on the attach below).
    const defaultPerItemDiscount =
      offer.pricing_model === "amount_off"
        ? Number(offer.discount_value || 0) || 0
        : 0;
    target = await repo.createBundle({
      client,
      brand,
      user_id: user.user_id,
      input: {
        slug: newSlug,
        name: offer.display_name,
        description: offer.description,
        hero_image_url: offer.hero_image_url,
        is_fixed_composition: true,
        default_per_item_discount_ngn: defaultPerItemDiscount,
        status: "active",
        display_order: offer.display_order,
      },
    });
    for (const comp of components) {
      // Belt-and-braces fallback for installs that haven't applied 000053
      // yet: if the source component is styled-only (the common case post-
      // 000048), derive the base product_id from the styled row so the
      // INSERT satisfies the OLD product_bundle_items CHECK as well. On a
      // fully migrated install the styled_id alone is now valid; either
      // way the row is accepted.
      let resolvedProductId = comp.product_id || null;
      if (!resolvedProductId && !comp.variant_id && comp.styled_id) {
        const { rows: spRows } = await client.query(
          `SELECT base_product_id FROM ${brand}.styled_products
            WHERE styled_id = $1 AND is_deleted = false`,
          [comp.styled_id],
        );
        resolvedProductId = spRows[0]?.base_product_id || null;
      }
      await repo.addBundleItem({
        client,
        brand,
        bundle_id: target.bundle_id,
        input: {
          product_id: resolvedProductId,
          variant_id: comp.variant_id,
          styled_id: comp.styled_id,
          quantity: comp.quantity,
          per_item_discount_ngn: null,
          display_position: comp.display_order,
        },
      });
    }
  }
  const link = await repo.attachCampaignBundle({
    client,
    brand,
    campaign_id,
    input: {
      bundle_id: target.bundle_id,
      campaign_bundle_price_ngn:
        offer.pricing_model === "fixed_bundle_price"
          ? (offer.bundle_price_ngn ?? null)
          : null,
      per_item_discount_ngn:
        offer.pricing_model === "amount_off"
          ? (Number(offer.discount_value || 0) || null)
          : null,
      is_featured: false,
    },
  });
  return { bundle: target, link };
}

/**
 * Clone the brand's Catalogue bundles into a campaign and attach each.
 * Used by the "Import all" path; per-bundle import goes through
 * importCatalogueBundle below.
 */
async function cloneAllBundlesToCampaign({
  brand,
  user,
  request_id,
  campaign_id,
  campaign_slug,
}) {
  return transaction(async (client) => {
    const offers = await retentionBundleRepo.list({
      brand,
      only_active: true,
    });
    const results = [];
    for (const offer of offers) {
      const { bundle } = await mirrorAndAttach({
        client,
        brand,
        user,
        campaign_id,
        campaign_slug,
        offer,
      });
      results.push(bundle);
    }
    events.emit("updated", { brand, id: campaign_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.bundle.clone_all",
      target_type: "sales_campaigns",
      target_id: campaign_id,
      after: { cloned: results.length, source: "catalogue_bundle_offers" },
      request_id,
    });
    return results;
  });
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
 * Import ONE Catalogue bundle into a campaign and attach it. The mirror in
 * product_bundles is created lazily (re-using an existing slug-matched copy if
 * the same offer has been imported into a previous campaign), so the campaign
 * carries a stable snapshot even if the source offer is later edited.
 */
async function importCatalogueBundle({
  brand,
  user,
  request_id,
  campaign_id,
  campaign_slug,
  source_bundle_offer_id,
}) {
  return transaction(async (client) => {
    const offers = await retentionBundleRepo.list({
      brand,
      only_active: true,
    });
    const offer = offers.find(
      (o) => o.bundle_id === source_bundle_offer_id,
    );
    if (!offer) throw new NotFoundError("Catalogue bundle");
    const { bundle, link } = await mirrorAndAttach({
      client,
      brand,
      user,
      campaign_id,
      campaign_slug,
      offer,
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
        bundle_id: bundle.bundle_id,
        link_id: link.link_id,
      },
      request_id,
    });
    return { bundle, link };
  });
}

/**
 * Duplicate a single bundle, optionally attaching the copy to a campaign.
 * Resolves slug collisions automatically by appending -copy[-N].
 */
async function duplicateBundle({
  brand,
  user,
  request_id,
  bundle_id,
  campaign_id,
}) {
  return transaction(async (client) => {
    const original = await repo.findBundle({ client, brand, id: bundle_id });
    if (!original) throw new NotFoundError("Bundle");
    const items = await repo.listBundleItems({
      client,
      brand,
      bundle_id,
    });
    let newSlug = `${original.slug}-copy`;
    let attempt = 0;
    while (await repo.findBundleBySlug({ client, brand, slug: newSlug })) {
      attempt++;
      newSlug = `${original.slug}-copy-${attempt}`;
    }
    const clone = await repo.createBundle({
      client,
      brand,
      user_id: user.user_id,
      input: {
        slug: newSlug,
        name: `${original.name} (copy)`,
        description: original.description,
        hero_image_url: original.hero_image_url,
        category_id: original.category_id,
        is_fixed_composition: original.is_fixed_composition,
        default_per_item_discount_ngn: original.default_per_item_discount_ngn,
        default_preorder_loss_pct: original.default_preorder_loss_pct,
        status: "active",
        display_order: original.display_order,
      },
    });
    for (const item of items) {
      await repo.addBundleItem({
        client,
        brand,
        bundle_id: clone.bundle_id,
        input: {
          product_id: item.product_id,
          variant_id: item.variant_id,
          styled_id: item.styled_id,
          quantity: item.quantity,
          per_item_discount_ngn: item.per_item_discount_ngn,
          display_position: item.display_position,
        },
      });
    }
    if (campaign_id) {
      await repo.attachCampaignBundle({
        client,
        brand,
        campaign_id,
        input: { bundle_id: clone.bundle_id, is_featured: false },
      });
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.bundle.duplicate",
      target_type: "product_bundles",
      target_id: clone.bundle_id,
      after: clone,
      request_id,
    });
    return clone;
  });
}

// ── Campaign attachment ──────────────────────────────────
async function listCampaignBundles({ brand, campaign_id }) {
  return repo.listCampaignBundles({ brand, campaign_id });
}

async function attachCampaignBundle({
  brand,
  user,
  request_id,
  campaign_id,
  input,
}) {
  return transaction(async (client) => {
    const bundle = await repo.findBundle({
      client,
      brand,
      id: input.bundle_id,
    });
    if (!bundle) throw new NotFoundError("Bundle");
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
  createBundle,
  updateBundle,
  archiveBundle,
  cloneAllBundlesToCampaign,
  importCatalogueBundle,
  listCatalogueBundleSources,
  duplicateBundle,
  addBundleItem,
  removeBundleItem,
  reorderBundleItems,
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
};
