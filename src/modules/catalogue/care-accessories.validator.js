"use strict";

const { z } = require("zod");

const sku = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, digits, dots, dashes or underscores");
const barcode = z.string().trim().min(1).max(80).nullable().optional();
const price = z.coerce.number().finite().min(0).max(999999999999.99).nullable().optional();
const variant = z.object({
  sku: sku.optional(), // simple items may derive the SKU from their new code
  label: z.string().trim().min(1).max(160).optional(),
  barcode,
  price_storefront_ngn: price,
  price_storefront_usd: price,
  price_pos_ngn: price,
  price_pos_usd: price,
  reorder_point: z.coerce.number().int().min(0).max(1000000).optional(),
}).strict();

const fields = z.object({
  name: z.string().trim().min(1).max(200),
  product_code: sku.max(60).optional(),
  category_id: z.string().uuid().optional(),
  short_description: z.string().max(500).nullable().optional(),
  long_description: z.string().max(8000).nullable().optional(),
  ingredients: z.string().max(5000).nullable().optional(),
  directions: z.string().max(5000).nullable().optional(),
  warnings: z.string().max(5000).nullable().optional(),
  search_keywords: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  // No inferred wig VAT: the operator explicitly selects tax treatment.
  taxable: z.boolean(),
  vat_rate: z.coerce.number().finite().min(0).max(1).nullable().optional(),
}).strict();

const product = fields.extend({ variants: z.array(variant).min(1).max(30) })
  .superRefine((v, ctx) => {
    const hasRate = v.vat_rate !== null && v.vat_rate !== undefined;
    if (v.taxable && !hasRate)
      ctx.addIssue({ code: "custom", path: ["vat_rate"], message: "Enter the approved VAT rate for a taxable item" });
    if (!v.taxable && hasRate)
      ctx.addIssue({ code: "custom", path: ["vat_rate"], message: "An exempt item cannot carry a VAT rate" });
    if (v.variants.length > 1 && v.variants.some((x) => !x.sku || !x.label))
      ctx.addIssue({ code: "custom", path: ["variants"], message: "Every selectable option needs a label and exact SKU" });
    const ids = v.variants.map((x) => x.sku).filter(Boolean);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", path: ["variants"], message: "Duplicate SKU in this product" });
  });

const update = fields.omit({ product_code: true }).partial();
const variantUpdate = variant.omit({}).partial();
const importRows = z.object({ products: z.array(product).min(1).max(50) }).strict();
const cloneInput = z.object({
  name: z.string().trim().min(1).max(200),
  product_code: sku.max(60).optional(),
  // Position matches the source's active SKU order; new SKU is mandatory.
  // Prices/copy/tax come from the source. No stock, cost or photos are cloned.
  variants: z.array(z.object({
    sku, label: z.string().trim().min(1).max(160).optional(), barcode,
  }).strict()).min(1).max(30),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.variants.map((x) => x.sku)).size !== v.variants.length)
    ctx.addIssue({ code: "custom", path: ["variants"], message: "Every cloned SKU must be unique" });
});
const middleware = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

module.exports = {
  validateCreate: middleware(product),
  validateImport: middleware(importRows),
  validateClone: middleware(cloneInput),
  validateUpdate: middleware(update),
  validateVariantCreate: middleware(variant),
  validateVariantUpdate: middleware(variantUpdate),
  validateUnpublish: middleware(z.object({ archive: z.boolean().optional() }).strict()),
  product, variant,
};
