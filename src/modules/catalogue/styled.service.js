/**
 * Styled products (V2.2 §6.4 P0-6) — business logic.
 *
 * A styled product is a storefront-facing skin over exactly one base
 * product. It carries no stock of its own; its availability is derived
 * from the base, so when the base runs out every styled name on it goes
 * out-of-stock — or into a PRODUCTION-framed pre-order if the base has
 * pre-order enabled (P0-7). Final price = base selling price + add-on.
 *
 * Lifecycle: draft → live → archived. Only a user with catalogue.publish
 * may promote a draft to live (enforced at the route). AI may create a
 * draft but never publishes (P0-8).
 */

"use strict";

const repo = require("./styled.repo");
const variantsRepo = require("./styled_variants.repo");
const events = require("./catalogue.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

const A = (brand, user_id, action_key, target_id, after, request_id, before) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type: "styled_product",
    target_id,
    before,
    after,
    request_id,
  });

const money = (v) => (v === null || v === undefined ? 0 : Number(v));

/** Translate base stock into a customer-facing availability state. */
function availabilityState(available, base) {
  if (available > 0) return { state: "in_stock", available };
  if (base && base.preorder_enabled) {
    let message;
    if (base.expected_ready_date) {
      const d = new Date(base.expected_ready_date);
      const when = Number.isNaN(d.getTime())
        ? String(base.expected_ready_date)
        : d.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
      message = `In production · ready ~${when}`;
    } else if (base.production_lead_days) {
      message = `Made to order · ~${base.production_lead_days} days in production`;
    } else {
      message = "Made to order · in production";
    }
    return {
      state: "preorder",
      available: 0,
      expected_ready_date: base.expected_ready_date || null,
      production_lead_days: base.production_lead_days || null,
      message,
    };
  }
  return { state: "out_of_stock", available: 0 };
}

/** Pure: attach computed price + availability given the base's stock + price.
 *  No DB access — the caller supplies the two derived numbers.
 *
 *  Pricing model: a styled product carries its OWN retail price
 *  (`retail_price_ngn`, the size-S anchor), independent of the base wholesale
 *  price. Rows created before this model fall back to the legacy
 *  base + style_addon figure so nothing reads ₦0. */
function enrichRow(styled, available, base_price) {
  const base = {
    preorder_enabled: styled.preorder_enabled,
    expected_ready_date: styled.expected_ready_date,
    production_lead_days: styled.production_lead_days,
  };
  const has_base_price = base_price !== null && base_price !== undefined;
  const anchor = styled.retail_price_ngn;
  const has_anchor = anchor !== null && anchor !== undefined;
  const legacy = has_base_price
    ? money(base_price) + money(styled.style_addon_price_ngn)
    : null;
  return {
    ...styled,
    availability: availabilityState(available || 0, base),
    base_price_ngn: has_base_price ? base_price : null,
    retail_price_ngn: has_anchor ? anchor : null,
    // Headline "from" price: the styled retail anchor (size S), else legacy.
    effective_price_ngn: has_anchor ? money(anchor) : legacy,
  };
}

/** Attach computed price + availability to a single styled row (2 reads). */
async function enrich({ brand, styled }) {
  const available = await repo.baseAvailability({
    brand,
    base_product_id: styled.base_product_id,
    base_variant_id: styled.base_variant_id,
  });
  const base_price = await repo.basePrice({
    brand,
    base_product_id: styled.base_product_id,
    base_variant_id: styled.base_variant_id,
  });
  return enrichRow(styled, available, base_price);
}

async function list({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  const res = await repo.list({ brand, filters, page, page_size, offset });
  // repo.list resolves availability + base price inline (LATERAL), so no
  // per-row queries here.
  res.data = res.data.map((styled) =>
    enrichRow(styled, styled.base_available, styled.base_price_storefront_ngn),
  );
  return res;
}

async function getById({ brand, id }) {
  const styled = await repo.getById({ brand, id });
  if (!styled) throw new NotFoundError("Styled product");
  const enriched = await enrich({ brand, styled });
  // Attach the colour options + the colour×size variant matrix with their
  // computed retail prices, plus the headline price range across live variants.
  const [colours, variants] = await Promise.all([
    variantsRepo.listColours({ brand, styled_id: id }),
    variantsRepo.listVariants({ brand, styled_id: id }),
  ]);
  const prices = variants
    .filter((v) => v.is_active && v.effective_price_ngn !== null)
    .map((v) => Number(v.effective_price_ngn));
  enriched.colours = colours;
  enriched.variants = variants;
  enriched.price_range = prices.length
    ? { min: Math.min(...prices), max: Math.max(...prices) }
    : null;
  return enriched;
}

async function create({ brand, user, request_id, input, ai }) {
  return transaction(async (client) => {
    const base = await repo.baseProduct({
      client,
      brand,
      base_product_id: input.base_product_id,
    });
    if (!base || base.is_deleted) {
      throw new AppError("INVALID_BASE", "Base product not found", 422);
    }
    const styled_code =
      input.styled_code || (await repo.nextCode({ client, brand }));
    const row = {
      ...input,
      styled_code,
      created_by: user.user_id,
    };
    if (ai) {
      // AI-draft provenance (P0-8): created as a draft for human review.
      row.ai_drafted = true;
      row.ai_model = ai.model || null;
      row.ai_confidence = ai.confidence ?? null;
    }
    const created = await repo.create({ client, brand, row });
    // ai_* columns aren't in STYLED_COLS; set them directly when present.
    if (ai) {
      await repo.setStatus({
        client,
        brand,
        id: created.styled_id,
        status: "draft",
        fields: {
          ai_drafted: true,
          ai_model: ai.model || null,
          ai_confidence: ai.confidence ?? null,
          ai_drafted_at: new Date(),
          ai_drafted_by: user.user_id,
        },
      });
    }
    await A(
      brand,
      user.user_id,
      "catalogue.styled.create",
      created.styled_id,
      { styled_code, base_product_id: input.base_product_id, ai: !!ai },
      request_id,
    );
    events.emit("styled.created", { brand, id: created.styled_id });
    return created;
  });
}

async function update({ brand, user, request_id, id, patch }) {
  const before = await repo.getById({ brand, id });
  if (!before) throw new NotFoundError("Styled product");
  const updated = await repo.update({ brand, id, patch });
  await A(
    brand,
    user.user_id,
    "catalogue.styled.update",
    id,
    updated,
    request_id,
    before,
  );
  events.emit("styled.updated", { brand, id });
  return updated;
}

async function publish({ brand, user, request_id, id }) {
  const before = await repo.getById({ brand, id });
  if (!before) throw new NotFoundError("Styled product");
  if (before.status === "live") return before;
  // "Never a style without a base." The styled product carries its seed base,
  // and every sellable variant carries its own base — so a product can only go
  // live once it has at least one live variant to sell. This is the publish-time
  // guarantee that replaces a styled-level-only base requirement.
  const variants = await variantsRepo.listVariants({ brand, styled_id: id });
  const sellable = variants.filter((v) => v.is_active);
  if (sellable.length === 0) {
    throw new AppError(
      "STYLED_NO_VARIANTS",
      "Add at least one active variant before publishing",
      422,
      {
        user_message:
          "Add at least one colour & size (a sellable variant) before going live. Each variant draws from its own base product.",
      },
    );
  }
  const updated = await repo.setStatus({
    brand,
    id,
    status: "live",
    fields: {
      is_visible_storefront: true,
      published_by: user.user_id,
      published_at: new Date(),
    },
  });
  await A(
    brand,
    user.user_id,
    "catalogue.styled.publish",
    id,
    { status: "live" },
    request_id,
    { status: before.status },
  );
  events.emit("styled.published", { brand, id });
  return updated;
}

async function unpublish({ brand, user, request_id, id, archive }) {
  const before = await repo.getById({ brand, id });
  if (!before) throw new NotFoundError("Styled product");
  const status = archive ? "archived" : "draft";
  const updated = await repo.setStatus({
    brand,
    id,
    status,
    fields: { is_visible_storefront: false },
  });
  await A(
    brand,
    user.user_id,
    archive ? "catalogue.styled.archive" : "catalogue.styled.unpublish",
    id,
    { status },
    request_id,
    { status: before.status },
  );
  events.emit("styled.unpublished", { brand, id });
  return updated;
}

/** Delete an ENTIRE styled product → Trash (15-day purge). Its colours and
 *  variants are soft-deleted in the SAME transaction, so they share one
 *  deleted_at and a later restore brings the whole product back intact. */
async function remove({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const ok = await repo.softDelete({ client, brand, id });
    if (!ok) throw new NotFoundError("Styled product");
    await variantsRepo.softDeleteVariantsForStyled({
      client,
      brand,
      styled_id: id,
      user_id: user.user_id,
    });
    await variantsRepo.softDeleteColoursForStyled({
      client,
      brand,
      styled_id: id,
      user_id: user.user_id,
    });
    await A(
      brand,
      user.user_id,
      "catalogue.styled.delete",
      id,
      { trashed: true },
      request_id,
    );
    events.emit("styled.deleted", { brand, id });
  });
}

// ── Trash + Restore ──────────────────────────────────────
function listTrash({ brand, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listTrashed({ brand, page, page_size, offset });
}

const restoreSuffix = () => Date.now().toString(36).slice(-4);

async function restore({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const trashed = await repo.getTrashedById({ client, brand, id });
    if (!trashed) throw new NotFoundError("Styled product");
    let slug = null;
    let styled_code = null;
    let renamed = false;
    if (await repo.styledSlugTaken({ client, brand, slug: trashed.slug })) {
      slug = `${trashed.slug}-restored-${restoreSuffix()}`;
      renamed = true;
    }
    if (
      await repo.styledCodeTaken({ client, brand, code: trashed.styled_code })
    ) {
      styled_code = `${trashed.styled_code}-R${restoreSuffix()}`;
      renamed = true;
    }
    const s = await repo.restore({ client, brand, id, slug, styled_code });
    // Bring back the colours + variants that were trashed in the same breath as
    // the product (matched by the shared deleted_at), so a restore is whole.
    await variantsRepo.restoreColoursDeletedAt({
      client,
      brand,
      styled_id: id,
      deleted_at: trashed.deleted_at,
    });
    await variantsRepo.restoreVariantsDeletedAt({
      client,
      brand,
      styled_id: id,
      deleted_at: trashed.deleted_at,
    });
    await A(
      brand,
      user.user_id,
      "catalogue.styled.restore",
      id,
      { renamed, slug: s.slug, styled_code: s.styled_code },
      request_id,
      { status: trashed.status },
    );
    events.emit("styled.updated", { brand, id });
    return { ...s, renamed };
  });
}

module.exports = {
  availabilityState,
  enrich,
  list,
  getById,
  create,
  update,
  publish,
  unpublish,
  remove,
  listTrash,
  restore,
};
