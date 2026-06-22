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
 * Clone the brand's Catalogue bundles into a campaign and attach each.
 *
 * "Catalogue bundles" = the Retention engine's bundle_offers (Catalogue →
 * Bundles tab), which is where the user actually builds bundles — NOT the
 * separate campaign product_bundles table. Each active offer is copied into a
 * campaign bundle (product_bundles + items) and attached, preserving a fixed
 * bundle price as the campaign price. Idempotent: an offer already cloned (same
 * derived slug) is re-used, and the attach upserts, so re-running is safe.
 */
async function cloneAllBundlesToCampaign({
  brand,
  user,
  request_id,
  campaign_id,
  campaign_slug,
}) {
  return transaction(async (client) => {
    // Source = the Catalogue/Retention bundles the user manages.
    const offers = await retentionBundleRepo.list({
      brand,
      only_active: true,
    });
    const results = [];
    for (const offer of offers) {
      const components = await retentionBundleRepo.listComponents({
        client,
        brand,
        bundle_id: offer.bundle_id,
      });
      // bundle_code is UNIQUE, so this slug is stable + collision-free per offer.
      const newSlug = `${campaign_slug}-${slugifyBundle(
        offer.bundle_code || offer.display_name,
      )}`.slice(0, 120);

      let target = await repo.findBundleBySlug({
        client,
        brand,
        slug: newSlug,
      });
      if (!target) {
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
            status: "active",
            display_order: offer.display_order,
          },
        });
        for (const comp of components) {
          // bundle_offer_products enforces product_id OR variant_id, so the
          // campaign item's CHECK is always satisfied; styled_id rides along as
          // the storefront reference.
          await repo.addBundleItem({
            client,
            brand,
            bundle_id: target.bundle_id,
            input: {
              product_id: comp.product_id,
              variant_id: comp.variant_id,
              styled_id: comp.styled_id,
              quantity: comp.quantity,
              per_item_discount_ngn: null,
              display_position: comp.display_order,
            },
          });
        }
      }
      // Preserve a fixed bundle price as the campaign price; other pricing
      // models (pct/amount off, BXGY, tiered) leave it to per-item computation.
      await repo.attachCampaignBundle({
        client,
        brand,
        campaign_id,
        input: {
          bundle_id: target.bundle_id,
          campaign_bundle_price_ngn:
            offer.pricing_model === "fixed_bundle_price"
              ? (offer.bundle_price_ngn ?? null)
              : null,
          is_featured: false,
        },
      });
      results.push(target);
    }
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
