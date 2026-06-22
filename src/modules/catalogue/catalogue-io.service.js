/**
 * Catalogue import/export engine (PR-B).
 *
 * Styled products use a rich multi-sheet .xlsx (Styled Products + Colours +
 * a read-only Reference sheet with dropdowns) so operators only ever reference
 * EXISTING bases / collections / bundles / lace — never invent a base name the
 * backend would reject. Collections and bundles use a simple single sheet and
 * are created independently (members/components are managed in-app afterwards).
 *
 * Composition over duplication: this layer parses sheets and delegates writes
 * to the existing services (styled, colours, variant generation, collection
 * members, bundle components), so imported rows behave exactly like UI input.
 */

"use strict";

const { query } = require("../../config/database");
const { VALID } = require("../../config/brands");
const {
  buildWorkbook,
  parseWorkbook,
} = require("../../services/spreadsheet.service");
const styledService = require("./styled.service");
const styledRepo = require("./styled.repo");
const variantsService = require("./styled_variants.service");
const variantsRepo = require("./styled_variants.repo");
const catalogueService = require("./catalogue.service");
const catalogueRepo = require("./catalogue.repo");
const bundleService = require("../retention/bundle.service");
const bundleRepo = require("../retention/bundle.repo");

const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const str = (v) => (isBlank(v) ? undefined : String(v).trim());
const num = (v) => (isBlank(v) ? undefined : Number(v));
const bool = (v) =>
  isBlank(v) ? undefined : /^(y|yes|true|1)$/i.test(String(v).trim());
const csv = (v) =>
  isBlank(v)
    ? undefined
    : String(v)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
const yn = (b) => (b ? "yes" : "no");
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ════════════════════════════════════════════════════════════
// Reference data (names operators may safely cite)
// ════════════════════════════════════════════════════════════
async function referenceLists(brand) {
  const [bases, collections, bundles, sizes, lace] = await Promise.all([
    query(
      `SELECT name FROM ${t(brand, "products")} WHERE is_deleted = false ORDER BY name`,
    ),
    query(
      `SELECT name FROM ${t(brand, "product_collections")} WHERE is_active = true ORDER BY name`,
    ),
    query(
      `SELECT display_name FROM ${t(brand, "bundle_offers")} WHERE is_active = true ORDER BY display_name`,
    ),
    variantsRepo.listSizeTiers({ brand, activeOnly: true }),
    variantsRepo.listLaceSizes({ brand, activeOnly: true }),
  ]);
  return {
    bases: bases.rows.map((r) => r.name),
    collections: collections.rows.map((r) => r.name),
    bundles: bundles.rows.map((r) => r.display_name),
    sizes: sizes.map((s) => s.size_code),
    lace: lace.map((l) => l.lace_code),
  };
}

const lc = (s) => String(s ?? "").trim().toLowerCase();
function nameIndex(rows, key) {
  const map = new Map();
  for (const r of rows) map.set(lc(r[key]), r);
  return map;
}

// ════════════════════════════════════════════════════════════
// Styled products (multi-sheet)
// ════════════════════════════════════════════════════════════
const STYLED_SHEET = "Styled Products";

// One row per SELLABLE variant (colour × lace × size). A styled product is the
// set of rows that share a "Styled Name". Styled-level fields (Status, Slug,
// Short Description) are taken from the first row of each group; everything else
// is per-variant. Export emits this EXACT shape, so an export re-imports 1:1
// (the round-trip the owner relies on for Faitlynhair → Pixie Girl).
const STYLED_COLUMNS = [
  { header: "Styled Name*", key: "styled_name", width: 24 },
  { header: "Base Product*", key: "base", width: 34, ref: "Existing base products" },
  { header: "Colour*", key: "colour", width: 18 },
  { header: "Hex", key: "hex", width: 10 },
  { header: "Lace", key: "lace", width: 16, ref: "Lace codes" },
  { header: "Size*", key: "size", width: 8, ref: "Size codes" },
  { header: "Retail Price (NGN)*", key: "price", width: 16 },
  { header: "Retail Price (USD)", key: "price_usd", width: 16 },
  { header: "Compare-at Price (NGN)", key: "compare_at", width: 18 },
  { header: "Compare-at Price (USD)", key: "compare_at_usd", width: 18 },
  { header: "Default Colour?", key: "is_default_colour", width: 14, list: ["yes", "no"] },
  { header: "Collections (comma)", key: "collections", width: 24 },
  { header: "Bundles (comma)", key: "bundles", width: 24 },
  { header: "Status", key: "status", width: 10, list: ["draft", "live"] },
  { header: "Short Description", key: "short_description", width: 30 },
  { header: "Long Description", key: "long_description", width: 40 },
  { header: "Slug", key: "slug", width: 20 },
  { header: "Image URLs (comma)", key: "images", width: 36 },
];

// Canonical lace CODE from a human label ("HD6x6 Center" → "HD6X6CENTER"); the
// original text is kept as the lace label. Keeps codes FK-safe + dropdown-clean.
const laceCodeOf = (s) =>
  isBlank(s) ? null : String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

function templateCols(cols, refLetters) {
  return cols.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    list: c.list,
    refColumn: c.ref && refLetters?.includes(c.ref) ? c.ref : undefined,
  }));
}

async function styledTemplate({ brand }) {
  const ref = await referenceLists(brand);
  const reference = [
    { title: "Existing base products", values: ref.bases },
    { title: "Existing collections", values: ref.collections },
    { title: "Existing bundles", values: ref.bundles },
    { title: "Size codes", values: ref.sizes },
    { title: "Lace codes", values: ref.lace },
  ];
  const refTitles = reference.map((r) => r.title);
  const base0 = ref.bases[0] ?? "";
  const lace0 = ref.lace[0] ?? "";
  const sizeS = ref.sizes.includes("S") ? "S" : ref.sizes[0] ?? "S";
  const sizeM = ref.sizes.includes("M") ? "M" : ref.sizes[1] ?? sizeS;
  // Two sample rows: one product + colour in two sizes (price steps by size).
  const sample = (size, price) => ({
    styled_name: "Sample Pixie",
    base: base0,
    colour: "Natural Black",
    hex: "#1B1B1B",
    lace: lace0,
    size,
    price,
    is_default_colour: "yes",
    collections: ref.collections[0] ?? "",
    status: "draft",
    short_description: "Soft natural-black pixie.",
    long_description:
      "A lightweight everyday pixie in a soft natural black, pre-plucked hairline and bleached knots for a scalp-real finish.",
  });
  return buildWorkbook({
    sheets: [
      {
        name: STYLED_SHEET,
        columns: templateCols(STYLED_COLUMNS, refTitles),
        rows: [sample(sizeS, 389000), sample(sizeM, 389000)],
      },
    ],
    reference,
  });
}

// Per-colour image URLs for a styled product (best-effort; never fails export).
async function colourImageMap(brand, styled_id) {
  const map = new Map();
  try {
    const { rows } = await query(
      `SELECT styled_colour_id, cdn_url FROM ${t(brand, "product_images")}
        WHERE styled_id = $1 AND styled_colour_id IS NOT NULL AND cdn_url IS NOT NULL
        ORDER BY display_order`,
      [styled_id],
    );
    for (const r of rows) {
      if (!map.has(r.styled_colour_id)) map.set(r.styled_colour_id, []);
      map.get(r.styled_colour_id).push(r.cdn_url);
    }
  } catch {
    /* images are a bonus in export */
  }
  return map;
}
async function collectionsForStyled(brand, styled_id) {
  if (!styled_id) return "";
  try {
    const { rows } = await query(
      `SELECT c.name FROM ${t(brand, "product_collections")} c
         JOIN ${t(brand, "product_collection_members")} m ON m.collection_id = c.collection_id
        WHERE m.styled_id = $1 ORDER BY c.name`,
      [styled_id],
    );
    return rows.map((r) => r.name).join(", ");
  } catch {
    return "";
  }
}
async function bundlesForStyled(brand, styled_id) {
  if (!styled_id) return "";
  try {
    const { rows } = await query(
      `SELECT b.display_name FROM ${t(brand, "bundle_offers")} b
         JOIN ${t(brand, "bundle_offer_products")} bp ON bp.bundle_id = b.bundle_id
        WHERE bp.styled_id = $1 ORDER BY b.display_name`,
      [styled_id],
    );
    return rows.map((r) => r.display_name).join(", ");
  } catch {
    return "";
  }
}

// Export EXACTLY the import shape: one row per variant, so a downloaded export
// re-imports 1:1 (the Faitlynhair → Pixie Girl round-trip).
async function exportStyled({ brand }) {
  const { data } = await styledRepo.list({ brand, page_size: 1000 });
  const rows = [];
  for (const s of data) {
    const [variants, imagesByColour, collections, bundles] = await Promise.all([
      variantsRepo.listVariants({ brand, styled_id: s.styled_id }),
      colourImageMap(brand, s.styled_id),
      collectionsForStyled(brand, s.styled_id),
      bundlesForStyled(brand, s.styled_id),
    ]);
    if (!variants.length) {
      rows.push({
        styled_name: s.name,
        base: s.base_name,
        status: s.status,
        slug: s.slug,
        short_description: s.short_description,
        long_description: s.long_description,
        collections,
        bundles,
      });
      continue;
    }
    for (const v of variants) {
      rows.push({
        styled_name: s.name,
        base: v.base_product_name || s.base_name,
        colour: v.colour_name,
        hex: v.colour_hex,
        lace: v.lace_label || v.lace_code || "",
        size: v.size_code,
        price: v.effective_price_ngn,
        price_usd: v.price_override_usd,
        compare_at: v.compare_at_price_ngn,
        compare_at_usd: v.compare_at_price_usd,
        is_default_colour: yn(v.colour_is_default),
        collections,
        bundles,
        status: s.status,
        short_description: s.short_description,
        long_description: s.long_description,
        slug: s.slug,
        images: (imagesByColour.get(v.colour_id) || []).join(", "),
      });
    }
  }
  return buildWorkbook({
    sheets: [{ name: STYLED_SHEET, columns: templateCols(STYLED_COLUMNS), rows }],
  });
}

async function findStyledBySlug(brand, slug) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "styled_products")}
      WHERE slug = $1 AND is_deleted = false LIMIT 1`,
    [slug],
  );
  return rows[0] || null;
}

async function importStyled({ brand, user, request_id, buffer }) {
  const sheets = await parseWorkbook(buffer);
  const rows = sheets[STYLED_SHEET] ?? Object.values(sheets)[0] ?? [];

  // Resolve names → ids once.
  const baseRes = await query(
    `SELECT product_id, name FROM ${t(brand, "products")} WHERE is_deleted = false`,
  );
  const baseByName = nameIndex(baseRes.rows, "name");
  const colRes = await query(
    `SELECT collection_id, name FROM ${t(brand, "product_collections")} WHERE is_active = true`,
  );
  const collectionByName = nameIndex(colRes.rows, "name");
  const bundleRes = await query(
    `SELECT bundle_id, display_name FROM ${t(brand, "bundle_offers")} WHERE is_active = true`,
  );
  const bundleByName = nameIndex(bundleRes.rows, "display_name");
  const sizeTiers = await variantsRepo.listSizeTiers({ brand });
  const sizeByCode = new Map();
  for (const stz of sizeTiers) {
    sizeByCode.set(lc(stz.size_code), stz.size_code);
    if (stz.label) sizeByCode.set(lc(stz.label), stz.size_code);
  }
  const laceRows = await variantsRepo.listLaceSizes({ brand });
  const laceCodes = new Set(laceRows.map((l) => l.lace_code));

  const results = [];
  let created = 0;
  let updated = 0;

  // Group rows by Styled Name (first-seen order preserved).
  const groups = new Map();
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const line = i + 2;
    const styledName = str(raw["Styled Name*"]);
    if (!styledName) {
      results.push({ sheet: STYLED_SHEET, row: line, status: "skipped", reason: "Styled Name required" });
      continue;
    }
    const key = lc(styledName);
    if (!groups.has(key)) groups.set(key, { name: styledName, items: [] });
    groups.get(key).items.push({ raw, line });
  }

  for (const group of groups.values()) {
    const first = group.items[0].raw;
    const firstLine = group.items[0].line;
    const repBaseName = str(first["Base Product*"]);
    const repBase = repBaseName && baseByName.get(lc(repBaseName));
    if (!repBase) {
      results.push({ sheet: STYLED_SHEET, row: firstLine, status: "error", reason: `base "${repBaseName || ""}" not found for "${group.name}"` });
      continue;
    }
    const slug = str(first["Slug"]) || slugify(group.name);
    const laceLabels = [...new Set(group.items.map((it) => str(it.raw["Lace"])).filter(Boolean))];
    const laceCodeList = laceLabels.map(laceCodeOf).filter(Boolean);
    const prices = group.items.map((it) => num(it.raw["Retail Price (NGN)*"])).filter((x) => x !== null && x !== undefined);
    const anchor = prices.length ? Math.min(...prices) : null;
    const usdPrices = group.items.map((it) => num(it.raw["Retail Price (USD)"])).filter((x) => x !== null && x !== undefined);
    const usdAnchor = usdPrices.length ? Math.min(...usdPrices) : null;

    const input = {
      base_product_id: repBase.product_id,
      name: group.name,
      slug,
      short_description: str(first["Short Description"]) ?? null,
      long_description: str(first["Long Description"]) ?? null,
      retail_price_ngn: anchor,
      retail_price_usd: usdAnchor,
      lace_size_codes: laceCodeList.length ? laceCodeList : null,
    };

    let styled;
    try {
      const existing = await findStyledBySlug(brand, slug);
      if (existing) {
        styled = await styledRepo.update({ brand, id: existing.styled_id, patch: input });
        updated++;
        results.push({ sheet: STYLED_SHEET, row: firstLine, status: "updated", name: group.name });
      } else {
        styled = await styledService.create({ brand, user, request_id, input });
        created++;
        results.push({ sheet: STYLED_SHEET, row: firstLine, status: "created", name: group.name });
      }
    } catch (err) {
      results.push({ sheet: STYLED_SHEET, row: firstLine, status: "error", reason: err.userMessage || err.message });
      continue;
    }

    // Ensure a lace vocabulary entry for every code this product uses.
    for (const label of laceLabels) {
      const code = laceCodeOf(label);
      if (code && !laceCodes.has(code)) {
        await variantsRepo
          .createLaceSize({ brand, input: { lace_code: code, label, display_order: laceCodes.size } })
          .then(() => laceCodes.add(code))
          .catch(() => {});
      }
    }

    // Colours: find-or-create one per distinct colour name in the group.
    const colourIdByName = new Map();
    const existingColours = await variantsRepo.listColours({ brand, styled_id: styled.styled_id });
    for (const c of existingColours) colourIdByName.set(lc(c.name), c.colour_id);
    for (const it of group.items) {
      const cname = str(it.raw["Colour*"]);
      if (!cname || colourIdByName.has(lc(cname))) continue;
      try {
        const colour = await variantsService.createColour({
          brand, user, request_id, styled_id: styled.styled_id,
          input: {
            name: cname,
            hex: str(it.raw["Hex"]) ?? null,
            premium_ngn: 0, // per-variant price carries the truth; colour stays flat
            is_default: bool(it.raw["Default Colour?"]) ?? false,
          },
        });
        colourIdByName.set(lc(cname), colour.colour_id);
        for (const url of csv(it.raw["Image URLs (comma)"]) ?? []) {
          await catalogueRepo
            .addImage({
              brand,
              image: {
                product_id: repBase.product_id,
                styled_id: styled.styled_id,
                styled_colour_id: colour.colour_id,
                file_path: url, cdn_url: url, is_primary: false, uploaded_by: user.user_id,
              },
            })
            .catch(() => {});
        }
      } catch (err) {
        results.push({ sheet: STYLED_SHEET, row: it.line, status: "warn", reason: `colour "${cname}": ${err.userMessage || err.message}` });
      }
    }

    // Existing variants → map by (colour,size,lace) so re-import updates price.
    const existingVars = await variantsRepo.listVariants({ brand, styled_id: styled.styled_id });
    const vkey = (cid, size, lace) => `${cid}:${size}:${lace ?? ""}`;
    const varByKey = new Map(existingVars.map((v) => [vkey(v.colour_id, v.size_code, v.lace_code), v]));

    let vCreated = 0;
    for (const it of group.items) {
      const cname = str(it.raw["Colour*"]);
      const colour_id = cname && colourIdByName.get(lc(cname));
      const size_code = sizeByCode.get(lc(str(it.raw["Size*"]) || ""));
      const laceLabel = str(it.raw["Lace"]);
      const lace_code = laceLabel ? laceCodeOf(laceLabel) : null;
      const price = num(it.raw["Retail Price (NGN)*"]) ?? null;
      const price_usd = num(it.raw["Retail Price (USD)"]) ?? null;
      const compare_at = num(it.raw["Compare-at Price (NGN)"]) ?? null;
      const compare_at_usd = num(it.raw["Compare-at Price (USD)"]) ?? null;
      const rowBaseName = str(it.raw["Base Product*"]);
      const rowBase = (rowBaseName && baseByName.get(lc(rowBaseName))) || repBase;
      if (!colour_id) {
        results.push({ sheet: STYLED_SHEET, row: it.line, status: "warn", reason: `colour "${cname || ""}" unresolved` });
        continue;
      }
      if (!size_code) {
        results.push({ sheet: STYLED_SHEET, row: it.line, status: "warn", reason: `size "${str(it.raw["Size*"]) || ""}" not a known tier` });
        continue;
      }
      const key = vkey(colour_id, size_code, lace_code);
      try {
        if (varByKey.has(key)) {
          await variantsService.updateVariant({
            brand, user, request_id, styled_id: styled.styled_id,
            styled_variant_id: varByKey.get(key).styled_variant_id,
            patch: {
              price_override_ngn: price,
              price_override_usd: price_usd,
              compare_at_price_ngn: compare_at,
              compare_at_price_usd: compare_at_usd,
              base_product_id: rowBase.product_id,
            },
          });
        } else {
          const v = await variantsService.createVariant({
            brand, user, request_id, styled_id: styled.styled_id,
            input: {
              colour_id, size_code, lace_code, base_product_id: rowBase.product_id,
              price_override_ngn: price,
              price_override_usd: price_usd,
              compare_at_price_ngn: compare_at,
              compare_at_price_usd: compare_at_usd,
            },
          });
          varByKey.set(key, v);
          vCreated++;
        }
      } catch (err) {
        results.push({ sheet: STYLED_SHEET, row: it.line, status: "error", reason: err.userMessage || err.message });
      }
    }
    if (vCreated) {
      results.push({ sheet: STYLED_SHEET, row: firstLine, status: "info", reason: `${vCreated} variants for "${group.name}"` });
    }

    // Collections + bundles both curate the STYLED product (never the base).
    // Union the membership values across the group's rows.
    const cols = new Set();
    const bdls = new Set();
    for (const it of group.items) {
      (csv(it.raw["Collections (comma)"]) ?? []).forEach((x) => cols.add(x));
      (csv(it.raw["Bundles (comma)"]) ?? []).forEach((x) => bdls.add(x));
    }
    for (const cName of cols) {
      const col = collectionByName.get(lc(cName));
      if (!col) {
        results.push({ sheet: STYLED_SHEET, row: firstLine, status: "warn", reason: `collection "${cName}" not found` });
        continue;
      }
      await catalogueService
        .addCollectionMember({ brand, user, request_id, id: col.collection_id, input: { styled_id: styled.styled_id } })
        .catch(() => {});
    }
    for (const bName of bdls) {
      const bdl = bundleByName.get(lc(bName));
      if (!bdl) {
        results.push({ sheet: STYLED_SHEET, row: firstLine, status: "warn", reason: `bundle "${bName}" not found` });
        continue;
      }
      await bundleService
        .addComponent({ brand, id: bdl.bundle_id, component: { styled_id: styled.styled_id, quantity: 1, role: "core" } })
        .catch(() => {});
    }
  }

  return { created, updated, total: rows.length, results };
}

// ════════════════════════════════════════════════════════════
// Collections (single sheet, created independently)
// ════════════════════════════════════════════════════════════
const COLLECTION_SHEET = "Collections";
const COLLECTION_COLUMNS = [
  { header: "Name*", key: "name", width: 28 },
  { header: "Slug", key: "slug", width: 22 },
  { header: "Description", key: "description", width: 40 },
  { header: "Mode", key: "mode", width: 12, list: ["manual", "rule"] },
  { header: "Visible on website?", key: "is_visible_storefront", width: 18, list: ["yes", "no"] },
  { header: "Cover image URL", key: "hero_image_url", width: 30 },
];

async function collectionsTemplate() {
  return buildWorkbook({
    sheets: [
      {
        name: COLLECTION_SHEET,
        columns: templateCols(COLLECTION_COLUMNS),
        rows: [{ name: "Summer Edit", mode: "manual", is_visible_storefront: "yes" }],
      },
    ],
  });
}

async function exportCollections({ brand }) {
  const cols = await catalogueRepo.listCollections({ brand });
  const rows = cols.map((c) => ({
    name: c.name,
    slug: c.slug,
    description: c.description,
    mode: c.mode,
    is_visible_storefront: yn(c.is_visible_storefront),
    hero_image_url: c.hero_image_url,
  }));
  return buildWorkbook({
    sheets: [{ name: COLLECTION_SHEET, columns: templateCols(COLLECTION_COLUMNS), rows }],
  });
}

async function importCollections({ brand, user, request_id, buffer }) {
  const sheets = await parseWorkbook(buffer);
  const rows = sheets[COLLECTION_SHEET] ?? Object.values(sheets)[0] ?? [];
  const results = [];
  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const line = i + 2;
    const name = str(raw["Name*"]);
    if (!name) {
      results.push({ row: line, status: "skipped", reason: "missing name" });
      continue;
    }
    try {
      await catalogueService.createCollection({
        brand,
        user,
        request_id,
        input: {
          name,
          slug: str(raw["Slug"]) || slugify(name),
          description: str(raw["Description"]) ?? null,
          mode: str(raw["Mode"]) || "manual",
          is_visible_storefront: bool(raw["Visible on website?"]) ?? false,
          hero_image_url: str(raw["Cover image URL"]) ?? null,
        },
      });
      created++;
      results.push({ row: line, status: "created", name });
    } catch (err) {
      results.push({ row: line, status: "error", name, reason: err.userMessage || err.message });
    }
  }
  return { created, total: rows.length, results };
}

// ════════════════════════════════════════════════════════════
// Bundles (single sheet, header-only — components added in-app)
// ════════════════════════════════════════════════════════════
const BUNDLE_SHEET = "Bundles";
const BUNDLE_COLUMNS = [
  { header: "Bundle code", key: "bundle_code", width: 20 },
  { header: "Display name*", key: "display_name", width: 28 },
  { header: "Description", key: "description", width: 40 },
  { header: "Pricing model", key: "pricing_model", width: 18, list: ["fixed_bundle_price", "pct_off", "amount_off"] },
  { header: "Bundle price (NGN)", key: "bundle_price_ngn", width: 16 },
  { header: "Discount value", key: "discount_value", width: 14 },
  { header: "Visible on website?", key: "is_visible_storefront", width: 18, list: ["yes", "no"] },
  { header: "Cover image URL", key: "hero_image_url", width: 30 },
];

async function bundlesTemplate() {
  return buildWorkbook({
    sheets: [
      {
        name: BUNDLE_SHEET,
        columns: templateCols(BUNDLE_COLUMNS),
        rows: [{ display_name: "Wig Care Kit", pricing_model: "fixed_bundle_price", bundle_price_ngn: 35000, is_visible_storefront: "yes" }],
      },
    ],
  });
}

async function exportBundles({ brand }) {
  const { rows: bundles } = await query(
    `SELECT bundle_code, display_name, description, pricing_model,
            bundle_price_ngn, discount_value, is_visible_storefront, hero_image_url
       FROM ${t(brand, "bundle_offers")} ORDER BY display_order, display_name`,
  );
  const rows = bundles.map((b) => ({
    ...b,
    is_visible_storefront: yn(b.is_visible_storefront),
  }));
  return buildWorkbook({
    sheets: [{ name: BUNDLE_SHEET, columns: templateCols(BUNDLE_COLUMNS), rows }],
  });
}

async function importBundles({ brand, user, buffer }) {
  const sheets = await parseWorkbook(buffer);
  const rows = sheets[BUNDLE_SHEET] ?? Object.values(sheets)[0] ?? [];
  const results = [];
  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const line = i + 2;
    const display_name = str(raw["Display name*"]);
    if (!display_name) {
      results.push({ row: line, status: "skipped", reason: "missing display name" });
      continue;
    }
    try {
      // Header-only create (components are added in-app), so go straight to the
      // repo — the bundle service requires ≥1 component.
      await bundleRepo.createBundle({
        brand,
        user_id: user.user_id,
        input: {
          bundle_code:
            str(raw["Bundle code"]) ||
            `BDL-${slugify(display_name).toUpperCase().replace(/-/g, "").slice(0, 16)}`,
          display_name,
          description: str(raw["Description"]) ?? null,
          pricing_model: str(raw["Pricing model"]) || "fixed_bundle_price",
          bundle_price_ngn: num(raw["Bundle price (NGN)"]) ?? null,
          discount_value: num(raw["Discount value"]) ?? null,
          is_visible_storefront: bool(raw["Visible on website?"]) ?? false,
          hero_image_url: str(raw["Cover image URL"]) ?? null,
        },
      });
      created++;
      results.push({ row: line, status: "created", name: display_name });
    } catch (err) {
      results.push({ row: line, status: "error", name: display_name, reason: err.userMessage || err.message });
    }
  }
  return { created, total: rows.length, results };
}

module.exports = {
  styledTemplate,
  exportStyled,
  importStyled,
  collectionsTemplate,
  exportCollections,
  importCollections,
  bundlesTemplate,
  exportBundles,
  importBundles,
  // Exported for unit tests (column fidelity + lace-code normalisation).
  STYLED_SHEET,
  STYLED_COLUMNS,
  templateCols,
  laceCodeOf,
};
