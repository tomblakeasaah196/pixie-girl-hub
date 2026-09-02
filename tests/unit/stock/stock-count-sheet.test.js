"use strict";

/**
 * The count-sheet parser + matcher behind `stock.count-sheet.js`.
 *
 * These rules decide which base product a hand-typed row lands on, and a wrong
 * landing writes a wrong number into the ledger — so the tests pin the three
 * things that actually go wrong with a sheet a person filled in on a shelf:
 *   1. Spelling drift ('Xl' vs 'XL', 'HD13*4' vs 'HD13x4') must still match.
 *   2. A blank cell is NOT a zero unless the caller says so.
 *   3. Ambiguity — a combination counted twice with different numbers, or two
 *      catalogue products answering to one row — is reported, never guessed.
 */

const {
  normKey,
  canonicalSize,
  productSize,
  parseCountRows,
  dedupeRows,
  matchRow,
  matchRows,
} = require("../../../src/modules/stock/stock.count-sheet");

const HEADERS = ["Color", "Texture", "Cap Construction", "Size", "Units No."];
const sheetRow = (colour, texture, cap, size, units) =>
  Object.fromEntries(
    HEADERS.map((h, i) => [h, [colour, texture, cap, size, units][i]]),
  );

const product = (name, extra = {}) => ({
  product_id: name.toLowerCase().replace(/\W/g, "-"),
  name,
  primary_colour: null,
  texture_type: null,
  lace_type: null,
  cap_size: null,
  lace_size_codes: null,
  ...extra,
});

// ── normalisation ────────────────────────────────────────

describe("normKey", () => {
  test("folds the ways a lace construction gets typed", () => {
    expect(normKey("HD13*4")).toBe("hd13x4");
    expect(normKey("HD13×4")).toBe("hd13x4");
    expect(normKey("hd 13 x 4")).toBe("hd13x4");
    expect(normKey("HD13X4")).toBe("hd13x4");
  });

  test("strips the punctuation colour codes carry", () => {
    expect(normKey("T1b/dark grey")).toBe("t1bdarkgrey");
    expect(normKey("#613")).toBe("613");
    expect(normKey("T2/light grey")).toBe("t2lightgrey");
  });
});

describe("canonicalSize", () => {
  test("accepts the spellings a hand-typed sheet produces", () => {
    expect(canonicalSize("XL")).toBe("XL");
    expect(canonicalSize("Xl")).toBe("XL"); // the real sheet's typo
    expect(canonicalSize("extra large")).toBe("XL");
    expect(canonicalSize("Medium")).toBe("M");
    expect(canonicalSize("s")).toBe("S");
  });

  test("rejects what it cannot be sure of", () => {
    expect(canonicalSize("")).toBeNull();
    expect(canonicalSize("petite")).toBeNull();
  });
});

describe("productSize", () => {
  test("reads the size off the tail of the product name", () => {
    expect(
      productSize(product("Black Straight HD13x4 Pixie Wig - Small")),
    ).toBe("S");
    expect(productSize(product("Black Straight HD13x4 Pixie Wig - XL"))).toBe(
      "XL",
    );
  });

  test("does not let a size word mid-name decide the size", () => {
    // 'Small Batch' must not make this an S; the tail says Large.
    expect(
      productSize(
        product("Small Batch Black Straight HD13x4 Pixie Wig - Large"),
      ),
    ).toBe("L");
  });

  test("falls back to the cap_size column when the name says nothing", () => {
    expect(productSize(product("Legacy Wig", { cap_size: "medium" }))).toBe(
      "M",
    );
    expect(productSize(product("Legacy Wig"))).toBeNull();
  });
});

// ── parsing ──────────────────────────────────────────────

describe("parseCountRows", () => {
  test("keeps a blank Units cell as null, not zero", () => {
    const [row] = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "S", ""),
    ]);
    expect(row.units).toBeNull();
    expect(row.error).toBeNull();
  });

  test("reads a counted row and numbers it as the operator sees it in Excel", () => {
    const rows = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "S", ""),
      sheetRow("black", "Straight", "HD13*4", "M", 20),
    ]);
    expect(rows[1]).toMatchObject({ row: 3, size: "M", units: 20 });
  });

  test("drops the blank separator rows between colour blocks", () => {
    const rows = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "M", 20),
      sheetRow("", "", "", "", ""),
      sheetRow("GG4", "Straight", "HD13*4", "M", 2),
    ]);
    expect(rows).toHaveLength(2);
    // The dropped row still costs a row number, so 'GG4' reports as row 4.
    expect(rows[1].row).toBe(4);
  });

  test("flags a row it cannot read rather than guessing", () => {
    const [missingSize] = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "", 3),
    ]);
    expect(missingSize.error).toMatch(/size/i);

    const [badSize] = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "petite", 3),
    ]);
    expect(badSize.error).toMatch(/Unrecognised size/);

    const [badUnits] = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "M", "a few"),
    ]);
    expect(badUnits.error).toMatch(/whole number/);
  });

  test("accepts the header spellings a re-typed sheet may use", () => {
    const [row] = parseCountRows([
      {
        Colour: "black",
        Texture: "Yaki",
        Lace: "HD13*6",
        "Cap Size": "L",
        Qty: 4,
      },
    ]);
    expect(row).toMatchObject({ colour: "black", size: "L", units: 4 });
    expect(row.error).toBeNull();
  });
});

// ── duplicate combinations ───────────────────────────────

describe("dedupeRows", () => {
  test("a blank alongside a number resolves to the number", () => {
    // This is the real sheet's duplicate: T1b/99J · Straight · HD6*6 left
    // part · S appears blank on one row and as 4 on another.
    const rows = parseCountRows([
      sheetRow("T1b/99J", "Straight", "HD6*6 left part", "S", ""),
      sheetRow("T1b/99J", "Straight", "HD6*6 left part", "S", 4),
    ]);
    const { rows: merged, conflicts } = dedupeRows(rows);
    expect(conflicts).toHaveLength(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].units).toBe(4);
    expect(merged[0].mergedFrom).toEqual([2, 3]);
  });

  test("two different numbers for one wig are a conflict, not a merge", () => {
    const rows = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "M", 20),
      sheetRow("black", "Straight", "HD13*4", "M", 8),
    ]);
    const { rows: merged, conflicts } = dedupeRows(rows);
    expect(merged).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].message).toMatch(/20 vs 8/);
  });

  test("matches across spelling differences in the same sheet", () => {
    const rows = parseCountRows([
      sheetRow("T2/dark copper", "Straight", "HD13*4", "XL", 2),
      sheetRow("T2/dark copper", "Straight", "hd13x4", "Xl", ""),
    ]);
    const { rows: merged, conflicts } = dedupeRows(rows);
    expect(conflicts).toHaveLength(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].units).toBe(2);
  });
});

// ── matching against the catalogue ───────────────────────

describe("matchRow", () => {
  const catalogue = [
    product("Black Straight HD13x4 Pixie Wig - Small"),
    product("Black Straight HD13x4 Pixie Wig - Medium"),
    product("Black Straight HD6x6 Left Part Pixie Wig - Medium"),
    product("T1b/Dark Grey Straight HD5x5 Left Part Pixie Wig - Small"),
    product("#613 Straight HD13x6 Pixie Wig - Medium"),
  ];

  test("matches on all four axes despite punctuation and case", () => {
    const [row] = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "M", 20),
    ]);
    expect(matchRow(row, catalogue).product.name).toBe(
      "Black Straight HD13x4 Pixie Wig - Medium",
    );
  });

  test("the size axis separates otherwise identical products", () => {
    const [row] = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "S", 7),
    ]);
    expect(matchRow(row, catalogue).product.name).toMatch(/Small$/);
  });

  test("the cap axis separates 13x4 from 6x6 left part", () => {
    const [row] = parseCountRows([
      sheetRow("black", "Straight", "HD6*6 left part", "M", 2),
    ]);
    expect(matchRow(row, catalogue).product.name).toMatch(/HD6x6 Left Part/);
  });

  test("matches a colour code that carries a slash and a hash", () => {
    const [grey] = parseCountRows([
      sheetRow("T1b/dark grey", "Straight", "HD5*5 left part", "S", 5),
    ]);
    expect(matchRow(grey, catalogue).product.name).toMatch(/T1b\/Dark Grey/);

    const [blonde] = parseCountRows([
      sheetRow("#613", "Straight", "HD13*6", "M", 8),
    ]);
    expect(matchRow(blonde, catalogue).product.name).toMatch(/#613/);
  });

  test("matches on the structured columns when the name carries nothing", () => {
    const structured = [
      product("FLH-0091", {
        primary_colour: "black",
        texture_type: "Yaki",
        lace_type: "HD13*6",
        cap_size: "large",
      }),
    ];
    const [row] = parseCountRows([sheetRow("black", "Yaki", "HD13*6", "L", 1)]);
    expect(matchRow(row, structured).product.product_code).toBeUndefined();
    expect(matchRow(row, structured).product.name).toBe("FLH-0091");
  });

  test("reports a combination the catalogue does not have", () => {
    const [row] = parseCountRows([
      sheetRow("black", "8mm curl", "HD13*4", "M", 3),
    ]);
    const hit = matchRow(row, catalogue);
    expect(hit.product).toBeUndefined();
    expect(hit.error).toMatch(/No base product/);
  });

  test("refuses to pick between two products that both answer the row", () => {
    const dupes = [
      product("Black Straight HD13x4 Pixie Wig - Medium"),
      product("Black Straight HD13x4 Pixie Wig (re-listed) - Medium"),
    ];
    const [row] = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "M", 20),
    ]);
    const hit = matchRow(row, dupes);
    expect(hit.product).toBeUndefined();
    expect(hit.error).toMatch(/2 base products match/);
    expect(hit.candidates).toHaveLength(2);
  });
});

// ── blank handling ───────────────────────────────────────

describe("matchRows blank handling", () => {
  const catalogue = [product("Black Straight HD13x4 Pixie Wig - Small")];
  const rows = parseCountRows([
    sheetRow("black", "Straight", "HD13*4", "S", ""),
  ]);

  test("blank=skip leaves the combination out of the correction", () => {
    const { matched, skipped } = matchRows(rows, catalogue, { blank: "skip" });
    expect(matched).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].product.name).toMatch(/Small$/);
  });

  test("blank=zero counts the combination as nil", () => {
    const { matched, skipped } = matchRows(rows, catalogue, { blank: "zero" });
    expect(skipped).toHaveLength(0);
    expect(matched).toEqual([
      expect.objectContaining({ units: 0, product: catalogue[0] }),
    ]);
  });

  test("an unreadable row is reported, never silently dropped", () => {
    const bad = parseCountRows([
      sheetRow("black", "Straight", "HD13*4", "", 3),
    ]);
    const { unmatched } = matchRows(bad, catalogue);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].error).toMatch(/size/i);
  });
});
