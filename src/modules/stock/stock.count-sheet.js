"use strict";

/**
 * Parse + match a physical stock-count sheet against the base-product
 * catalogue. Pure functions only — no database, no filesystem — so the
 * matching rules are unit-testable without a live schema.
 *
 * THE SHEET
 * ─────────
 * The CEO counts wigs on one row per sellable combination, describing it by
 * the four axes a base product is keyed on:
 *
 *   Color | Texture | Cap Construction | Size | Units No.
 *   black | Straight| HD13*4           | M    | 20
 *
 * There is no SKU and no product code — the operator counting a shelf does not
 * have those — so a row is matched to a base product by NORMALISING all four
 * axes and looking for them inside the product's name (or its structured
 * columns when those are populated). `normKey` collapses the spelling
 * differences that show up between a hand-typed sheet and the catalogue:
 * case, spaces, punctuation, and the `*` / `×` / `x` the lace construction is
 * written with (`HD13*4` · `HD13×4` · `hd 13 x 4` all collapse to `hd13x4`).
 *
 * A row matches only when EXACTLY ONE base product carries all four axes.
 * Zero candidates and two-or-more candidates are both reported as errors and
 * never guessed at — an import that silently picks one of two look-alike
 * products writes a wrong count into the ledger.
 */

/** Sizes as the catalogue may spell them, longest alias first so 'extralarge'
 *  is tested before 'large' and 'l'. */
const SIZE_ALIASES = [
  ["XL", ["extralarge", "xlarge", "xl"]],
  ["L", ["large", "l"]],
  ["M", ["medium", "med", "m"]],
  ["S", ["small", "sml", "s"]],
];

/** Accepted spellings for each sheet column, normalised. */
const COLUMN_ALIASES = {
  colour: ["color", "colour", "shade"],
  texture: ["texture", "hairtexture", "curl"],
  cap: [
    "capconstruction",
    "cap",
    "construction",
    "lace",
    "lacetype",
    "lacesize",
  ],
  size: ["size", "capsize", "headsize"],
  units: ["unitsno", "units", "unit", "quantity", "qty", "count", "onhand"],
  // Present when the sheet came from our own downloadable template, which
  // pre-fills one row per base product. A code is an exact identity, so it
  // beats the four fuzzy axes whenever it is there.
  code: ["productcode", "code", "sku"],
  product: ["productname", "product", "baseproduct", "name"],
};

/**
 * Collapse a value to a comparison key: lowercase, `*` and `×` folded to `x`,
 * every other non-alphanumeric dropped. `HD13*4` → `hd13x4`, `T1b/dark grey`
 * → `t1bdarkgrey`, `4mm curl` → `4mmcurl`.
 */
function normKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[*×]/g, "x")
    .replace(/[^a-z0-9]/g, "");
}

/** Canonical S/M/L/XL for a sheet cell, or null when unrecognised. Tolerates
 *  the 'Xl' / 'xl' / 'Extra Large' spellings a hand-typed sheet produces. */
function canonicalSize(value) {
  const k = normKey(value);
  if (!k) return null;
  for (const [code, aliases] of SIZE_ALIASES)
    if (aliases.includes(k)) return code;
  return null;
}

/**
 * The size a catalogue product is in, read off the TAIL of its name
 * ('… Pixie Wig - Small' → 'S') and falling back to its `cap_size` column.
 *
 * Matched against the RAW name, not `normKey`, because the size has to be its
 * own word: normalising strips the separators, and 'small' then ends with the
 * letter 'l', which would read every Small product as a Large. The alias list
 * is longest-first so 'extra large' wins over 'large'.
 */
const SIZE_TAIL =
  /(?:^|[\s\-–—·|,(])\s*(extra\s*large|x\s*-?\s*large|xlarge|xl|large|medium|med|small|sml|l|m|s)\s*\)?\s*$/i;

function productSize(product) {
  const tail = SIZE_TAIL.exec(String(product.name ?? ""));
  if (tail) {
    const code = canonicalSize(tail[1]);
    if (code) return code;
  }
  return canonicalSize(product.cap_size);
}

/**
 * Everything about a product that a sheet axis could match against: its name
 * plus the structured catalogue columns, all normalised into one haystack.
 */
function productHaystack(product) {
  return normKey(
    [
      product.name,
      product.primary_colour,
      product.texture_type,
      product.lace_type,
      ...(product.lace_size_codes || []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** Read a row's value for a logical column by any accepted header spelling. */
function pick(row, column) {
  const wanted = COLUMN_ALIASES[column];
  for (const [header, value] of Object.entries(row)) {
    if (wanted.includes(normKey(header))) {
      const s = String(value ?? "").trim();
      if (s) return s;
    }
  }
  return "";
}

/**
 * A raw row may carry its own 1-based spreadsheet row number under this key.
 *
 * Position in the array is NOT a reliable row number: a reader that drops
 * blank rows (SheetJS `sheet_to_json` does by default) silently shifts every
 * row after the first gap, and a caller that filters before parsing shifts
 * them again. Either way the operator is sent to the wrong line in Excel. A
 * caller that knows the true row stamps it here and the drift is impossible.
 */
const ROW_NUMBER_KEY = "__excel_row";

/**
 * Turn raw sheet rows (header → cell objects) into count rows.
 *
 * `units` is `null` for a blank cell and a non-negative integer otherwise —
 * the caller decides what a blank MEANS (not counted, or counted as zero),
 * because that choice determines whether 55 blank rows are left alone or
 * written down to nil.
 *
 * Rows with no colour at all are dropped: the sheet uses empty rows as
 * visual separators between colour blocks.
 */
function parseCountRows(rawRows) {
  const out = [];
  rawRows.forEach((raw, index) => {
    const stamped = Number(raw?.[ROW_NUMBER_KEY]);
    const code = pick(raw, "code");
    const productName = pick(raw, "product");
    const colour = pick(raw, "colour");
    const texture = pick(raw, "texture");
    const cap = pick(raw, "cap");
    const sizeRaw = pick(raw, "size");
    const unitsRaw = pick(raw, "units");
    if (
      !code &&
      !productName &&
      !colour &&
      !texture &&
      !cap &&
      !sizeRaw &&
      !unitsRaw
    )
      return;

    const size = canonicalSize(sizeRaw);
    const unitsNum = unitsRaw === "" ? null : Number(unitsRaw);
    const unitsOk =
      unitsNum === null ||
      (Number.isFinite(unitsNum) &&
        unitsNum >= 0 &&
        Number.isInteger(unitsNum));

    // A row from our own template identifies its product outright, so the four
    // axes are only REQUIRED when there is no code and no name to fall back on.
    const identified = Boolean(code || productName);

    let error = null;
    if (identified) {
      if (!unitsOk) error = `'${unitsRaw}' is not a whole number of units`;
    } else if (!colour) error = "Missing colour";
    else if (!texture) error = "Missing texture";
    else if (!cap) error = "Missing cap construction";
    else if (!sizeRaw) error = "Missing size";
    else if (!size) error = `Unrecognised size '${sizeRaw}'`;
    else if (!unitsOk) error = `'${unitsRaw}' is not a whole number of units`;

    out.push({
      // What the operator sees in Excel. Trust the caller's stamp when it has
      // one; otherwise assume the array still holds every row, header first.
      row: Number.isInteger(stamped) && stamped > 0 ? stamped : index + 2,
      code,
      productName,
      colour,
      texture,
      cap,
      size,
      sizeRaw,
      units: unitsOk ? unitsNum : null,
      error,
    });
  });
  return out;
}

/**
 * A row's identity, for de-duplication — the product code when the sheet came
 * from our template, otherwise the four axes. Keyed the same way the row will
 * be matched, so two rows that will land on one product collapse here first.
 */
function rowKey(row) {
  if (row.code) return `code:${normKey(row.code)}`;
  if (row.productName && !row.colour) return `name:${normKey(row.productName)}`;
  return [row.colour, row.texture, row.cap, row.size].map(normKey).join("|");
}

/**
 * Collapse rows that name the same combination twice.
 *
 * A blank alongside a number is the common case (the sheet lists a combination
 * in two colour blocks and only one was filled in) and resolves to the number.
 * Two DIFFERENT numbers cannot be resolved — the count for that combination is
 * genuinely unknown — so both rows are returned as an error for a human.
 * Identical numbers collapse silently.
 */
function dedupeRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (row.error) continue;
    const key = rowKey(row);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }

  const merged = [];
  const conflicts = [];
  for (const group of byKey.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const counted = group.filter((r) => r.units !== null);
    const distinct = new Set(counted.map((r) => r.units));
    if (distinct.size > 1) {
      conflicts.push({
        key: rowKey(group[0]),
        rows: group,
        message: `Rows ${group.map((r) => r.row).join(" & ")} count the same wig differently (${[...distinct].join(" vs ")})`,
      });
      continue;
    }
    merged.push({
      ...group[0],
      units: counted.length ? counted[0].units : null,
      mergedFrom: group.map((r) => r.row),
    });
  }
  return { rows: merged, conflicts };
}

/**
 * Find the one base product a count row describes.
 *
 * Returns `{ product }` on a unique hit, or `{ error, candidates }` when the
 * sheet names something the catalogue does not have (or has twice). Never
 * picks a winner among several — an ambiguous match must reach a human.
 */
function matchRow(row, products) {
  // A product code is an exact identity — when the sheet carries one (every
  // row of our downloadable template does), it settles the match outright and
  // no amount of axis drift can move it.
  if (row.code) {
    const key = normKey(row.code);
    const byCode = products.find((p) => normKey(p.product_code) === key);
    if (byCode) return { product: byCode };
    return {
      error: `No base product with code '${row.code}'`,
      candidates: [],
    };
  }

  // Then the full product name, which the template also carries.
  if (row.productName) {
    const key = normKey(row.productName);
    const byName = products.filter((p) => normKey(p.name) === key);
    if (byName.length === 1) return { product: byName[0] };
    if (byName.length > 1)
      return {
        error: `${byName.length} base products are named '${row.productName}'`,
        candidates: byName,
      };
    // A name that matches nothing still falls through to the axes below, so a
    // renamed product is found by what it is rather than what it was called.
  }

  const described = [row.colour, row.texture, row.cap].filter(Boolean);
  if (described.length < 3 || !row.size)
    return {
      error: row.productName
        ? `No base product named '${row.productName}'`
        : "Row names no product and gives no colour/texture/cap/size",
      candidates: [],
    };

  const wanted = described.map(normKey);
  const candidates = products.filter((p) => {
    if (productSize(p) !== row.size) return false;
    const hay = productHaystack(p);
    return wanted.every((axis) => hay.includes(axis));
  });

  if (candidates.length === 1) return { product: candidates[0] };
  if (candidates.length === 0)
    return {
      error: `No base product for ${row.colour} · ${row.texture} · ${row.cap} · ${row.size}`,
      candidates: [],
    };
  return {
    error:
      `${candidates.length} base products match ${row.colour} · ${row.texture} · ` +
      `${row.cap} · ${row.size} — the catalogue has duplicates`,
    candidates,
  };
}

/**
 * Match every row, returning the resolved rows and the ones that need a human.
 *
 * `blank` decides what an empty Units cell means:
 *   'skip' — the combination was not counted; leave the system's number alone.
 *   'zero' — the combination was counted and there are none; write it down to 0.
 */
function matchRows(rows, products, { blank = "skip" } = {}) {
  const matched = [];
  const unmatched = [];
  const skipped = [];

  for (const row of rows) {
    if (row.error) {
      unmatched.push({ row, error: row.error });
      continue;
    }
    const hit = matchRow(row, products);
    if (hit.error) {
      unmatched.push({ row, error: hit.error, candidates: hit.candidates });
      continue;
    }
    if (row.units === null && blank === "skip") {
      skipped.push({ row, product: hit.product });
      continue;
    }
    matched.push({ row, product: hit.product, units: row.units ?? 0 });
  }
  return { matched, unmatched, skipped };
}

module.exports = {
  ROW_NUMBER_KEY,
  normKey,
  canonicalSize,
  productSize,
  productHaystack,
  parseCountRows,
  rowKey,
  dedupeRows,
  matchRow,
  matchRows,
  SIZE_ALIASES,
  COLUMN_ALIASES,
};
