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
const { transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

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

const listBundles = ({ brand, only_active, storefront }) =>
  repo.list({ brand, only_active, storefront });

async function getBundle({ brand, id }) {
  const b = await repo.getById({ brand, id });
  if (!b) throw new NotFoundError("Bundle");
  return b;
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
  return transaction((client) =>
    repo.addComponent({ client, brand, bundle_id: id, component }),
  );
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

/**
 * Quote a bundle's discount for a component subtotal (NGN).
 * @returns {{ pricing_model:string, discount_ngn?:string, bundle_price_ngn?:string, params?:object }}
 */
async function priceBundle({ brand, bundle_id, component_subtotal_ngn }) {
  const bundle = await repo.getById({ brand, id: bundle_id });
  if (!bundle) throw new NotFoundError("Bundle");
  if (!bundle.is_active)
    throw new AppError("BUNDLE_INACTIVE", "Bundle is not active", 409);

  const sub = money(component_subtotal_ngn || 0);
  switch (bundle.pricing_model) {
    case "fixed_bundle_price": {
      const price = money(bundle.bundle_price_ngn || 0);
      const discount = sub.gt(price) ? sub.minus(price) : money(0);
      return {
        pricing_model: bundle.pricing_model,
        bundle_price_ngn: toCurrencyString(price),
        discount_ngn: toCurrencyString(discount),
      };
    }
    case "pct_off": {
      const discount = sub.times(money(bundle.discount_value || 0));
      return {
        pricing_model: bundle.pricing_model,
        discount_ngn: toCurrencyString(discount),
      };
    }
    case "amount_off": {
      let discount = money(bundle.discount_value || 0);
      if (discount.gt(sub)) discount = sub;
      return {
        pricing_model: bundle.pricing_model,
        discount_ngn: toCurrencyString(discount),
      };
    }
    default:
      // buy_x_get_y / tiered_qty need line-level context — return the params.
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
}

module.exports = {
  createBundle,
  listBundles,
  getBundle,
  updateBundle,
  setBundleActive,
  addComponent,
  removeComponent,
  priceBundle,
};
