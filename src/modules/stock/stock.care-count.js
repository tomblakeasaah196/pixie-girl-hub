"use strict";

/**
 * PR 1 physical count for Care & Accessories. Identity is the EXACT SKU,
 * never a product name/code or a guessed default variant. A wig sheet and
 * retail sheet have disjoint SQL scopes even with unlisted=zero.
 * Pure so a forged FLH SKU, duplicate or partial count can be tested offline.
 */
const unsupportedColumns = new Set([
  "batch", "batchnumber", "lot", "lotnumber", "expiry", "expirydate",
  "expiration", "expirationdate", "bestbefore",
]);
function cell(row, names) {
  for (const [key, value] of Object.entries(row)) {
    if (names.includes(key.toLowerCase().replace(/[^a-z0-9]/g, "")))
      return value === null || value === undefined ? "" : String(value).trim();
  }
  return "";
}

function plan({ rows, variants, blank = "skip", unlisted = "skip" }) {
  const bySku = new Map(variants.map((v) => [v.sku, v]));
  const seen = new Set();
  const lines = [], unchanged = [], skipped = [], blockers = [];

  for (const [index, row] of rows.entries()) {
    const at = `Row ${index + 2}`;
    if (Object.keys(row).some((key) => unsupportedColumns.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")))) {
      blockers.push(`${at}: batch/lot and expiry columns are not supported for Care SKU counts`);
      continue;
    }
    const sku = cell(row, ["sku"]);
    const unitsText = cell(row, ["units", "unitsno", "physicalcount", "count", "quantity", "qty"]);
    // A name-only row is a blocker, not a quietly omitted product or a
    // license to guess which of its 50 ml / 100 ml options was counted.
    if (!sku && !unitsText && !Object.values(row).some((v) => String(v ?? "").trim())) continue;
    if (!sku) { blockers.push(`${at}: exact SKU is required`); continue; }
    if (seen.has(sku)) { blockers.push(`${at}: duplicate SKU ${sku}`); continue; }
    seen.add(sku);
    const v = bySku.get(sku);
    if (!v) { blockers.push(`${at}: SKU ${sku} is not a PXG Care & Accessories SKU`); continue; }
    if (unitsText === "" && blank === "skip") {
      skipped.push({ row: index + 2, sku });
      continue;
    }
    const qty = unitsText === "" ? 0 : Number(unitsText);
    if (!Number.isSafeInteger(qty) || qty < 0) {
      blockers.push(`${at}: units must be a whole nonnegative number`);
      continue;
    }
    const entry = {
      row: index + 2, kind: "counted", variant_id: v.variant_id,
      product_id: v.product_id, product_name: v.product_name,
      sku, variant_name: v.variant_name, system_count: Number(v.on_hand),
      physical_count: qty, delta: qty - Number(v.on_hand),
    };
    if (qty < Number(v.reserved))
      blockers.push(`${at}: ${sku} has ${v.reserved} units reserved; cannot count below that`);
    if (entry.delta !== 0 && !v.has_operational_cost)
      blockers.push(`${at}: ${sku} has no positive operational cost; receive a costed SKU before adjusting`);
    if (entry.delta === 0) unchanged.push(entry);
    else lines.push(entry);
  }

  if (unlisted === "zero") {
    for (const v of variants) {
      if (seen.has(v.sku) || Number(v.on_hand) === 0) continue;
      const entry = {
        row: null, kind: "unlisted", variant_id: v.variant_id,
        product_id: v.product_id, product_name: v.product_name,
        sku: v.sku, variant_name: v.variant_name,
        system_count: Number(v.on_hand), physical_count: 0,
        delta: -Number(v.on_hand),
      };
      if (Number(v.reserved) > 0)
        blockers.push(`Unlisted ${v.sku} has ${v.reserved} reserved units; cannot zero it`);
      if (!v.has_operational_cost)
        blockers.push(`Unlisted ${v.sku} has no positive operational cost`);
      lines.push(entry);
    }
  }

  const surplus = lines.reduce((n, l) => n + Math.max(l.delta, 0), 0);
  const writeDown = lines.reduce((n, l) => n + Math.max(-l.delta, 0), 0);
  const systemTotal = variants.reduce((n, v) => n + Number(v.on_hand), 0);
  return {
    lines, unchanged, skipped, blockers,
    summary: {
      rows_read: rows.length, corrections: lines.filter((l) => l.kind === "counted").length,
      zeroed: lines.filter((l) => l.kind === "unlisted").length,
      unchanged: unchanged.length, surplus, write_down: writeDown,
      net: surplus - writeDown, system_total: systemTotal,
      ends_at: systemTotal + surplus - writeDown,
    },
  };
}

module.exports = { plan };
