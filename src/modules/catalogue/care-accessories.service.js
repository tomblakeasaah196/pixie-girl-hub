"use strict";

const baseRepo = require("./catalogue.repo");
const repo = require("./care-accessories.repo");
const gate = require("./care-accessories.gate");
const vault = require("./cost_vault.service");
const events = require("./catalogue.events");
const outbox = require("../../shared/outbox/outbox");
const numbering = require("../../services/numbering.service");
const { computeAvailability } = require("./availability");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { AppError, NotFoundError } = require("../../utils/errors");

const slugify = (s) => String(s || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function slugFor(client, brand, name, code) {
  const base = slugify(name) || "care-product";
  return (await baseRepo.productSlugTaken({ client, brand, slug: base }))
    ? `${base}-${slugify(code)}` : base;
}

async function requireCategory(client, brand, id) {
  if (!id || !(await repo.categoryAllowed({ client, brand, id })))
    throw new AppError("INVALID_CARE_CATEGORY", "Pick an active Care & Accessories category", 422);
}

async function load(client, brand, id) {
  const p = await baseRepo.findProductById({ client, brand, id, includeOnHand: true });
  if (!p || p.catalogue_role !== "retail") throw new NotFoundError("Care & Accessories item");
  return p;
}

async function emitVariant(client, brand, product_id, v) {
  const payload = { brand, product_id, variant_id: v.variant_id, reorder_point: v.reorder_point };
  // Post-commit durable stock-level zero seeding; the in-process event is the
  // existing catalogue convention for soft realtime fan-out.
  events.emit("variant.created", payload);
  await outbox.enqueue(client, {
    business: brand, event_type: "variant.created", payload,
    dedup_key: `variant.created:${v.variant_id}`,
  });
}

function variantInput(v, index, product_code, name) {
  return {
    sku: v.sku || product_code,
    variant_name: v.label || (index === 0 ? "Standard" : name),
    barcode: v.barcode ?? null,
    price_storefront_ngn: v.price_storefront_ngn ?? null,
    price_storefront_usd: v.price_storefront_usd ?? null,
    price_pos_ngn: v.price_pos_ngn ?? null,
    price_pos_usd: v.price_pos_usd ?? null,
    reorder_point: v.reorder_point ?? 0,
    is_default: index === 0,
    is_active: true,
    display_order: index,
  };
}

async function createOne(client, brand, user, request_id, input, source) {
  await requireCategory(client, brand, input.category_id);
  const code = input.product_code || await numbering.nextProductCode(client, brand);
  const p = await repo.create({
    client, brand, user_id: user.user_id,
    input: {
      ...input, product_code: code, slug: await slugFor(client, brand, input.name, code),
      vat_rate: input.taxable ? input.vat_rate : null,
    },
  });
  for (const [index, entry] of input.variants.entries()) {
    const v = await baseRepo.createVariant({
      client, brand, product_id: p.product_id,
      input: variantInput(entry, index, code, p.name),
    });
    await emitVariant(client, brand, p.product_id, v);
  }
  await audit({
    business: brand, user_id: user.user_id, request_id,
    action_key: "catalogue.care.create", target_type: "product", target_id: p.product_id,
    after: { source, catalogue_role: "retail", status: "draft", sku_count: input.variants.length },
  });
  events.emit("product.created", { brand, id: p.product_id });
  return p;
}

async function create({ brand, user, request_id, input }) {
  await gate.requireEnabled(brand);
  return transaction((client) => createOne(client, brand, user, request_id, input, "authoring"));
}

async function importProducts({ brand, user, request_id, input }) {
  await gate.requireEnabled(brand);
  return transaction(async (client) => {
    const created = [];
    for (const row of input.products)
      created.push(await createOne(client, brand, user, request_id, row, "import"));
    return { created, count: created.length };
  });
}

async function clone({ brand, user, request_id, id, input }) {
  await gate.requireEnabled(brand);
  return transaction(async (client) => {
    const source = await load(client, brand, id); // never a base or cross-brand id
    const originals = (await baseRepo.listVariants({ client, brand, product_id: id }))
      .filter((v) => v.is_active && !v.is_deleted);
    if (originals.length !== input.variants.length)
      throw new AppError("CLONE_SKUS", "Enter one new exact SKU for each active source option", 422);
    const variants = originals.map((v, i) => {
      const next = input.variants[i];
      if (next.sku === v.sku)
        throw new AppError("CLONE_SKUS", "A clone must have new SKU identities", 422);
      return {
        sku: next.sku, label: next.label || v.variant_name,
        barcode: next.barcode || null, // barcodes aren't reused automatically
        price_storefront_ngn: v.price_storefront_ngn,
        price_storefront_usd: v.price_storefront_usd,
        price_pos_ngn: v.price_pos_ngn,
        price_pos_usd: v.price_pos_usd,
        reorder_point: v.reorder_point,
      };
    });
    return createOne(client, brand, user, request_id, {
      name: input.name, product_code: input.product_code,
      category_id: source.category_id,
      short_description: source.short_description,
      long_description: source.long_description,
      ingredients: source.ingredients, directions: source.directions,
      warnings: source.warnings, search_keywords: source.search_keywords,
      taxable: source.taxable, vat_rate: source.vat_rate,
      variants,
    }, "clone");
    // Stock, Cost Vault entries and photos intentionally do not copy.
  });
}

async function list({ brand, q, category_id, status, page = 1, page_size = 25 }) {
  await gate.requireEnabled(brand);
  const res = await baseRepo.findAllProducts({
    brand, page, page_size, offset: (page - 1) * page_size,
    filters: { catalogue_role: "retail", q, category_id, retail_status: status },
  });
  res.data = res.data.map((p) => ({
    ...p, availability: computeAvailability(p.stock_available, { base: p }),
  }));
  return res;
}

async function getOne({ brand, id }) {
  await gate.requireEnabled(brand);
  const p = await load(null, brand, id);
  const [variants, images, health] = await Promise.all([
    baseRepo.listVariants({ brand, product_id: id, includeOnHand: true }),
    baseRepo.listImages({ brand, product_id: id }),
    repo.costHealth({ brand, id }),
  ]);
  return {
    ...p,
    availability: computeAvailability(p.stock_available, { base: p }),
    // Do not send deprecated plaintext cost columns to ANY catalogue viewer,
    // including vault grantees. Cost has its own audited, encrypted endpoint.
    variants: vault.redactVariants(variants, false).map((v) => ({
      ...v, has_operational_cost: health.get(v.variant_id) || false,
      availability: computeAvailability(v.stock_available, { base: p }),
    })),
    images,
  };
}

async function categories({ brand }) {
  await gate.requireEnabled(brand);
  return repo.categories({ brand });
}

async function update({ brand, user, request_id, id, patch }) {
  await gate.requireEnabled(brand);
  return transaction(async (client) => {
    const before = await load(client, brand, id);
    if (patch.category_id !== undefined)
      await requireCategory(client, brand, patch.category_id);
    const merged = { ...patch };
    if (patch.taxable === false) merged.vat_rate = null;
    const effectiveTaxable = patch.taxable ?? before.taxable;
    const effectiveRate = merged.vat_rate !== undefined ? merged.vat_rate : before.vat_rate;
    const hasRate = effectiveRate !== null && effectiveRate !== undefined;
    if (effectiveTaxable && !hasRate)
      throw new AppError("TAX_RATE_REQUIRED", "Enter the approved VAT rate", 422);
    if (!effectiveTaxable && hasRate)
      throw new AppError("INVALID_TAX", "An exempt item cannot carry a VAT rate", 422);
    const changed = Object.keys(merged).length > 0;
    if (!changed) return before;
    const p = await repo.update({ client, brand, id, patch: merged });
    await audit({
      business: brand, user_id: user.user_id, request_id,
      action_key: "catalogue.care.update", target_type: "product", target_id: id,
      before: { status: before.retail_status }, after: { status: "draft", fields: Object.keys(merged) },
    });
    events.emit("product.updated", { brand, id });
    return p;
  });
}

async function publish({ brand, user, request_id, id }) {
  await gate.requireEnabled(brand);
  return transaction(async (client) => {
    const p = await load(client, brand, id);
    if (p.retail_status === "archived")
      throw new AppError("ITEM_ARCHIVED", "Restore this item to draft before publishing", 409);
    await requireCategory(client, brand, p.category_id);
    const ready = await repo.priceAndMediaReady({ client, brand, id });
    if (!ready.active_skus || ready.invalid_skus || !ready.images)
      throw new AppError("NOT_READY_TO_PUBLISH",
        "Publishing requires a photo and a valid storefront + staff NGN price on every active SKU", 422);
    const live = await repo.setStatus({ client, brand, id, status: "live" });
    await audit({
      business: brand, user_id: user.user_id, request_id,
      action_key: "catalogue.care.publish", target_type: "product", target_id: id,
      before: { status: p.retail_status }, after: { status: "live", public_sale_enabled: false },
    });
    events.emit("product.updated", { brand, id });
    return live;
  });
}

async function unpublish({ brand, user, request_id, id, archive = false }) {
  await gate.requireEnabled(brand);
  return transaction(async (client) => {
    const before = await load(client, brand, id);
    const status = archive ? "archived" : "draft";
    const p = await repo.setStatus({ client, brand, id, status });
    await audit({
      business: brand, user_id: user.user_id, request_id,
      action_key: "catalogue.care.unpublish", target_type: "product", target_id: id,
      before: { status: before.retail_status }, after: { status },
    });
    events.emit("product.updated", { brand, id });
    return p;
  });
}

async function addVariant({ brand, user, request_id, id, input }) {
  await gate.requireEnabled(brand);
  return transaction(async (client) => {
    const p = await load(client, brand, id);
    if (p.retail_status === "archived")
      throw new AppError("ITEM_ARCHIVED", "Restore to draft before editing", 409);
    if (!input.sku || !input.label)
      throw new AppError("SKU_REQUIRED", "A new option needs a label and exact SKU", 422);
    const current = await baseRepo.listVariants({ client, brand, product_id: id });
    const v = await baseRepo.createVariant({
      client, brand, product_id: id,
      input: variantInput(input, current.length, p.product_code, p.name),
    });
    await emitVariant(client, brand, id, v);
    await repo.setStatus({ client, brand, id, status: "draft" });
    await audit({
      business: brand, user_id: user.user_id, request_id,
      action_key: "catalogue.care.variant.create", target_type: "product_variant", target_id: v.variant_id,
      after: { product_id: id, sku: v.sku, status: "draft" },
    });
    return vault.redactVariant(v, false);
  });
}

async function updateVariant({ brand, user, request_id, id, variant_id, patch }) {
  await gate.requireEnabled(brand);
  return transaction(async (client) => {
    const p = await load(client, brand, id);
    const before = await baseRepo.getVariant({ client, brand, product_id: id, variant_id });
    if (!before) throw new NotFoundError("SKU");
    if (p.retail_status === "archived")
      throw new AppError("ITEM_ARCHIVED", "Restore to draft before editing", 409);
    if (patch.sku && patch.sku !== before.sku &&
        (p.published_at || await repo.hasSkuHistory({ client, brand, variant_id })))
      throw new AppError("SKU_LOCKED", "A published, stocked, purchased or previously moved SKU cannot be renamed; add a new option instead", 409);
    const { label, ...fields } = patch;
    if (label !== undefined) fields.variant_name = label;
    if (!Object.keys(fields).length) return vault.redactVariant(before, false);
    const v = await baseRepo.updateVariant({ client, brand, product_id: id, variant_id, patch: fields });
    await repo.setStatus({ client, brand, id, status: "draft" });
    await audit({
      business: brand, user_id: user.user_id, request_id,
      action_key: "catalogue.care.variant.update", target_type: "product_variant", target_id: variant_id,
      after: { product_id: id, fields: Object.keys(fields), status: "draft" },
    });
    events.emit("variant.updated", { brand, product_id: id, variant_id });
    return vault.redactVariant(v, false);
  });
}

async function deactivateVariant({ brand, user, request_id, id, variant_id }) {
  await gate.requireEnabled(brand);
  return transaction(async (client) => {
    await load(client, brand, id);
    const before = await baseRepo.getVariant({ client, brand, product_id: id, variant_id });
    if (!before) throw new NotFoundError("SKU");
    const deactivated = await repo.deactivate({ client, brand, product_id: id, variant_id });
    if (!deactivated)
      throw new AppError("SKU_IN_USE", "Default, stocked or open PO/shipment SKU cannot be deactivated", 409);
    await repo.setStatus({ client, brand, id, status: "draft" });
    await audit({
      business: brand, user_id: user.user_id, request_id,
      action_key: "catalogue.care.variant.deactivate", target_type: "product_variant", target_id: variant_id,
      after: { status: "inactive" },
    });
    return { deactivated: true };
  });
}

async function remove({ brand, user, request_id, id }) {
  await gate.requireEnabled(brand);
  return transaction(async (client) => {
    await load(client, brand, id);
    const p = await repo.trash({ client, brand, id });
    if (!p) throw new AppError("ITEM_IN_USE", "Move or count out stock and close open POs/shipments before deleting this item", 409);
    await audit({
      business: brand, user_id: user.user_id, request_id,
      action_key: "catalogue.care.delete", target_type: "product", target_id: id,
      after: { deleted: true },
    });
    events.emit("product.deleted", { brand, id });
    return { deleted: true };
  });
}

async function listTrash({ brand, page = 1, page_size = 25 }) {
  await gate.requireEnabled(brand);
  const { rows, total } = await repo.trashList({ brand, page_size, offset: (page - 1) * page_size });
  return { data: rows, meta: { page, page_size, total, has_more: page * page_size < total } };
}

async function restore({ brand, user, request_id, id }) {
  await gate.requireEnabled(brand);
  return transaction(async (client) => {
    const p = await repo.trashed({ client, brand, id });
    if (!p) throw new NotFoundError("Care & Accessories item");
    const slug = await baseRepo.productSlugTaken({ client, brand, slug: p.slug })
      ? `${p.slug}-restored-${Date.now().toString(36)}` : p.slug;
    const code = await baseRepo.productCodeTaken({ client, brand, code: p.product_code })
      ? `${p.product_code}-R${Date.now().toString(36)}` : p.product_code;
    const restored = await repo.restore({ client, brand, id, slug, product_code: code });
    await audit({
      business: brand, user_id: user.user_id, request_id,
      action_key: "catalogue.care.restore", target_type: "product", target_id: id,
      after: { status: "draft", slug, product_code: code },
    });
    events.emit("product.updated", { brand, id });
    return restored;
  });
}

module.exports = {
  create, importProducts, clone, list, getOne, categories, update, publish,
  unpublish, addVariant, updateVariant, deactivateVariant, remove, listTrash, restore,
};
