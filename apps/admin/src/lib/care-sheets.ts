import type { CareCreateInput, CareVariantInput, CareSkuAtLocation } from "./care-accessories";
import type { Category } from "./catalogue";

/** Sheet parsing is deliberately independent of the wig/size importers. We
 * never infer a Care SKU from a name, product colour or a neighbouring row. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const cell = (r: Record<string, unknown>, name: string): string => {
  const key = Object.keys(r).find((k) => norm(k) === norm(name));
  return key ? String(r[key] ?? "").trim() : "";
};
const forbidden = ["batch", "batchnumber", "lot", "lotnumber", "expiry", "expirydate", "expiration", "expirationdate", "bestbefore"];
export function assertNoLotColumns(rows: Record<string, unknown>[]): void {
  if (rows.some((r) => Object.keys(r).some((h) => forbidden.includes(norm(h)))))
    throw new Error("Batch/lot and expiry columns are not supported in Care & Accessories SKU sheets");
}
const optionalMoney = (raw: string, row: number, label: string): number | null => {
  if (!raw) return null;
  const n = Number(raw.replace(/[,₦$\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Row ${row}: ${label} must be nonnegative`);
  return n;
};

export function catalogueDrafts(rows: Record<string, unknown>[], categories: Category[]): { items: CareCreateInput[]; errors: string[] } {
  if (!rows.length) throw new Error("No data rows found");
  assertNoLotColumns(rows);
  for (const h of ["Name", "SKU", "Category", "Tax Treatment"])
    if (!Object.keys(rows[0]).some((key) => norm(key) === norm(h))) throw new Error(`Missing column: ${h}`);
  const groups = new Map<string, { item: CareCreateInput; start: number }>();
  const usedSku = new Set<string>(); const errors: string[] = [];
  rows.forEach((row, i) => {
    const at = i + 2;
    try {
      const name = cell(row, "Name"), code = cell(row, "Product Code"), sku = cell(row, "SKU"), label = cell(row, "Option Label");
      if (!name && !code && !sku) return;
      if (!name) throw new Error("Name required");
      const categoryText = cell(row, "Category");
      const category = categories.find((c) => [c.category_id, c.name, c.slug].some((s) => s?.toLowerCase() === categoryText.toLowerCase()));
      if (!category) throw new Error(`Select an active Care category for ${categoryText || "(blank)"}`);
      const tax = cell(row, "Tax Treatment").toLowerCase();
      if (tax !== "taxable" && tax !== "exempt") throw new Error("Tax treatment must be taxable or exempt");
      const rate = cell(row, "VAT Fraction");
      if (tax === "taxable" && (!rate || !Number.isFinite(Number(rate)) || Number(rate) < 0 || Number(rate) > 1)) throw new Error("Approved VAT fraction required for taxable item");
      if (tax === "exempt" && rate) throw new Error("Exempt item cannot have a VAT rate");
      if (sku && usedSku.has(sku)) throw new Error(`Duplicate SKU ${sku}`);
      if (sku) usedSku.add(sku);
      const key = code || `row-${at}`; // multi-option products require one explicit code on every row
      const v: CareVariantInput = {
        ...(sku ? { sku } : {}), ...(label ? { label } : {}), barcode: cell(row, "Barcode") || null,
        price_storefront_ngn: optionalMoney(cell(row, "Storefront NGN"), at, "Storefront NGN"),
        price_pos_ngn: optionalMoney(cell(row, "Staff POS NGN"), at, "Staff POS NGN"),
        price_storefront_usd: optionalMoney(cell(row, "Storefront USD"), at, "Storefront USD"),
        price_pos_usd: optionalMoney(cell(row, "Staff POS USD"), at, "Staff POS USD"),
        reorder_point: Number(cell(row, "Reorder Point") || 0),
      };
      if (!Number.isSafeInteger(v.reorder_point) || v.reorder_point! < 0) throw new Error("Reorder point must be a whole nonnegative number");
      const existing = groups.get(key);
      if (existing) {
        if (existing.item.name !== name || existing.item.category_id !== category.category_id || existing.item.taxable !== (tax === "taxable") || existing.item.vat_rate !== (tax === "taxable" ? Number(rate) : null))
          throw new Error(`Code ${code} has inconsistent product fields; check row ${existing.start}`);
        existing.item.variants.push(v);
      } else {
        groups.set(key, { start: at, item: {
          name, ...(code ? { product_code: code } : {}), category_id: category.category_id,
          taxable: tax === "taxable", vat_rate: tax === "taxable" ? Number(rate) : null,
          short_description: cell(row, "Short Description") || null, long_description: cell(row, "Long Description") || null,
          ingredients: cell(row, "Ingredients") || null, directions: cell(row, "Directions") || null,
          warnings: cell(row, "Warnings") || null,
          search_keywords: cell(row, "Search Keywords").split(",").map((s) => s.trim()).filter(Boolean), variants: [v],
        } });
      }
    } catch (e) { errors.push(`Row ${at}: ${e instanceof Error ? e.message : "Invalid data"}`); }
  });
  for (const { item, start } of groups.values())
    if (item.variants.length > 1 && item.variants.some((v) => !v.sku || !v.label)) errors.push(`Row ${start}: all labelled options must have exact SKUs`);
  if (groups.size > 50) errors.push("Import at most 50 products per sheet");
  if (!groups.size) errors.push("No care items found");
  return { items: [...groups.values()].map((g) => g.item), errors };
}

export interface CareReceiptLine {
  sku: string; variant_id: string; product_name: string; variant_name: string;
  quantity: number; unit_cost_ngn: number;
}
export function careReceiptLines(rows: Record<string, unknown>[], skus: CareSkuAtLocation[]): { lines: CareReceiptLine[]; errors: string[] } {
  if (!rows.length) throw new Error("The sheet has no data rows");
  assertNoLotColumns(rows);
  if (!Object.keys(rows[0]).some((h) => norm(h) === "sku")) throw new Error("A SKU column is required");
  const bySku = new Map(skus.filter((s) => s.is_active).map((s) => [s.sku, s]));
  const seen = new Set<string>(); const lines: CareReceiptLine[] = []; const errors: string[] = [];
  for (const [index, row] of rows.entries()) {
    const sku = cell(row, "SKU"), units = cell(row, "Units"), cost = cell(row, "Operational unit cost NGN");
    if (!sku && !units && !cost && !Object.values(row).some((v) => String(v ?? "").trim())) continue;
    const at = `Row ${index + 2}`;
    if (!sku) { errors.push(`${at}: SKU required`); continue; }
    if (seen.has(sku)) { errors.push(`${at}: duplicate SKU ${sku}`); continue; }
    seen.add(sku);
    const v = bySku.get(sku);
    if (!v) { errors.push(`${at}: ${sku} is not an active Care SKU`); continue; }
    // A template lists many blank SKUs; only nonblank quantities/costs are received.
    if (!units && !cost) continue;
    const q = Number(units), c = Number(cost.replace(/[,₦\s]/g, ""));
    if (!Number.isSafeInteger(q) || q <= 0 || !cost || !Number.isFinite(c) || c <= 0) {
      errors.push(`${at}: enter a positive whole Units value and a positive operational unit cost`); continue;
    }
    lines.push({ sku, variant_id: v.variant_id, product_name: v.product_name, variant_name: v.variant_name, quantity: q, unit_cost_ngn: c });
  }
  return { lines, errors };
}
