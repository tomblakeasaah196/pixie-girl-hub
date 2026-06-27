/**
 * Bundle offers (F-2 / PD §6.23.4).
 *
 * Admin CRUD over bundle_offers + their component products, plus a
 * priceBundle() primitive the storefront/POS uses to quote a bundle's discount
 * for a given component subtotal. buy_x_get_y / tiered_qty need line-level
 * context, so priceBundle returns their parameters for the caller to apply.
 *
 * Money via decimal.js — never float.
 */

"use strict";

const repo = require("./bundle.repo");
const collage = require("../../services/collage.service");
const { transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

// Wordmark shown on the generated collage's eyebrow, per brand.
const BRAND_NAMES = { pixiegirl: "Pixie Girl", faitlynhair: "Faitlyn Hair" };

/**
 * Bundles curate STYLED products. A base (stock-room) product / variant is
 * rejected unless an admin has flipped allow_base_in_collections_bundles in
 * the Catalogue config tab. Keeps "what goes in a bundle" unambiguous.
 */
async function assertComponentAllowed({ client, brand, component }) {
  const isBaseTarget =
    !component.styled_id && (component.product_id || component.variant_id);
  if (!isBaseTarget) return;
  const allow = await repo.allowBaseTargets({ client, brand });
  if (!allow) {
    throw new AppError(
      "BASE_NOT_ALLOWED_IN_BUNDLE",
      "Only styled products can be added to bundles.",
      422,
      {
        user_message:
          "Add a styled product. Base products are off for bundles — turn on “Allow base products in collections & bundles” in Catalogue settings if you need them.",
      },
    );
  }
}

async function createBundle({ brand, user, request_id, input }) {
  const components = input.components || [];
  if (components.length === 0)
    throw new AppError(
      "BUNDLE_EMPTY",
      "A bundle needs at least one component",
      400,
    );

  const bundle = await transaction(async (client) => {
    const b = await repo.createBundle({
      client,
      brand,
      input,
      user_id: user.user_id,
    });
    for (const comp of components) {
      await assertComponentAllowed({ client, brand, component: comp });
      await repo.addComponent({
        client,
        brand,
        bundle_id: b.bundle_id,
        component: comp,
      });
    }
    return b;
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.bundle.create",
    target_type: "bundle_offer",
    target_id: bundle.bundle_id,
    after: { bundle_code: bundle.bundle_code },
    request_id,
  });
  return repo.getById({ brand, id: bundle.bundle_id });
}

/**
 * Pure bundle economics for a component subtotal + unit count (decimal.js,
 * never float). Mirrors the per-model discount rules priceBundle() applies and
 * additionally resolves the FINAL price the customer pays + the saving — the
 * numbers the admin cards/editor render. Sharing this with priceBundle() keeps
 * "what the owner sees" identical to "what the customer is charged".
 *
 * `units` is the sum of component quantities (a qty-2 line counts twice) so
 * `amount_off` (₦ off EACH unit) scales exactly like checkout. The discount is
 * always clamped at the subtotal so a bundle can never price below zero.
 *
 * @returns {{ subtotal: Decimal, discount: Decimal, effective: Decimal, units: number }}
 */
function computeBundleEconomics({
  pricing_model,
  discount_value,
  bundle_price_ngn,
  subtotal_ngn,
  units,
}) {
  const subtotal = money(subtotal_ngn || 0);
  const unitCount = Math.max(1, Number(units) || 0);
  let discount = money(0);
  let effective = subtotal;

  switch (pricing_model) {
    case "fixed_bundle_price": {
      // The flat price is the source of truth; the "saving" is whatever it
      // undercuts the component subtotal by (0 when the bundle costs more).
      effective = money(bundle_price_ngn || 0);
      discount = subtotal.gt(effective) ? subtotal.minus(effective) : money(0);
      break;
    }
    case "pct_off": {
      discount = subtotal.times(money(discount_value || 0));
      if (discount.gt(subtotal)) discount = subtotal;
      effective = subtotal.minus(discount);
      break;
    }
    case "amount_off": {
      discount = money(discount_value || 0).times(unitCount);
      if (discount.gt(subtotal)) discount = subtotal;
      effective = subtotal.minus(discount);
      break;
    }
    default:
      // buy_x_get_y / tiered_qty need per-line context — not derivable from a
      // flat subtotal. Report no discount here; checkout uses priceBundle +
      // quantityBundleDiscount with the real lines.
      discount = money(0);
      effective = subtotal;
  }
  if (effective.lt(0)) effective = money(0);
  return { subtotal, discount, effective, units: unitCount };
}

/** Sum a component list to { subtotal, units } using each line's resolved
 *  unit price × quantity (the same figure listComponents/repo surface). */
function componentTotals(components = []) {
  let subtotal = 0;
  let units = 0;
  for (const c of components) {
    const qty = Number(c.quantity) || 1;
    subtotal += (Number(c.unit_price_ngn) || 0) * qty;
    units += qty;
  }
  return { subtotal, units };
}

/**
 * Attach the derived economics (component_subtotal_ngn, discount_ngn,
 * effective_price_ngn, unit_count) to a bundle row so every surface shows the
 * real price + saving without re-deriving it. The bundle's saved pricing config
 * (discount_value / bundle_price_ngn) stays the SSOT — this is computed from it,
 * so it can never drift out of sync with what's stored.
 */
function decorateBundle(bundle) {
  if (!bundle) return bundle;
  // getById carries components; list carries pre-aggregated subtotal/unit_count.
  const { subtotal, units } = bundle.components
    ? componentTotals(bundle.components)
    : {
        subtotal: Number(bundle.component_subtotal_ngn) || 0,
        units: Number(bundle.unit_count) || 0,
      };
  const econ = computeBundleEconomics({
    pricing_model: bundle.pricing_model,
    discount_value: bundle.discount_value,
    bundle_price_ngn: bundle.bundle_price_ngn,
    subtotal_ngn: subtotal,
    units,
  });
  return {
    ...bundle,
    component_subtotal_ngn: Number(toCurrencyString(econ.subtotal)),
    discount_ngn: Number(toCurrencyString(econ.discount)),
    effective_price_ngn: Number(toCurrencyString(econ.effective)),
    unit_count: econ.units,
  };
}

async function listBundles({ brand, only_active, storefront }) {
  const rows = await repo.list({ brand, only_active, storefront });
  return rows.map(decorateBundle);
}

async function getBundle({ brand, id }) {
  const b = await repo.getById({ brand, id });
  if (!b) throw new NotFoundError("Bundle");
  return decorateBundle(b);
}

async function updateBundle({ brand, user, request_id, id, patch }) {
  const b = await repo.update({ brand, id, patch });
  if (!b) throw new NotFoundError("Bundle");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.bundle.update",
    target_type: "bundle_offer",
    target_id: id,
    after: patch,
    request_id,
  });
  return repo.getById({ brand, id });
}

async function setBundleActive({ brand, user, request_id, id, is_active }) {
  const b = await repo.setActive({ brand, id, is_active });
  if (!b) throw new NotFoundError("Bundle");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: is_active
      ? "retention.bundle.activate"
      : "retention.bundle.deactivate",
    target_type: "bundle_offer",
    target_id: id,
    request_id,
  });
  return b;
}

async function addComponent({ brand, id, component }) {
  await getBundle({ brand, id }); // 404 if missing
  return transaction(async (client) => {
    await assertComponentAllowed({ client, brand, component });
    return repo.addComponent({ client, brand, bundle_id: id, component });
  });
}

async function removeComponent({ brand, id, bundle_product_id }) {
  const ok = await repo.removeComponent({
    brand,
    bundle_id: id,
    bundle_product_id,
  });
  if (!ok) throw new NotFoundError("Bundle component");
  return { removed: true };
}

async function deleteBundle({ brand, user, request_id, id }) {
  const ok = await repo.remove({ brand, id });
  if (!ok) throw new NotFoundError("Bundle");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.bundle.delete",
    target_type: "bundle_offer",
    target_id: id,
    request_id,
  });
  return { deleted: true };
}

/**
 * Quote a bundle's discount for a component subtotal (NGN).
 * @returns {{ pricing_model:string, discount_ngn?:string, bundle_price_ngn?:string, params?:object }}
 */
async function priceBundle({ brand, bundle_id, component_subtotal_ngn }) {
  const bundle = await repo.getById({ brand, id: bundle_id });
  if (!bundle) throw new NotFoundError("Bundle");
  if (!bundle.is_active)
    throw new AppError("BUNDLE_INACTIVE", "Bundle is not active", 409);

  // buy_x_get_y / tiered_qty need line-level context — return the params for
  // the caller (cart) to apply via quantityBundleDiscount.
  if (
    bundle.pricing_model !== "fixed_bundle_price" &&
    bundle.pricing_model !== "pct_off" &&
    bundle.pricing_model !== "amount_off"
  ) {
    return {
      pricing_model: bundle.pricing_model,
      discount_ngn: "0.00",
      params: {
        buy_quantity: bundle.buy_quantity,
        get_quantity: bundle.get_quantity,
        get_discount_pct: bundle.get_discount_pct,
        qty_tiers: bundle.qty_tiers,
      },
    };
  }

  // ₦ off EACH unit (owner directive) scales with the unit count — a 6-piece
  // bundle at "₦35k off each" saves ₦210k. Shared economics clamps at subtotal.
  const units = (bundle.components || []).reduce(
    (n, c) => n + (Number(c.quantity) || 1),
    0,
  );
  const { discount, effective } = computeBundleEconomics({
    pricing_model: bundle.pricing_model,
    discount_value: bundle.discount_value,
    bundle_price_ngn: bundle.bundle_price_ngn,
    subtotal_ngn: component_subtotal_ngn,
    units,
  });
  const out = {
    pricing_model: bundle.pricing_model,
    discount_ngn: toCurrencyString(discount),
  };
  // Preserve the historical shape: the fixed model also echoes its flat price.
  if (bundle.pricing_model === "fixed_bundle_price") {
    out.bundle_price_ngn = toCurrencyString(effective);
  }
  return out;
}

// ── Collage cover generation ────────────────────────────────
/** The curated title fonts the collage can render (picker source of truth). */
function listCollageFonts() {
  return collage.curatedTitleFonts();
}

/**
 * Render a bundle's collage cover from its component photos, store it, and
 * point hero_image_url at it. `settings` overrides merge over the bundle's
 * saved collage_settings, and the resolved settings (title/eyebrow/font) are
 * persisted so the cover can be re-edited or restyled later.
 */
async function renderBundleCover({ brand, user, request_id, bundle, settings }) {
  // Lazy require — documents.service pulls in the storage/event stack; keeping
  // it local mirrors pdf.service and avoids any require cycle at module load.
  const documents = require("../../shared/documents/documents.service");
  const brandRow = await repo.brandBranding({ brand });
  const merged = { ...(bundle.collage_settings || {}), ...(settings || {}) };
  const result = await collage.buildBundleCollage({
    brand,
    components: bundle.components || [],
    settings: merged,
    brandRow,
    brandName: BRAND_NAMES[brand],
  });
  const doc = await documents.store({
    brand,
    user_id: user ? user.user_id : null,
    buffer: result.buffer,
    filename: `bundle-${bundle.bundle_code}-collage.webp`,
    mime_type: result.mime,
    document_type: "cover_image",
    title: `${bundle.display_name} — collage`,
    reference_type: "bundle",
    reference_id: bundle.bundle_id,
    request_id,
  });
  const collage_settings = { ...merged, ...result.settings };
  await repo.update({
    brand,
    id: bundle.bundle_id,
    patch: {
      hero_image_url: doc.url,
      collage_settings,
      cover_is_generated: true,
    },
  });
  return { hero_image_url: doc.url, collage_settings, count: result.count };
}

async function generateCollageCover({ brand, user, request_id, id, settings }) {
  const bundle = await repo.getById({ brand, id });
  if (!bundle) throw new NotFoundError("Bundle");
  const res = await renderBundleCover({
    brand,
    user,
    request_id,
    bundle,
    settings,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.bundle.collage_generate",
    target_type: "bundle_offer",
    target_id: id,
    after: { pieces: res.count, font: res.collage_settings.font_family },
    request_id,
  });
  return getBundle({ brand, id });
}

/**
 * Restyle every already-generated collage with a shared look. Only the brand
 * style (font / eyebrow / palette) is applied — each bundle keeps its own
 * title. Bundles with fewer than 3 photographed products are skipped, not
 * failed, so one thin bundle can't abort the batch.
 */
async function applyCollageStyleToAll({ brand, user, request_id, settings }) {
  const style = {};
  for (const k of ["font_family", "eyebrow", "bg", "accent"]) {
    if (settings && settings[k] !== undefined) style[k] = settings[k];
  }
  const ids = await repo.listGeneratedIds({ brand });
  let updated = 0;
  let skipped = 0;
  for (const id of ids) {
    const bundle = await repo.getById({ brand, id });
    if (!bundle) continue;
    try {
      await renderBundleCover({
        brand,
        user,
        request_id,
        bundle,
        settings: style,
      });
      updated += 1;
    } catch (err) {
      if (err.code === "COLLAGE_TOO_FEW") {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.bundle.collage_apply_all",
    target_type: "bundle_offer",
    target_id: null,
    after: { updated, skipped },
    request_id,
  });
  return { updated, skipped };
}

/**
 * Discount for the quantity-based bundle models that need per-line context
 * (PURE — unit-testable, no DB):
 *   buy_x_get_y — for every (buy_quantity + get_quantity) eligible units, the
 *                 CHEAPEST get_quantity of them get get_discount_pct off (so the
 *                 customer keeps paying full price for the dearer items).
 *   tiered_qty  — the highest qty tier whose min_quantity ≤ total eligible units
 *                 sets the discount on the component subtotal.
 *
 * Percentages accept either a fraction (0.5) or a whole percent (50).
 *
 * @param {object} a
 * @param {string} a.pricing_model
 * @param {object} a.bundle   bundle row (buy_quantity/get_quantity/get_discount_pct/qty_tiers)
 * @param {Array}  a.lines    component lines: [{ quantity, unit_price_ngn }]
 * @param {Decimal|string|number} a.component_subtotal_ngn
 * @returns {import('decimal.js')} discount (>= 0, capped at the subtotal)
 */
function asFraction(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n <= 0) return money(0);
  return money(n > 1 ? n / 100 : n);
}

function quantityBundleDiscount({
  pricing_model,
  bundle = {},
  lines = [],
  component_subtotal_ngn = 0,
}) {
  const sub = money(component_subtotal_ngn || 0);
  let discount = money(0);

  if (pricing_model === "buy_x_get_y") {
    const buy = Math.max(0, parseInt(bundle.buy_quantity, 10) || 0);
    const get = Math.max(0, parseInt(bundle.get_quantity, 10) || 0);
    const pct = asFraction(bundle.get_discount_pct);
    if (buy > 0 && get > 0 && pct.gt(0)) {
      const units = [];
      for (const l of lines) {
        const q = Math.max(0, parseInt(l.quantity, 10) || 0);
        const unit = money(l.unit_price_ngn || 0);
        for (let i = 0; i < q; i++) units.push(unit);
      }
      const groupSize = buy + get;
      const discountedCount = Math.floor(units.length / groupSize) * get;
      if (discountedCount > 0) {
        units.sort((x, y) => (x.lt(y) ? -1 : x.gt(y) ? 1 : 0)); // cheapest first
        for (let i = 0; i < discountedCount; i++) {
          discount = discount.plus(units[i].times(pct));
        }
      }
    }
  } else if (pricing_model === "tiered_qty") {
    const tiers = Array.isArray(bundle.qty_tiers) ? bundle.qty_tiers : [];
    const totalQty = lines.reduce(
      (q, l) => q + Math.max(0, parseInt(l.quantity, 10) || 0),
      0,
    );
    let best = null;
    for (const row of tiers) {
      const minQ = parseInt(row.min_quantity ?? row.min_qty, 10) || 0;
      if (totalQty >= minQ && (!best || minQ > best.min))
        best = { min: minQ, row };
    }
    if (best) {
      const r = best.row;
      const pctRaw = r.discount_pct ?? r.discount_value_pct;
      const amtRaw = r.discount_amount_ngn ?? r.discount_value;
      if (pctRaw !== undefined && pctRaw !== null)
        discount = sub.times(asFraction(pctRaw));
      else if (amtRaw !== undefined && amtRaw !== null)
        discount = money(amtRaw);
    }
  }

  if (discount.gt(sub)) discount = sub;
  if (discount.lt(0)) discount = money(0);
  return discount;
}

module.exports = {
  createBundle,
  listBundles,
  getBundle,
  updateBundle,
  setBundleActive,
  addComponent,
  removeComponent,
  deleteBundle,
  priceBundle,
  computeBundleEconomics,
  quantityBundleDiscount,
  generateCollageCover,
  applyCollageStyleToAll,
  listCollageFonts,
};
