/**
 * Catalogue (V2.2 §6.4/§6.9) — business logic.
 * Cross-module link: on variant create, emits `variant.created` so Stock
 * seeds a stock_levels row (single source of truth).
 */

"use strict";

const repo = require("./catalogue.repo");
const events = require("./catalogue.events");
const outbox = require("../../shared/outbox/outbox");
const documents = require("../../shared/documents/documents.service");
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
function listProducts({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.findAllProducts({ brand, filters, page, page_size, offset });
}
async function getProduct({ brand, id }) {
  const p = await repo.findProductById({ brand, id });
  if (!p) throw new NotFoundError("Product");
  const variants = await repo.listVariants({ brand, product_id: id });
  return { ...p, variants };
}
async function createProduct({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const p = await repo.createProduct({
      client,
      brand,
      input,
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
async function updateProduct({ brand, user, request_id, id, patch }) {
  const before = await repo.findProductById({ brand, id });
  if (!before) throw new NotFoundError("Product");
  const p = await repo.updateProduct({ brand, id, patch });
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

// ── Variants ─────────────────────────────────────────────
async function listVariants({ brand, id }) {
  await getProduct({ brand, id });
  return repo.listVariants({ brand, product_id: id });
}
async function addVariant({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const product = await repo.findProductById({ client, brand, id });
    if (!product) throw new NotFoundError("Product");
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
}
async function updateVariant({
  brand,
  user,
  request_id,
  id,
  variant_id,
  patch,
}) {
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
  return v;
}
async function removeVariant({ brand, user, request_id, id, variant_id }) {
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
  const m = await repo.addCollectionMember({
    brand,
    collection_id: id,
    product_id: input.product_id,
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
  product_id,
}) {
  const ok = await repo.removeCollectionMember({
    brand,
    collection_id: id,
    product_id,
  });
  if (!ok) throw new NotFoundError("Collection member");
  await A(
    brand,
    user.user_id,
    "catalogue.collection.member.remove",
    "product_collection",
    id,
    { product_id },
    request_id,
  );
}

// ── Images (every file routes through the Documents gateway, §6.13) ──
async function listImages({ brand, id }) {
  await getProduct({ brand, id });
  return repo.listImages({ brand, product_id: id });
}
async function addImage({ brand, user, request_id, id, file, meta }) {
  const product = await repo.findProductById({ brand, id });
  if (!product) throw new NotFoundError("Product");
  return transaction(async (client) => {
    const doc = await documents.store({
      client,
      brand,
      user_id: user.user_id,
      buffer: file.buffer,
      filename: file.originalname,
      mime_type: file.mimetype,
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
async function updateImage({ brand, user, request_id, id, image_id, patch }) {
  const img = await repo.updateImage({
    brand,
    product_id: id,
    image_id,
    patch,
  });
  if (!img) throw new NotFoundError("Image");
  await A(
    brand,
    user.user_id,
    "catalogue.image.update",
    "product_image",
    image_id,
    img,
    request_id,
  );
  return img;
}
async function removeImage({ brand, user, request_id, id, image_id }) {
  const ok = await repo.removeImage({ brand, product_id: id, image_id });
  if (!ok) throw new NotFoundError("Image");
  await A(
    brand,
    user.user_id,
    "catalogue.image.remove",
    "product_image",
    image_id,
    null,
    request_id,
  );
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
  updateProduct,
  deleteProduct,
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
