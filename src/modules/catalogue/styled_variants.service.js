/**
 * Styled colour × size variants + the size-tier/guide config — business logic.
 *
 * - Colours hold their own pictures + optional video/IG link and an optional
 *   per-colour price bump.
 * - Variants are the sellable colour × size matrix, generated in bulk
 *   ("all sizes" or a picked subset). Their price is computed from the styled
 *   retail anchor + colour premium + size premium, unless hand-overridden.
 * - The size ladder (S/M/L/XL premiums + circumference) and the head-size
 *   guide are brand-wide config edited from one modal on the Styled tab.
 */

"use strict";

const repo = require("./styled_variants.repo");
const styledRepo = require("./styled.repo");
const catalogueRepo = require("./catalogue.repo");
const events = require("./catalogue.events");
const documents = require("../../shared/documents/documents.service");
const { compressImage } = require("../../services/media-compression.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

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

const num = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v);

/** Effective retail of a colour×size, or null when the anchor isn't set yet. */
function computeEffective({ anchor, colour_premium, size_premium, override }) {
  if (override !== null && override !== undefined) return num(override);
  if (anchor === null || anchor === undefined) return null;
  return num(anchor) + Number(colour_premium || 0) + Number(size_premium || 0);
}

/** Deterministic, collision-safe short code for a colour's SKUs. */
function colourShort(colour) {
  const a =
    String(colour.name || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 3) || "CLR";
  const b = String(colour.colour_id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-2)
    .toUpperCase();
  return `${a}${b}`;
}

async function loadStyled({ client, brand, styled_id }) {
  const styled = await styledRepo.getById({ client, brand, id: styled_id });
  if (!styled) throw new NotFoundError("Styled product");
  return styled;
}

// ── Size-tier ladder + head-size guide (one modal) ───────
async function getSizeConfig({ brand }) {
  const [tiers, config] = await Promise.all([
    repo.listSizeTiers({ brand }),
    repo.getConfig({ brand }),
  ]);
  return { tiers, config: config || null };
}

/** Save the whole modal: tier premiums/ranges/tips + the guide copy. */
async function saveSizeConfig({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const before = await getSizeConfig({ brand });
    const savedTiers = [];
    for (const tier of input.tiers || []) {
      const existing = await repo.getSizeTier({
        client,
        brand,
        size_code: tier.size_code,
      });
      if (existing) {
        savedTiers.push(
          await repo.updateSizeTier({
            client,
            brand,
            size_code: tier.size_code,
            patch: tier,
          }),
        );
      } else {
        savedTiers.push(
          await repo.createSizeTier({ client, brand, input: tier }),
        );
      }
    }
    let config = before.config;
    if (
      input.size_guide_title !== undefined ||
      input.head_size_guide_md !== undefined
    ) {
      config = await repo.upsertConfig({
        client,
        brand,
        patch: {
          size_guide_title: input.size_guide_title,
          head_size_guide_md: input.head_size_guide_md,
        },
        user_id: user.user_id,
      });
    }
    await A(
      brand,
      user.user_id,
      "catalogue.size_config.update",
      "catalogue_config",
      brand,
      { tiers: savedTiers.length },
      request_id,
      before,
    );
    events.emit("catalogue.size_config.updated", { brand });
    return { tiers: savedTiers, config };
  });
}

// ── Colours ──────────────────────────────────────────────
async function listColours({ brand, styled_id }) {
  await loadStyled({ brand, styled_id });
  return repo.listColours({ brand, styled_id });
}

async function createColour({ brand, user, request_id, styled_id, input }) {
  return transaction(async (client) => {
    await loadStyled({ client, brand, styled_id });
    const colour = await repo.createColour({ client, brand, styled_id, input });
    if (input.is_default) {
      await repo.clearDefaultColours({
        client,
        brand,
        styled_id,
        except_id: colour.colour_id,
      });
    }
    await A(
      brand,
      user.user_id,
      "catalogue.styled_colour.create",
      "styled_colour",
      colour.colour_id,
      { styled_id, name: colour.name },
      request_id,
    );
    events.emit("styled.updated", { brand, id: styled_id });
    return colour;
  });
}

async function updateColour({
  brand,
  user,
  request_id,
  styled_id,
  colour_id,
  patch,
}) {
  return transaction(async (client) => {
    const before = await repo.getColour({
      client,
      brand,
      styled_id,
      colour_id,
    });
    if (!before) throw new NotFoundError("Colour");
    const colour = await repo.updateColour({
      client,
      brand,
      styled_id,
      colour_id,
      patch,
    });
    if (patch.is_default) {
      await repo.clearDefaultColours({
        client,
        brand,
        styled_id,
        except_id: colour_id,
      });
    }
    await A(
      brand,
      user.user_id,
      "catalogue.styled_colour.update",
      "styled_colour",
      colour_id,
      colour,
      request_id,
      before,
    );
    events.emit("styled.updated", { brand, id: styled_id });
    return colour;
  });
}

async function deleteColour({ brand, user, request_id, styled_id, colour_id }) {
  const ok = await repo.deleteColour({ brand, styled_id, colour_id });
  if (!ok) throw new NotFoundError("Colour");
  await A(
    brand,
    user.user_id,
    "catalogue.styled_colour.delete",
    "styled_colour",
    colour_id,
    null,
    request_id,
  );
  events.emit("styled.updated", { brand, id: styled_id });
}

// ── Per-colour images (gallery per colour / variant) ─────
// Each colour (the visual variant a shopper picks) carries its own gallery.
// The minimum is 2–3 for a good storefront card, but there is a generous
// ceiling so merchandisers can show a wig from many angles + on-model shots.
const MAX_COLOUR_IMAGES = 10;

async function listColourImages({ brand, styled_id, colour_id }) {
  const colour = await repo.getColour({ brand, styled_id, colour_id });
  if (!colour) throw new NotFoundError("Colour");
  return catalogueRepo.listColourImages({ brand, colour_id });
}

async function addColourImage({
  brand,
  user,
  request_id,
  styled_id,
  colour_id,
  file,
  meta,
}) {
  if (file.buffer && file.buffer.length > 10 * 1024 * 1024) {
    throw new AppError(
      "IMAGE_TOO_LARGE",
      "Image exceeds the 10 MB limit",
      413,
      {
        user_message: "Images must be 10 MB or smaller.",
      },
    );
  }
  // Compress to high-quality, smaller bytes before storage.
  const shrunk = await compressImage(file.buffer, file.mimetype);
  return transaction(async (client) => {
    const styled = await loadStyled({ client, brand, styled_id });
    const colour = await repo.getColour({
      client,
      brand,
      styled_id,
      colour_id,
    });
    if (!colour) throw new NotFoundError("Colour");
    // Cap the gallery so a single colour can't accumulate unbounded uploads.
    const existing = await catalogueRepo.listColourImages({
      client,
      brand,
      colour_id,
    });
    if (existing.length >= MAX_COLOUR_IMAGES) {
      throw new AppError(
        "IMAGE_LIMIT_REACHED",
        `A colour can hold at most ${MAX_COLOUR_IMAGES} pictures`,
        422,
        {
          user_message: `Each colour can have up to ${MAX_COLOUR_IMAGES} pictures. Remove one to add another.`,
        },
      );
    }
    const doc = await documents.store({
      client,
      brand,
      user_id: user.user_id,
      buffer: shrunk.buffer,
      filename: file.originalname,
      mime_type: shrunk.mime_type,
      document_type: "product_image",
      title: meta.alt_text || colour.name || file.originalname,
      reference_type: "product",
      reference_id: styled.base_product_id,
      request_id,
    });
    const image = await catalogueRepo.addImage({
      client,
      brand,
      image: {
        product_id: styled.base_product_id,
        styled_id,
        styled_colour_id: colour_id,
        file_path: doc.file_path,
        cdn_url: doc.url,
        alt_text: meta.alt_text,
        caption: meta.caption,
        display_order: meta.display_order,
        // Per-colour images share the base product_id, which carries a
        // one-primary-per-product unique index — so never mark them primary.
        is_primary: false,
        file_size_bytes: doc.file_size_bytes,
        uploaded_by: user.user_id,
      },
    });
    await A(
      brand,
      user.user_id,
      "catalogue.styled_colour.image_add",
      "styled_colour",
      colour_id,
      { image_id: image.image_id, document_id: doc.document_id },
      request_id,
    );
    events.emit("styled.updated", { brand, id: styled_id });
    return { ...image, document_id: doc.document_id };
  });
}

async function removeColourImage({
  brand,
  user,
  request_id,
  styled_id,
  colour_id,
  image_id,
}) {
  const colour = await repo.getColour({ brand, styled_id, colour_id });
  if (!colour) throw new NotFoundError("Colour");
  const ok = await catalogueRepo.removeColourImage({
    brand,
    colour_id,
    image_id,
  });
  if (!ok) throw new NotFoundError("Image");
  await A(
    brand,
    user.user_id,
    "catalogue.styled_colour.image_remove",
    "styled_colour",
    colour_id,
    { image_id },
    request_id,
  );
  events.emit("styled.updated", { brand, id: styled_id });
}

// ── Variants (colour × size) ─────────────────────────────
async function listVariants({ brand, styled_id }) {
  await loadStyled({ brand, styled_id });
  return repo.listVariants({ brand, styled_id });
}

/**
 * Bulk-generate the colour × size matrix. Accepts colour_ids (defaults to all
 * of the styled product's colours) and either all_sizes=true (every active
 * tier) or an explicit size_codes list. Existing combos are skipped, so it is
 * safe to re-run after adding a colour or a size.
 */
async function bulkCreateVariants({
  brand,
  user,
  request_id,
  styled_id,
  input,
}) {
  return transaction(async (client) => {
    const styled = await loadStyled({ client, brand, styled_id });

    const allColours = await repo.listColours({ client, brand, styled_id });
    if (!allColours.length) {
      throw new AppError(
        "NO_COLOURS",
        "Add at least one colour before generating variants",
        422,
      );
    }
    const chosenColours =
      input.colour_ids && input.colour_ids.length
        ? allColours.filter((c) => input.colour_ids.includes(c.colour_id))
        : allColours;
    if (!chosenColours.length) {
      throw new AppError("INVALID_COLOURS", "No matching colours", 422);
    }

    const tiers = await repo.listSizeTiers({ client, brand, activeOnly: true });
    const tierByCode = new Map(tiers.map((tier) => [tier.size_code, tier]));
    let sizeCodes;
    if (input.all_sizes) {
      sizeCodes = tiers.map((tier) => tier.size_code);
    } else {
      sizeCodes = (input.size_codes || []).filter((code) =>
        tierByCode.has(code),
      );
    }
    if (!sizeCodes.length) {
      throw new AppError("INVALID_SIZES", "Pick at least one valid size", 422);
    }

    const existing = await repo.existingPairs({ client, brand, styled_id });
    const seen = new Set(existing.map((e) => `${e.colour_id}:${e.size_code}`));

    const created = [];
    let skipped = 0;
    let order = existing.length;
    // The first variant ever created for a styled product becomes the default
    // (one default per styled product, enforced by a partial unique index).
    let anyDefault = existing.length > 0;

    for (const colour of chosenColours) {
      const short = colourShort(colour);
      for (const size_code of sizeCodes) {
        const key = `${colour.colour_id}:${size_code}`;
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        const sku = `${styled.styled_code}-${short}-${size_code}`;
        const is_default = !anyDefault;
        anyDefault = true;
        const variant = await repo.createVariant({
          client,
          brand,
          styled_id,
          input: {
            colour_id: colour.colour_id,
            size_code,
            sku,
            is_default,
            display_order: order++,
          },
        });
        created.push(variant);
      }
    }

    await A(
      brand,
      user.user_id,
      "catalogue.styled_variant.bulk_create",
      "styled_product",
      styled_id,
      { created: created.length, skipped },
      request_id,
    );
    events.emit("styled.updated", { brand, id: styled_id });
    return { created, created_count: created.length, skipped };
  });
}

async function updateVariant({
  brand,
  user,
  request_id,
  styled_id,
  styled_variant_id,
  patch,
}) {
  return transaction(async (client) => {
    const before = await repo.getVariant({
      client,
      brand,
      styled_id,
      styled_variant_id,
    });
    if (!before) throw new NotFoundError("Variant");
    const variant = await repo.updateVariant({
      client,
      brand,
      styled_id,
      styled_variant_id,
      patch,
    });
    await A(
      brand,
      user.user_id,
      "catalogue.styled_variant.update",
      "styled_variant",
      styled_variant_id,
      variant,
      request_id,
      before,
    );
    events.emit("styled.updated", { brand, id: styled_id });
    return variant;
  });
}

async function deleteVariant({
  brand,
  user,
  request_id,
  styled_id,
  styled_variant_id,
}) {
  const ok = await repo.deleteVariant({ brand, styled_id, styled_variant_id });
  if (!ok) throw new NotFoundError("Variant");
  await A(
    brand,
    user.user_id,
    "catalogue.styled_variant.delete",
    "styled_variant",
    styled_variant_id,
    null,
    request_id,
  );
  events.emit("styled.updated", { brand, id: styled_id });
}

module.exports = {
  computeEffective,
  colourShort,
  getSizeConfig,
  saveSizeConfig,
  listColours,
  createColour,
  updateColour,
  deleteColour,
  listColourImages,
  addColourImage,
  removeColourImage,
  listVariants,
  bulkCreateVariants,
  updateVariant,
  deleteVariant,
};
