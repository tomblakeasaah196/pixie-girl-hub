"use strict";

/**
 * Turn matched count rows + what the shelf currently holds into the lines of a
 * `count` stock adjustment — and into the reasons NOT to file one.
 *
 * This is the half of the import that can do damage. A line here becomes a
 * stock movement once the adjustment is posted, and with `unlisted: 'zero'` a
 * product the sheet never named is written down to nil. So everything below
 * fails closed: anything ambiguous is reported as a problem rather than
 * resolved with a guess, and `blockers()` collects the conditions under which
 * the caller must refuse to write.
 *
 * Pure — no database, no filesystem.
 */

/**
 * Pick the variant a counted base product's stock lives on.
 *
 * Base products in this catalogue carry one stock-bearing variant (Goods
 * Reception resolves them the same way). When several variants of one base
 * hold stock the count is genuinely ambiguous — the sheet counted the base,
 * not its variants — so that base is reported instead of guessed at.
 */
function resolveVariant(variants) {
  if (!variants || variants.length === 0)
    return { error: "no stock-bearing variant — open it in Catalogue" };
  const stocked = variants.filter((v) => v.on_hand !== 0);
  if (stocked.length > 1)
    return {
      error: `stock spread across ${stocked.length} variants (${stocked
        .map((v) => `${v.sku}: ${v.on_hand}u`)
        .join(", ")}) — reconcile it by hand`,
    };
  return { variant: stocked[0] || variants[0] };
}

/**
 * Which location the count covers. Named explicitly, else the only one holding
 * stock, else the default.
 *
 * Refuses to guess when two locations hold stock and unlisted products are to
 * be zeroed: the sheet has no location column, so counting the wrong warehouse
 * would empty it.
 */
function resolveLocation(locations, wanted, unlisted) {
  if (wanted) {
    const hit = locations.find(
      (l) =>
        l.location_id === wanted ||
        l.display_name.toLowerCase() === String(wanted).toLowerCase(),
    );
    if (!hit) throw new Error(`No stock location matching '${wanted}'`);
    return hit;
  }
  const stocked = locations.filter((l) => l.on_hand > 0);
  if (stocked.length === 1) return stocked[0];
  if (stocked.length > 1 && unlisted === "zero")
    throw new Error(
      `Stock sits at ${stocked.length} locations (${stocked
        .map((l) => `${l.display_name}: ${l.on_hand}u`)
        .join(", ")}). ` +
        "The sheet has no location column, so name the one it covers with " +
        "--location, or use --unlisted=skip to leave un-counted products alone.",
    );
  const fallback = locations.find((l) => l.is_default && l.is_active);
  if (!fallback)
    throw new Error(
      "No active stock location to count against — pass --location.",
    );
  return fallback;
}

/**
 * Build the adjustment lines.
 *
 * One line per variant whose counted number differs from the system's, plus —
 * when `unlisted` is 'zero' — a write-down to nil for every variant still
 * holding stock whose base product the sheet never named.
 *
 * A product whose count already matches produces NO line: `postAdjustment`
 * skips zero deltas anyway, and leaving them out keeps the adjustment a
 * readable list of what actually changed.
 */
function buildLines({ matched, levelsByProduct, unlisted, matchedProductIds }) {
  const lines = [];
  const problems = [];
  const unchanged = [];

  for (const hit of matched) {
    const variants = levelsByProduct.get(hit.product.product_id);
    const resolved = resolveVariant(variants);
    if (resolved.error) {
      problems.push({
        row: hit.row,
        product: hit.product,
        error: resolved.error,
      });
      continue;
    }
    const system_count = resolved.variant.on_hand;
    const entry = {
      kind: "counted",
      row: hit.row,
      product: hit.product,
      variant: resolved.variant,
      system_count,
      physical_count: hit.units,
    };
    if (system_count === hit.units) unchanged.push(entry);
    else lines.push(entry);
  }

  if (unlisted === "zero") {
    for (const [product_id, variants] of levelsByProduct) {
      if (matchedProductIds.has(product_id)) continue;
      for (const v of variants) {
        if (v.on_hand <= 0) continue;
        lines.push({
          kind: "unlisted",
          row: null,
          product: { product_id, name: v.variant_name || v.sku },
          variant: v,
          system_count: v.on_hand,
          physical_count: 0,
        });
      }
    }
  }

  return { lines, problems, unchanged };
}

/** Surplus / write-down / net, in units, across the lines. */
function summarise(lines) {
  const surplus = lines.reduce(
    (s, l) => s + Math.max(0, l.physical_count - l.system_count),
    0,
  );
  const writeDown = lines.reduce(
    (s, l) => s + Math.max(0, l.system_count - l.physical_count),
    0,
  );
  return { surplus, writeDown, net: surplus - writeDown };
}

/**
 * Every reason this count must not be filed unattended.
 *
 * An unmatched row is the dangerous one: with `unlisted: 'zero'` the products
 * behind it were never marked as counted, so they fall into the write-down-to-
 * nil bucket. A sheet that half-matched would quietly empty the shelf.
 */
function blockers({ conflicts, badRows, unmatched, problems }) {
  const out = [];
  if (conflicts.length)
    out.push(`${conflicts.length} combination(s) counted twice, differently`);
  if (badRows.length) out.push(`${badRows.length} unreadable row(s)`);
  if (unmatched.length)
    out.push(`${unmatched.length} row(s) matched no base product`);
  if (problems.length)
    out.push(
      `${problems.length} product(s) whose stock can't be pinned to one variant`,
    );
  return out;
}

module.exports = {
  resolveVariant,
  resolveLocation,
  buildLines,
  summarise,
  blockers,
};
