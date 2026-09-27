/**
 * Catalogue (V2.2 §6.4/§6.9) — business logic.
 * Cross-module link: on variant create, emits `variant.created` so Stock
 * seeds a stock_levels row (single source of truth).
 */

"use strict";

const repo = require("./catalogue.repo");
const careRepo = require("./care-accessories.repo");
const careGate = require("./care-accessories.gate");
const vault = require("./cost_vault.service");
const events = require("./catalogue.events");
const outbox = require("../../shared/outbox/outbox");
const documents = require("../../shared/documents/documents.service");
const numbering = require("../../services/numbering.service");
const {
  compressUploadChecked,
  normalizeImageInput,
} = require("../../services/media-compression.service");
const { isolateSubject } = require("../../services/background-cutout.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");
const { computeAvailability } = require("./availability");

// Base products carry their own preorder fields, so `computeAvailability`'s
// `base` param is just the row itself — no synthesis needed (contrast
// styled.service.js, which copies those fields off a foreign base row).
const withAvailability = (p) => ({
  ...p,
  availability: computeAvailability(p.stock_available || 0, { base: p }),
});

// Kebab-case a product name for use as a URL slug.
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A collision-free slug: prefer the bare name slug, else disambiguate with the
// (globally unique) product code. Runs inside the caller's tx, so earlier
// inserts in a bulk batch are already visible to the probe.
async function uniqueSlug(client, brand, name, code) {
  const base = slugify(name) || "product";
  if (!(await repo.productSlugTaken({ client, brand, slug: base })))
    return base;
  return `${base}-${String(code).toLowerCase()}`;
}

const A = (
  brand,
  user_id,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
  before,
) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type,
    target_id,
    before,
    after,
    request_id,
  });

// ── Categories ───────────────────────────────────────────
const listCategories = ({ brand }) => repo.listCategories({ brand });
async function getCategory({ brand, id }) {
  const c = await repo.getCategory({ brand, id });
  if (!c) throw new NotFoundError("Category");
  return c;
}
async function createCategory({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const c = await repo.createCategory({ client, brand, input });
    await A(
      brand,
      user.user_id,
      "catalogue.category.create",
      "product_category",
      c.category_id,
      c,
      request_id,
    );
    events.emit("category.created", { brand, id: c.category_id });
    return c;
  });
}
async function updateCategory({ brand, user, request_id, id, patch }) {
  const before = await repo.getCategory({ brand, id });
  if (!before) throw new NotFoundError("Category");
  const c = await repo.updateCategory({ brand, id, patch });
  await A(
    brand,
    user.user_id,
    "catalogue.category.update",
    "product_category",
    id,
    c,
    request_id,
    before,
  );
  return c;
}
async function archiveCategory({ brand, user, request_id, id }) {
  const before = await repo.getCategory({ brand, id });
  if (!before) throw new NotFoundError("Category");
  await repo.archiveCategory({ brand, id });
  await A(
    brand,
    user.user_id,
    "catalogue.category.archive",
    "product_category",
    id,
    null,
    request_id,
    before,
  );
}

// ── Products ─────────────────────────────────────────────
async function listProducts({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  const res = await repo.findAllProducts({ brand, filters, page, page_size, offset });
  res.data = res.data.map(withAvailability);
  return res;
}
async function getProduct({ brand, id, user }) {
  const p = await repo.findProductById({ brand, id });
  if (!p || p.catalogue_role !== "base") throw new NotFoundError("Base product");
  const variants = await repo.listVariants({ brand, product_id: id });
  // Cost columns are stripped unless the caller holds vault access; a
  // missing/undefined user fails closed (no cost). See cost_vault.service.
  const visible = await vault.canSeeCost({ user, brand });
  // Each variant's own stock, but the PRODUCT's preorder policy — a variant
  // carries no preorder fields of its own (those live on the base row).
  const enrichedVariants = variants.map((v) => ({
    ...v,
    availability: computeAvailability(v.stock_available || 0, { base: p }),
  }));
  return {
    ...withAvailability(p),
    variants: vault.redactVariants(enrichedVariants, visible),
  };
}
async function createProduct({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    // Operators no longer type the code: allocate the next one from the
    // Document Numbering sequence (FLH001N / PXG001N) when not supplied, and
    // derive a unique slug from the name when not supplied.
    // A base product can never be storefront-published (storefront lives on
    // Styled products only).
    const prepared = denyBasePublish(input);
    if (!prepared.product_code) {
      prepared.product_code = await numbering.nextProductCode(client, brand);
    }
    if (!prepared.slug) {
      prepared.slug = await uniqueSlug(
        client,
        brand,
        prepared.name,
        prepared.product_code,
      );
    }
    const p = await repo.createProduct({
      client,
      brand,
      input: prepared,
      user_id: user.user_id,
    });
    await A(
      brand,
      user.user_id,
      "catalogue.product.create",
      "product",
      p.product_id,
      p,
      request_id,
    );
    events.emit("product.created", { brand, id: p.product_id });
    return p;
  });
}

// ── Wizard / clone: base + stock-bearing default variant ──

// Descriptive fields copied when a base is cloned (never code/slug/visibility).
const CLONE_PROD_FIELDS = [
  "category_id",
  "name",
  "short_description",
  "long_description",
  "texture_type",
  "lace_type",
  "hair_length_inches",
  "density",
  "cap_size",
  "primary_colour",
  "hair_origin",
  "care_instructions",
  "product_type",
  "lace_size_codes",
  "preorder_excluded",
  "production_lead_days",
];

/** Create the stock-bearing default variant for a wizard/clone base, carrying
 *  the prices + physical fields the wizard collects. */
function createDefaultVariantWithPrices(client, brand, product, variant = {}) {
  return repo.createVariant({
    client,
    brand,
    product_id: product.product_id,
    input: {
      sku: product.product_code,
      variant_name: product.name.slice(0, 160),
      variant_length_inches: product.hair_length_inches ?? undefined,
      variant_cap_size: variant.variant_cap_size ?? product.cap_size ?? undefined,
      price_storefront_ngn: variant.price_storefront_ngn ?? undefined,
      price_storefront_usd: variant.price_storefront_usd ?? undefined,
      price_wholesale_ngn: variant.price_wholesale_ngn ?? undefined,
      price_wholesale_usd: variant.price_wholesale_usd ?? undefined,
      weight_g: variant.weight_g ?? undefined,
      is_default: true,
      is_active: true,
    },
  });
}

/** Audit + emit product.created / variant.created (+ outbox for the stock
 *  seed) for a freshly created base + its default variant. */
async function emitBaseCreated(client, brand, request_id, user, product, dv, source) {
  await A(
    brand,
    user.user_id,
    "catalogue.product.create",
    "product",
    product.product_id,
    { ...product, source },
    request_id,
  );
  events.emit("product.created", { brand, id: product.product_id });
  events.emit("variant.created", {
    brand,
    product_id: product.product_id,
    variant_id: dv.variant_id,
    reorder_point: dv.reorder_point,
  });
  await outbox.enqueue(client, {
    business: brand,
    event_type: "variant.created",
    payload: {
      brand,
      product_id: product.product_id,
      variant_id: dv.variant_id,
      reorder_point: dv.reorder_point,
    },
    dedup_key: `variant.created:${dv.variant_id}`,
  });
}

/** Create one base + default variant inside an open transaction. */
async function createOneBase(client, brand, request_id, user, spec, source) {
  const { variant = {}, ...prodFields } = spec;
  const prepared = denyBasePublish(stripUndefined(prodFields));
  prepared.product_code = await numbering.nextProductCode(client, brand);
  prepared.slug = await uniqueSlug(
    client,
    brand,
    prepared.name,
    prepared.product_code,
  );
  const product = await repo.createProduct({
    client,
    brand,
    input: prepared,
    user_id: user.user_id,
  });
  const dv = await createDefaultVariantWithPrices(client, brand, product, variant);
  await emitBaseCreated(client, brand, request_id, user, product, dv, source);
  return {
    product_id: product.product_id,
    product_code: product.product_code,
    name: product.name,
    cap_size: product.cap_size,
    variant_id: dv.variant_id,
  };
}

/**
 * Create one OR MANY base products in a single transaction, each with its
 * stock-bearing default variant. Powers the base-product wizard (a whole size
 * run at once). Each spec is a full base plus an optional `variant` sub-object
 * for prices/weight.
 */
async function createBaseProducts({ brand, user, request_id, input }) {
  const specs = input.products || [];
  return transaction(async (client) => {
    const created = [];
    for (const spec of specs) {
      created.push(
        await createOneBase(client, brand, request_id, user, spec, "wizard"),
      );
    }
    return { created, count: created.length };
  });
}

/** Read a source base's descriptive fields + its default variant's prices,
 *  for cloning. */
async function loadCloneSource(client, brand, id) {
  const src = await repo.findProductById({ client, brand, id });
  if (!src || src.is_deleted || src.catalogue_role !== "base")
    throw new NotFoundError("Base product");
  const srcVariant = await repo.getDefaultVariant({ client, brand, product_id: id });
  const fields = {};
  for (const c of CLONE_PROD_FIELDS) {
    if (src[c] !== null && src[c] !== undefined) fields[c] = src[c];
  }
  const variant = srcVariant
    ? {
        price_storefront_ngn: srcVariant.price_storefront_ngn,
        price_storefront_usd: srcVariant.price_storefront_usd,
        price_wholesale_ngn: srcVariant.price_wholesale_ngn,
        price_wholesale_usd: srcVariant.price_wholesale_usd,
        weight_g: srcVariant.weight_g,
        variant_cap_size: srcVariant.variant_cap_size,
      }
    : {};
  return { fields, variant };
}

/**
 * Clone a base product (+ its default variant) into a brand-new base. Copies
 * every descriptive field and the default variant's prices, allocates a fresh
 * code/slug, and keeps the same name unless overridden (products aren't
 * name-unique). Used by the "Clone" button.
 */
async function cloneProduct({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const { fields, variant } = await loadCloneSource(client, brand, id);
    return createOneBase(
      client,
      brand,
      request_id,
      user,
      { ...fields, variant },
      "clone",
    );
  });
}

/**
 * "Create other sizes": clone a base into sibling bases for each requested
 * size. Each size supplies a name (family + size suffix) and cap_size; every
 * other field + the prices are inherited from the source. One transaction.
 */
async function createSiblingSizes({ brand, user, request_id, id, sizes }) {
  return transaction(async (client) => {
    const { fields, variant } = await loadCloneSource(client, brand, id);
    const created = [];
    for (const s of sizes || []) {
      const spec = {
        ...fields,
        name: s.name,
        cap_size: s.cap_size ?? fields.cap_size,
        variant: { ...variant, variant_cap_size: s.cap_size ?? variant.variant_cap_size },
      };
      created.push(
        await createOneBase(client, brand, request_id, user, spec, "sibling_size"),
      );
    }
    return { created, count: created.length };
  });
}

/**
 * Bulk import base products from a spreadsheet (Excel/CSV parsed client-side).
 *
 * The template carries the full base spec plus money: cost (₦) and wholesale
 * price (₦). UPSERT by exact full name — a row whose name already exists
 * UPDATES that product (and its default variant's price/cost) instead of
 * creating a duplicate, so re-importing a priced sheet sets every price in one
 * pass. Cost is only written for Cost-Vault holders; for everyone else the cost
 * column is ignored (price stays — wholesale is the operational, non-secret
 * number). Each row reports a status: created / updated / up_to_date.
 * The whole batch runs in one transaction.
 */
async function bulkImportProducts({ brand, user, request_id, rows }) {
  const canCost = await vault.canSeeCost({ user, brand });
  return transaction(async (client) => {
    const results = [];
    let costIgnored = false;

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const category_id = await resolveCategoryId(
        client,
        brand,
        row.category,
        user,
      );

      // Full base-product fields present in this row (undefined = not supplied).
      const fields = {
        texture_type: row.texture_type,
        lace_type: row.lace_type,
        hair_length_inches: row.hair_length_inches,
        density: row.density,
        cap_size: row.cap_size,
        primary_colour: row.primary_colour,
        hair_origin: row.hair_origin,
        short_description: row.short_description,
        category_id,
      };
      const wantsCost = row.cost_ngn !== undefined && row.cost_ngn !== null;
      if (wantsCost && !canCost) costIgnored = true;

      const existing = await repo.findProductByName({
        client,
        brand,
        name: row.name,
      });

      if (existing) {
        // ── UPDATE the matched product (overwrite changed fields only) ──
        const patch = {};
        for (const [k, v] of Object.entries(fields)) {
          if (v === undefined) continue;
          if (String(existing[k] ?? "") !== String(v)) patch[k] = v;
        }
        const product = Object.keys(patch).length
          ? await repo.updateProduct({
              client,
              brand,
              id: existing.product_id,
              patch,
            })
          : existing;

        let variant = await repo.getDefaultVariant({
          client,
          brand,
          product_id: existing.product_id,
        });
        if (!variant) {
          variant = await createDefaultVariant(client, brand, product, row);
        }

        const vpatch = {};
        if (
          row.wholesale_price_ngn !== undefined &&
          Number(variant.price_wholesale_ngn ?? NaN) !==
            Number(row.wholesale_price_ngn)
        ) {
          vpatch.price_wholesale_ngn = row.wholesale_price_ngn;
        }
        if (
          row.weight_g !== undefined &&
          Number(variant.weight_g ?? NaN) !== Number(row.weight_g)
        ) {
          vpatch.weight_g = row.weight_g;
        }
        if (Object.keys(vpatch).length) {
          variant = await repo.updateVariant({
            client,
            brand,
            product_id: existing.product_id,
            variant_id: variant.variant_id,
            patch: vpatch,
          });
        }

        let costApplied = false;
        if (wantsCost && canCost) {
          await vault.setCostTx({
            client,
            brand,
            user,
            request_id,
            variant_id: variant.variant_id,
            input: { cost_ngn: row.cost_ngn, cost_source: "import" },
          });
          costApplied = true;
        }

        const changed =
          Object.keys(patch).length > 0 ||
          Object.keys(vpatch).length > 0 ||
          costApplied;
        if (changed) {
          await A(
            brand,
            user.user_id,
            "catalogue.product.update",
            "product",
            product.product_id,
            { source: "bulk_import" },
            request_id,
            existing,
          );
          events.emit("product.updated", { brand, id: product.product_id });
        }
        results.push({
          row: idx + 1,
          status: changed ? "updated" : "up_to_date",
          product_id: product.product_id,
          product_code: product.product_code,
          name: product.name,
          variant_id: variant.variant_id,
          cost_applied: costApplied,
        });
      } else {
        // ── CREATE a new base product + its default variant ──
        const product_code = await numbering.nextProductCode(client, brand);
        const slug = await uniqueSlug(client, brand, row.name, product_code);
        const product = await repo.createProduct({
          client,
          brand,
          user_id: user.user_id,
          input: denyBasePublish({
            product_code,
            name: row.name,
            slug,
            product_type: "physical",
            ...stripUndefined(fields),
          }),
        });
        const variant = await createDefaultVariant(client, brand, product, row);

        let costApplied = false;
        if (wantsCost && canCost) {
          await vault.setCostTx({
            client,
            brand,
            user,
            request_id,
            variant_id: variant.variant_id,
            input: { cost_ngn: row.cost_ngn, cost_source: "import" },
          });
          costApplied = true;
        }

        await A(
          brand,
          user.user_id,
          "catalogue.product.create",
          "product",
          product.product_id,
          { ...product, source: "bulk_import" },
          request_id,
        );
        events.emit("product.created", { brand, id: product.product_id });
        events.emit("variant.created", {
          brand,
          product_id: product.product_id,
          variant_id: variant.variant_id,
          reorder_point: variant.reorder_point,
        });
        await outbox.enqueue(client, {
          business: brand,
          event_type: "variant.created",
          payload: {
            brand,
            product_id: product.product_id,
            variant_id: variant.variant_id,
            reorder_point: variant.reorder_point,
          },
          dedup_key: `variant.created:${variant.variant_id}`,
        });

        results.push({
          row: idx + 1,
          status: "created",
          product_id: product.product_id,
          product_code: product.product_code,
          name: product.name,
          variant_id: variant.variant_id,
          cost_applied: costApplied,
        });
      }
    }

    const counts = results.reduce(
      (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
      {},
    );
    return {
      count: results.length,
      created: results,
      counts,
      cost_permitted: canCost,
      cost_ignored: costIgnored,
    };
  });
}

/** Drop undefined keys so an INSERT never sends `undefined`. */
function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * A base product is the China-origin, stock-bearing record — it must NEVER be
 * publishable to the storefront (only Styled products carry a storefront
 * lifecycle). The validators already reject these keys, but we also neutralise
 * them here so no path (bulk import, future callers, legacy payloads) can ever
 * flip a base product live. `is_visible_storefront` is pinned to false on
 * write; any channel-visibility hint is dropped.
 */
function denyBasePublish(input) {
  const out = { ...input };
  delete out.visible_on_channels;
  out.is_visible_storefront = false;
  return out;
}

/** Create the stock-bearing default variant for an imported product. */
function createDefaultVariant(client, brand, product, row) {
  return repo.createVariant({
    client,
    brand,
    product_id: product.product_id,
    input: {
      sku: product.product_code,
      variant_name: row.name.slice(0, 160),
      variant_length_inches: row.hair_length_inches ?? undefined,
      variant_colour: row.primary_colour ?? undefined,
      variant_density: row.density ?? undefined,
      variant_cap_size: row.cap_size ?? undefined,
      weight_g: row.weight_g ?? undefined,
      price_wholesale_ngn: row.wholesale_price_ngn ?? undefined,
      is_default: true,
      is_active: true,
    },
  });
}

/** Resolve a category NAME to an id, creating it (with a unique slug) if new. */
async function resolveCategoryId(client, brand, name, user) {
  if (!name) return undefined;
  const existing = await repo.findCategoryByName({ client, brand, name });
  if (existing) return existing.category_id;
  const base = slugify(name) || "category";
  let slug = base;
  let n = 2;
  while (await repo.categorySlugTaken({ client, brand, slug }))
    slug = `${base}-${n++}`;
  const created = await repo.createCategory({
    client,
    brand,
    input: { name, slug },
  });
  await A(
    brand,
    user.user_id,
    "catalogue.category.create",
    "product_category",
    created.category_id,
    { source: "bulk_import" },
    undefined,
  );
  return created.category_id;
}
async function updateProduct({ brand, user, request_id, id, patch }) {
  const before = await repo.findProductById({ brand, id });
  if (!before || before.catalogue_role !== "base") throw new NotFoundError("Base product");
  // Never allow an update to publish a base product to the storefront.
  const p = await repo.updateProduct({
    brand,
    id,
    patch: denyBasePublish(patch),
  });
  await A(
    brand,
    user.user_id,
    "catalogue.product.update",
    "product",
    id,
    p,
    request_id,
    before,
  );
  events.emit("product.updated", { brand, id });
  return p;
}
async function deleteProduct({ brand, user, request_id, id }) {
  const ok = await repo.softDeleteProduct({ brand, id });
  if (!ok) throw new NotFoundError("Product");
  await A(
    brand,
    user.user_id,
    "catalogue.product.delete",
    "product",
    id,
    null,
    request_id,
  );
  events.emit("product.deleted", { brand, id });
}

// ── Trash + Restore ──────────────────────────────────────
function listTrash({ brand, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listTrashedProducts({ brand, page, page_size, offset });
}

// Short disambiguator for the rare case where a freed name was reused by a
// new product before the old one is restored.
const restoreSuffix = () => Date.now().toString(36).slice(-4);

async function restoreProduct({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const trashed = await repo.getTrashedProductById({ client, brand, id });
    if (!trashed) throw new NotFoundError("Product");
    let slug = null;
    let product_code = null;
    let renamed = false;
    if (await repo.productSlugTaken({ client, brand, slug: trashed.slug })) {
      slug = `${trashed.slug}-restored-${restoreSuffix()}`;
      renamed = true;
    }
    if (
      await repo.productCodeTaken({ client, brand, code: trashed.product_code })
    ) {
      product_code = `${trashed.product_code}-R${restoreSuffix()}`;
      renamed = true;
    }
    const p = await repo.restoreProduct({
      client,
      brand,
      id,
      slug,
      product_code,
    });
    await A(
      brand,
      user.user_id,
      "catalogue.product.restore",
      "product",
      id,
      { renamed, slug: p.slug, product_code: p.product_code },
      request_id,
      trashed,
    );
    events.emit("product.updated", { brand, id });
    return { ...p, renamed };
  });
}

// ── Variants ─────────────────────────────────────────────
async function listVariants({ brand, id, user }) {
  const exists = await repo.findProductById({ brand, id });
  if (!exists || exists.catalogue_role !== "base")
    throw new NotFoundError("Base product");
  const variants = await repo.listVariants({ brand, product_id: id });
  const visible = await vault.canSeeCost({ user, brand });
  return vault.redactVariants(variants, visible);
}
async function addVariant({ brand, user, request_id, id, input }) {
  const created = await transaction(async (client) => {
    const product = await repo.findProductById({ client, brand, id });
    if (!product || product.catalogue_role !== "base")
      throw new NotFoundError("Base product");
    const v = await repo.createVariant({
      client,
      brand,
      product_id: id,
      input,
    });
    await A(
      brand,
      user.user_id,
      "catalogue.variant.create",
      "product_variant",
      v.variant_id,
      v,
      request_id,
    );
    // SSOT hook → Stock seeds a stock_levels row for this variant. Durable +
    // POST-COMMIT via the outbox (H-2): the variant row is committed before the
    // seed runs, removing the prior pre-commit ordering risk. The in-process
    // emit stays for soft realtime fan-out.
    events.emit("variant.created", {
      brand,
      product_id: id,
      variant_id: v.variant_id,
      reorder_point: v.reorder_point,
    });
    await outbox.enqueue(client, {
      business: brand,
      event_type: "variant.created",
      payload: {
        brand,
        product_id: id,
        variant_id: v.variant_id,
        reorder_point: v.reorder_point,
      },
      dedup_key: `variant.created:${v.variant_id}`,
    });
    return v;
  });
  const visible = await vault.canSeeCost({ user, brand });
  return vault.redactVariant(created, visible);
}
async function updateVariant({
  brand,
  user,
  request_id,
  id,
  variant_id,
  patch,
}) {
  const product = await repo.findProductById({ brand, id });
  if (!product || product.catalogue_role !== "base")
    throw new NotFoundError("Base product");
  const before = await repo.getVariant({ brand, product_id: id, variant_id });
  if (!before) throw new NotFoundError("Variant");
  const v = await repo.updateVariant({
    brand,
    product_id: id,
    variant_id,
    patch,
  });
  await A(
    brand,
    user.user_id,
    "catalogue.variant.update",
    "product_variant",
    variant_id,
    v,
    request_id,
    before,
  );
  events.emit("variant.updated", { brand, product_id: id, variant_id });
  const visible = await vault.canSeeCost({ user, brand });
  return vault.redactVariant(v, visible);
}
async function removeVariant({ brand, user, request_id, id, variant_id }) {
  const product = await repo.findProductById({ brand, id });
  if (!product || product.catalogue_role !== "base")
    throw new NotFoundError("Base product");
  const ok = await repo.deactivateVariant({
    brand,
    product_id: id,
    variant_id,
  });
  if (!ok) throw new NotFoundError("Variant");
  await A(
    brand,
    user.user_id,
    "catalogue.variant.deactivate",
    "product_variant",
    variant_id,
    null,
    request_id,
  );
}

// ── Collections (+ rules + members) ──────────────────────
const listCollections = ({ brand }) => repo.listCollections({ brand });
async function getCollection({ brand, id }) {
  const c = await repo.getCollection({ brand, id });
  if (!c) throw new NotFoundError("Collection");
  c.rules = await repo.listCollectionRules({ brand, collection_id: id });
  c.members = await repo.listCollectionMembers({ brand, collection_id: id });
  return c;
}
async function createCollection({ brand, user, request_id, input }) {
  const c = await repo.createCollection({ brand, input });
  await A(
    brand,
    user.user_id,
    "catalogue.collection.create",
    "product_collection",
    c.collection_id,
    c,
    request_id,
  );
  events.emit("collection.created", { brand, id: c.collection_id });
  return c;
}
async function updateCollection({ brand, user, request_id, id, patch }) {
  const before = await repo.getCollection({ brand, id });
  if (!before) throw new NotFoundError("Collection");
  const c = await repo.updateCollection({ brand, id, patch });
  await A(
    brand,
    user.user_id,
    "catalogue.collection.update",
    "product_collection",
    id,
    c,
    request_id,
    before,
  );
  return c;
}
async function archiveCollection({ brand, user, request_id, id }) {
  const before = await repo.getCollection({ brand, id });
  if (!before) throw new NotFoundError("Collection");
  await repo.archiveCollection({ brand, id });
  await A(
    brand,
    user.user_id,
    "catalogue.collection.archive",
    "product_collection",
    id,
    null,
    request_id,
    before,
  );
}
async function ensureCollection({ brand, id }) {
  const c = await repo.getCollection({ brand, id });
  if (!c) throw new NotFoundError("Collection");
  return c;
}
async function addCollectionRule({ brand, user, request_id, id, input }) {
  await ensureCollection({ brand, id });
  const r = await repo.addCollectionRule({ brand, collection_id: id, input });
  await A(
    brand,
    user.user_id,
    "catalogue.collection.rule.add",
    "product_collection",
    id,
    r,
    request_id,
  );
  return r;
}
async function removeCollectionRule({ brand, user, request_id, id, rule_id }) {
  const ok = await repo.removeCollectionRule({
    brand,
    collection_id: id,
    rule_id,
  });
  if (!ok) throw new NotFoundError("Collection rule");
  await A(
    brand,
    user.user_id,
    "catalogue.collection.rule.remove",
    "product_collection",
    id,
    { rule_id },
    request_id,
  );
}
async function addCollectionMember({ brand, user, request_id, id, input }) {
  await ensureCollection({ brand, id });
  // Collections curate STYLED products only — a base product never joins one.
  const m = await repo.addCollectionMember({
    brand,
    collection_id: id,
    styled_id: input.styled_id,
    display_order: input.display_order,
    user_id: user.user_id,
  });
  await A(
    brand,
    user.user_id,
    "catalogue.collection.member.add",
    "product_collection",
    id,
    m,
    request_id,
  );
  events.emit("collection.updated", { brand, id });
  return m;
}
async function removeCollectionMember({
  brand,
  user,
  request_id,
  id,
  styled_id,
}) {
  const ok = await repo.removeCollectionMember({
    brand,
    collection_id: id,
    styled_id,
  });
  if (!ok) throw new NotFoundError("Collection member");
  await A(
    brand,
    user.user_id,
    "catalogue.collection.member.remove",
    "product_collection",
    id,
    { styled_id },
    request_id,
  );
}

// ── Images (every file routes through the Documents gateway, §6.13) ──
async function listImages({ brand, id }) {
  const p = await repo.findProductById({ brand, id });
  if (!p) throw new NotFoundError("Product");
  if (p.catalogue_role === "retail") await careGate.requireEnabled(brand);
  return repo.listImages({ brand, product_id: id });
}
async function addImage({ brand, user, request_id, id, file, meta }) {
  const product = await repo.findProductById({ brand, id });
  if (!product) throw new NotFoundError("Product");
  if (meta.variant_id && !(await repo.getVariant({
    brand, product_id: id, variant_id: meta.variant_id,
  }))) throw new AppError("INVALID_IMAGE_VARIANT", "Image SKU must belong to this product", 422);
  // Re-encode oversized/heavy images to high-quality, smaller bytes (and
  // convert HEIC → JPEG) before they hit storage — keeps galleries crisp
  // without bloating the CDN. Size is gated on both sides of compression;
  // see media-compression.service.js.
  const shrunk = await compressUploadChecked(file);
  return transaction(async (client) => {
    const doc = await documents.store({
      client,
      brand,
      user_id: user.user_id,
      buffer: shrunk.buffer,
      filename: shrunk.filename,
      mime_type: shrunk.mime_type,
      document_type: "product_image",
      title: meta.alt_text || file.originalname,
      reference_type: "product",
      reference_id: id,
      request_id,
    });
    const image = await repo.addImage({
      client,
      brand,
      image: {
        product_id: id,
        variant_id: meta.variant_id,
        file_path: doc.file_path,
        cdn_url: doc.url,
        alt_text: meta.alt_text,
        caption: meta.caption,
        display_order: meta.display_order,
        is_primary: meta.is_primary,
        file_size_bytes: doc.file_size_bytes,
        uploaded_by: user.user_id,
      },
    });
    if (product.catalogue_role === "retail")
      await careRepo.syncPrimaryImage({ client, brand, id });
    await A(
      brand,
      user.user_id,
      "catalogue.image.add",
      "product_image",
      image.image_id,
      { document_id: doc.document_id },
      request_id,
    );
    events.emit("image.added", {
      brand,
      product_id: id,
      image_id: image.image_id,
    });
    return { ...image, document_id: doc.document_id };
  });
}

/**
 * Generic cover-image upload (collections / bundles). Compresses + stores the
 * file and hands back a CDN url — the caller saves it onto the entity's
 * hero_image_url. No product_images row: a cover isn't tied to a product.
 */
async function uploadCoverImage({
  brand,
  user,
  request_id,
  file,
  reference_type,
  reference_id,
}) {
  const shrunk = await compressUploadChecked(file);
  const doc = await documents.store({
    brand,
    user_id: user.user_id,
    buffer: shrunk.buffer,
    filename: shrunk.filename,
    mime_type: shrunk.mime_type,
    document_type: "cover_image",
    title: file.originalname,
    reference_type: reference_type || null,
    reference_id: reference_id || null,
    request_id,
  });
  return { cdn_url: doc.url, document_id: doc.document_id };
}

/**
 * Branded background — step 1: isolate a just-dropped catalogue image's subject
 * onto transparency so the upload modal can composite it over a brand colour
 * (default = the active brand's; other brand colours chosen from a dropdown).
 *
 * Returns the cut-out inline as a data URL (no temp file to reap) plus which
 * engine ran, so the UI can note when only the basic keyer was available. The
 * client does the colour compositing on a canvas, keeping colour switches
 * instant and the final upload flowing through the normal image endpoints.
 */
async function imageCutout({ file }) {
  if (!file || !file.buffer) {
    throw new AppError("NO_FILE", "An image upload is required", 422);
  }
  // HEIC (default iPhone format) → JPEG so sharp can decode it; other images
  // pass through untouched. Then isolate the subject.
  const norm = await normalizeImageInput(file);
  const res = await isolateSubject(norm.buffer);
  return {
    cutout_data_url: `data:image/png;base64,${res.buffer.toString("base64")}`,
    engine: res.engine,
    keyed: res.keyed,
    warning: res.warning,
    width: res.width,
    height: res.height,
  };
}

async function updateImage({ brand, user, request_id, id, image_id, patch }) {
  return transaction(async (client) => {
    const product = await repo.findProductById({ client, brand, id });
    if (!product) throw new NotFoundError("Product");
    if (patch.variant_id && !(await repo.getVariant({
      client, brand, product_id: id, variant_id: patch.variant_id,
    }))) throw new AppError("INVALID_IMAGE_VARIANT", "Image SKU must belong to this product", 422);
    const img = await repo.updateImage({ client, brand, product_id: id, image_id, patch });
    if (!img) throw new NotFoundError("Image");
    if (product.catalogue_role === "retail")
      await careRepo.syncPrimaryImage({ client, brand, id });
    await A(brand, user.user_id, "catalogue.image.update", "product_image", image_id, img, request_id);
    return img;
  });
}
async function removeImage({ brand, user, request_id, id, image_id }) {
  return transaction(async (client) => {
    const product = await repo.findProductById({ client, brand, id });
    if (!product) throw new NotFoundError("Product");
    const ok = await repo.removeImage({ client, brand, product_id: id, image_id });
    if (!ok) throw new NotFoundError("Image");
    if (product.catalogue_role === "retail")
      await careRepo.syncPrimaryImage({ client, brand, id });
    await A(brand, user.user_id, "catalogue.image.remove", "product_image", image_id, null, request_id);
  });
}

// ── Videos (embed; direct_upload also goes through Documents) ──
async function listVideos({ brand, id }) {
  await getProduct({ brand, id });
  return repo.listVideos({ brand, product_id: id });
}
async function addVideo({ brand, user, request_id, id, input }) {
  await getProduct({ brand, id });
  const v = await repo.addVideo({
    brand,
    video: { ...input, product_id: id, added_by: user.user_id },
  });
  await A(
    brand,
    user.user_id,
    "catalogue.video.add",
    "product_video",
    v.video_id,
    v,
    request_id,
  );
  return v;
}
async function removeVideo({ brand, user, request_id, id, video_id }) {
  const ok = await repo.removeVideo({ brand, product_id: id, video_id });
  if (!ok) throw new NotFoundError("Video");
  await A(
    brand,
    user.user_id,
    "catalogue.video.remove",
    "product_video",
    video_id,
    null,
    request_id,
  );
}

// ── Self-hosted UGC video (W-13) ─────────────────────────
/** Ready, non-archived self-hosted video assets available to attach. */
function listMediaVideoLibrary({ brand }) {
  return repo.listReadyVideoAssets({ brand });
}

/**
 * Attach a self-hosted media asset to a product as a video. Reuses the
 * product_videos row with source='direct_upload': external_ref holds the
 * media_asset_id, embed_url holds the storage path the media server serves.
 */
async function attachVideoFromMedia({ brand, user, request_id, id, input }) {
  await getProduct({ brand, id });
  const asset = await repo.getMediaAsset({
    brand,
    asset_id: input.media_asset_id,
  });
  if (!asset) throw new NotFoundError("Media asset");
  if (asset.asset_kind !== "video")
    throw new AppError("NOT_A_VIDEO", "Media asset is not a video", 422);
  if (asset.processing_status !== "ready")
    throw new AppError(
      "ASSET_NOT_READY",
      `Media asset is '${asset.processing_status}', not ready`,
      409,
    );
  const v = await repo.addVideo({
    brand,
    video: {
      product_id: id,
      source: "direct_upload",
      external_ref: asset.asset_id,
      embed_url: asset.storage_path,
      thumbnail_url: asset.poster_path || asset.thumbnail_path || null,
      title: input.title || null,
      caption: input.caption || asset.caption || null,
      duration_seconds:
        asset.duration_sec !== null && asset.duration_sec !== undefined
          ? Math.round(Number(asset.duration_sec))
          : null,
      display_order: input.display_order,
      is_primary: input.is_primary,
      added_by: user.user_id,
    },
  });
  await A(
    brand,
    user.user_id,
    "catalogue.video.attach_media",
    "product_video",
    v.video_id,
    v,
    request_id,
  );
  return v;
}

// ── SEO ──────────────────────────────────────────────────
async function getSeo({ brand, id }) {
  await getProduct({ brand, id });
  return (await repo.getSeo({ brand, product_id: id })) || { product_id: id };
}
async function upsertSeo({ brand, user, request_id, id, patch }) {
  await getProduct({ brand, id });
  const seo = await repo.upsertSeo({ brand, product_id: id, patch });
  await A(
    brand,
    user.user_id,
    "catalogue.seo.upsert",
    "product",
    id,
    seo,
    request_id,
  );
  return seo;
}

// ── Attribute values ─────────────────────────────────────
async function listAttributeValues({ brand, id }) {
  await getProduct({ brand, id });
  return repo.listAttributeValues({ brand, product_id: id });
}
async function setAttributeValue({ brand, user, request_id, id, input }) {
  await getProduct({ brand, id });
  const v = await repo.upsertAttributeValue({ brand, product_id: id, input });
  await A(
    brand,
    user.user_id,
    "catalogue.attribute.set",
    "product",
    id,
    v,
    request_id,
  );
  return v;
}
async function removeAttributeValue({ brand, user, request_id, id, field_id }) {
  const ok = await repo.removeAttributeValue({
    brand,
    product_id: id,
    field_id,
  });
  if (!ok) throw new NotFoundError("Attribute value");
  await A(
    brand,
    user.user_id,
    "catalogue.attribute.remove",
    "product",
    id,
    { field_id },
    request_id,
  );
}

// ── Related products ─────────────────────────────────────
async function listRelated({ brand, id }) {
  await getProduct({ brand, id });
  return repo.listRelated({ brand, product_id: id });
}
async function addRelated({ brand, user, request_id, id, input }) {
  await getProduct({ brand, id });
  const r = await repo.addRelated({ brand, product_id: id, input });
  await A(
    brand,
    user.user_id,
    "catalogue.related.add",
    "product",
    id,
    r,
    request_id,
  );
  return r;
}
async function removeRelated({ brand, user, request_id, id, pair_id }) {
  const ok = await repo.removeRelated({ brand, product_id: id, pair_id });
  if (!ok) throw new NotFoundError("Related link");
  await A(
    brand,
    user.user_id,
    "catalogue.related.remove",
    "product",
    id,
    { pair_id },
    request_id,
  );
}

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  archiveCategory,
  listProducts,
  getProduct,
  createProduct,
  createBaseProducts,
  cloneProduct,
  createSiblingSizes,
  bulkImportProducts,
  updateProduct,
  deleteProduct,
  listTrash,
  restoreProduct,
  listVariants,
  addVariant,
  updateVariant,
  removeVariant,
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  archiveCollection,
  addCollectionRule,
  removeCollectionRule,
  addCollectionMember,
  removeCollectionMember,
  listImages,
  addImage,
  uploadCoverImage,
  imageCutout,
  updateImage,
  removeImage,
  listVideos,
  addVideo,
  removeVideo,
  listMediaVideoLibrary,
  attachVideoFromMedia,
  getSeo,
  upsertSeo,
  listAttributeValues,
  setAttributeValue,
  removeAttributeValue,
  listRelated,
  addRelated,
  removeRelated,
};
