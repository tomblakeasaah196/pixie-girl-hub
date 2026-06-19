/**
 * Catalogue (V2.2 §6.4/§6.9) — HTTP controllers.
 */

"use strict";

const service = require("./catalogue.service");
const mediaService = require("../../services/media.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// Categories
async function listCategories(req, res) {
  res.json({ data: await service.listCategories({ brand: req.brand }) });
}
async function getCategory(req, res) {
  res.json({
    data: await service.getCategory({ brand: req.brand, id: req.params.catId }),
  });
}
async function createCategory(req, res) {
  res.status(201).json({
    data: await service.createCategory({ ...base(req), input: req.body }),
  });
}
async function updateCategory(req, res) {
  res.json({
    data: await service.updateCategory({
      ...base(req),
      id: req.params.catId,
      patch: req.body,
    }),
  });
}
async function archiveCategory(req, res) {
  await service.archiveCategory({ ...base(req), id: req.params.catId });
  res.status(204).end();
}

// Products
async function listProducts(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listProducts({
      brand: req.brand,
      filters: {
        q: req.query.q,
        category_id: req.query.category_id,
        product_type: req.query.product_type,
        visible:
          req.query.visible === undefined
            ? undefined
            : req.query.visible === "true",
      },
      page,
      page_size,
    }),
  );
}
async function getProduct(req, res) {
  res.json({
    data: await service.getProduct({
      brand: req.brand,
      id: req.params.id,
      user: req.user,
    }),
  });
}
async function createProduct(req, res) {
  res.status(201).json({
    data: await service.createProduct({ ...base(req), input: req.body }),
  });
}
async function bulkImportProducts(req, res) {
  res.status(201).json({
    data: await service.bulkImportProducts({
      ...base(req),
      rows: req.body.rows,
    }),
  });
}
async function updateProduct(req, res) {
  res.json({
    data: await service.updateProduct({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function deleteProduct(req, res) {
  await service.deleteProduct({ ...base(req), id: req.params.id });
  res.status(204).end();
}
async function listTrash(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(await service.listTrash({ brand: req.brand, page, page_size }));
}
async function restoreProduct(req, res) {
  res.json({
    data: await service.restoreProduct({ ...base(req), id: req.params.id }),
  });
}

// Variants
async function listVariants(req, res) {
  res.json({
    data: await service.listVariants({
      brand: req.brand,
      id: req.params.id,
      user: req.user,
    }),
  });
}
async function addVariant(req, res) {
  res.status(201).json({
    data: await service.addVariant({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function updateVariant(req, res) {
  res.json({
    data: await service.updateVariant({
      ...base(req),
      id: req.params.id,
      variant_id: req.params.variantId,
      patch: req.body,
    }),
  });
}
async function removeVariant(req, res) {
  await service.removeVariant({
    ...base(req),
    id: req.params.id,
    variant_id: req.params.variantId,
  });
  res.status(204).end();
}

// Collections
const listCollections = async (req, res) =>
  res.json({ data: await service.listCollections({ brand: req.brand }) });
const getCollection = async (req, res) =>
  res.json({
    data: await service.getCollection({
      brand: req.brand,
      id: req.params.colId,
    }),
  });
const createCollection = async (req, res) =>
  res.status(201).json({
    data: await service.createCollection({ ...base(req), input: req.body }),
  });
const updateCollection = async (req, res) =>
  res.json({
    data: await service.updateCollection({
      ...base(req),
      id: req.params.colId,
      patch: req.body,
    }),
  });
const archiveCollection = async (req, res) => {
  await service.archiveCollection({ ...base(req), id: req.params.colId });
  res.status(204).end();
};
const addCollectionRule = async (req, res) =>
  res.status(201).json({
    data: await service.addCollectionRule({
      ...base(req),
      id: req.params.colId,
      input: req.body,
    }),
  });
const removeCollectionRule = async (req, res) => {
  await service.removeCollectionRule({
    ...base(req),
    id: req.params.colId,
    rule_id: req.params.ruleId,
  });
  res.status(204).end();
};
const addCollectionMember = async (req, res) =>
  res.status(201).json({
    data: await service.addCollectionMember({
      ...base(req),
      id: req.params.colId,
      input: req.body,
    }),
  });
const removeCollectionMember = async (req, res) => {
  await service.removeCollectionMember({
    ...base(req),
    id: req.params.colId,
    product_id: req.params.productId,
  });
  res.status(204).end();
};

// Images (multipart upload → routed through Documents)
const listImages = async (req, res) =>
  res.json({
    data: await service.listImages({ brand: req.brand, id: req.params.id }),
  });
async function addImage(req, res) {
  if (!req.file)
    return res.status(400).json({
      error: {
        code: "NO_FILE",
        message: "Multipart field 'file' is required",
      },
      request_id: req.request_id,
    });
  res.status(201).json({
    data: await service.addImage({
      ...base(req),
      id: req.params.id,
      file: req.file,
      meta: req.body,
    }),
  });
}
const updateImage = async (req, res) =>
  res.json({
    data: await service.updateImage({
      ...base(req),
      id: req.params.id,
      image_id: req.params.imageId,
      patch: req.body,
    }),
  });
const removeImage = async (req, res) => {
  await service.removeImage({
    ...base(req),
    id: req.params.id,
    image_id: req.params.imageId,
  });
  res.status(204).end();
};

// Videos
const listVideos = async (req, res) =>
  res.json({
    data: await service.listVideos({ brand: req.brand, id: req.params.id }),
  });
const addVideo = async (req, res) =>
  res.status(201).json({
    data: await service.addVideo({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const removeVideo = async (req, res) => {
  await service.removeVideo({
    ...base(req),
    id: req.params.id,
    video_id: req.params.videoId,
  });
  res.status(204).end();
};
const uploadMedia = async (req, res) =>
  res.status(201).json({
    data: await mediaService.registerUpload({
      brand: req.brand,
      user: req.user,
      file: req.file,
      meta: req.body || {},
    }),
  });
const listMediaVideoLibrary = async (req, res) =>
  res.json({
    data: await service.listMediaVideoLibrary({ brand: req.brand }),
  });
const attachVideoFromMedia = async (req, res) =>
  res.status(201).json({
    data: await service.attachVideoFromMedia({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

// SEO
const getSeo = async (req, res) =>
  res.json({
    data: await service.getSeo({ brand: req.brand, id: req.params.id }),
  });
const upsertSeo = async (req, res) =>
  res.json({
    data: await service.upsertSeo({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });

// Attributes
const listAttributeValues = async (req, res) =>
  res.json({
    data: await service.listAttributeValues({
      brand: req.brand,
      id: req.params.id,
    }),
  });
const setAttributeValue = async (req, res) =>
  res.status(201).json({
    data: await service.setAttributeValue({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const removeAttributeValue = async (req, res) => {
  await service.removeAttributeValue({
    ...base(req),
    id: req.params.id,
    field_id: req.params.fieldId,
  });
  res.status(204).end();
};

// Related
const listRelated = async (req, res) =>
  res.json({
    data: await service.listRelated({ brand: req.brand, id: req.params.id }),
  });
const addRelated = async (req, res) =>
  res.status(201).json({
    data: await service.addRelated({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const removeRelated = async (req, res) => {
  await service.removeRelated({
    ...base(req),
    id: req.params.id,
    pair_id: req.params.pairId,
  });
  res.status(204).end();
};

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  archiveCategory,
  listProducts,
  getProduct,
  createProduct,
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
  updateImage,
  removeImage,
  listVideos,
  addVideo,
  removeVideo,
  uploadMedia,
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
