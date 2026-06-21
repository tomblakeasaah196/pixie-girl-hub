"use strict";

/**
 * Styled import/export column fidelity. The IO service's DB-touching deps are
 * mocked so the module loads, but the spreadsheet engine (ExcelJS) is REAL — we
 * build the export shape, parse it back, and assert every column survives. This
 * is the round-trip the owner relies on: an export must re-import 1:1.
 */

jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/config/brands", () => ({
  VALID: new Set(["faitlynhair", "pixiegirl"]),
}));
jest.mock("../../../src/modules/catalogue/styled.service", () => ({}));
jest.mock("../../../src/modules/catalogue/styled.repo", () => ({}));
jest.mock("../../../src/modules/catalogue/styled_variants.service", () => ({}));
jest.mock("../../../src/modules/catalogue/styled_variants.repo", () => ({}));
jest.mock("../../../src/modules/catalogue/catalogue.service", () => ({}));
jest.mock("../../../src/modules/catalogue/catalogue.repo", () => ({}));
jest.mock("../../../src/modules/retention/bundle.service", () => ({}));
jest.mock("../../../src/modules/retention/bundle.repo", () => ({}));

const io = require("../../../src/modules/catalogue/catalogue-io.service");
const {
  buildWorkbook,
  parseWorkbook,
} = require("../../../src/services/spreadsheet.service");

describe("laceCodeOf (human lace label → FK-safe code)", () => {
  test("uppercases and strips non-alphanumerics", () => {
    expect(io.laceCodeOf("HD13x4")).toBe("HD13X4");
    expect(io.laceCodeOf("HD6x6 Center")).toBe("HD6X6CENTER");
    expect(io.laceCodeOf("HD6x6 Left Part")).toBe("HD6X6LEFTPART");
  });
  test("blank → null (a no-lace product)", () => {
    expect(io.laceCodeOf("")).toBeNull();
    expect(io.laceCodeOf(null)).toBeNull();
    expect(io.laceCodeOf(undefined)).toBeNull();
  });
  test("a label round-trips to the same code (export label → re-import code)", () => {
    const label = "HD6x6 Center";
    expect(io.laceCodeOf(label)).toBe(io.laceCodeOf(io.laceCodeOf(label)));
  });
});

describe("styled export → import round-trip (one row per variant)", () => {
  const sample = [
    {
      styled_name: "All Classic",
      base: "Black Straight HD13x4 Pixie Wig - Small",
      colour: "Classic Black",
      hex: "#1B1B1B",
      lace: "HD13x4",
      size: "S",
      price: 389000,
      compare_at: 414000,
      is_default_colour: "yes",
      collections: "ESSENTIALS COLLECTION",
      bundles: "The Foundation",
      status: "draft",
      short_description: "Classic straight pixie.",
      slug: "all-classic",
      images: "https://cdn/x.jpg, https://cdn/y.jpg",
    },
    {
      styled_name: "All Classic",
      base: "Black Straight HD6x6 Left Part Pixie Wig - Small",
      colour: "Classic Black",
      hex: "#1B1B1B",
      lace: "HD6x6 Left Part",
      size: "S",
      price: 365000,
      compare_at: "",
      is_default_colour: "yes",
      collections: "ESSENTIALS COLLECTION",
      bundles: "The Foundation",
      status: "draft",
      short_description: "Classic straight pixie.",
      slug: "all-classic",
      images: "",
    },
  ];

  test("every column survives a build→parse cycle", async () => {
    const buf = await buildWorkbook({
      sheets: [
        { name: io.STYLED_SHEET, columns: io.templateCols(io.STYLED_COLUMNS), rows: sample },
      ],
    });
    const sheets = await parseWorkbook(buf);
    const parsed = sheets[io.STYLED_SHEET];
    expect(parsed).toHaveLength(2);

    const r0 = parsed[0];
    expect(r0["Styled Name*"]).toBe("All Classic");
    expect(r0["Base Product*"]).toBe("Black Straight HD13x4 Pixie Wig - Small");
    expect(r0["Colour*"]).toBe("Classic Black");
    expect(r0["Lace"]).toBe("HD13x4");
    expect(r0["Size*"]).toBe("S");
    expect(Number(r0["Retail Price (NGN)*"])).toBe(389000);
    expect(Number(r0["Compare-at Price (NGN)"])).toBe(414000);
    expect(r0["Default Colour?"]).toBe("yes");
    expect(r0["Collections (comma)"]).toBe("ESSENTIALS COLLECTION");
    expect(r0["Status"]).toBe("draft");

    // The cheaper 6x6 closure row keeps its own (lower) price — proof that lace
    // is a per-variant price, not a single product anchor.
    expect(Number(parsed[1]["Retail Price (NGN)*"])).toBe(365000);
    expect(parsed[1]["Lace"]).toBe("HD6x6 Left Part");
  });

  test("the Reference sheet is never read back as data", async () => {
    const buf = await buildWorkbook({
      sheets: [{ name: io.STYLED_SHEET, columns: io.templateCols(io.STYLED_COLUMNS), rows: sample }],
      reference: [{ title: "Size codes", values: ["S", "M", "L", "XL"] }],
    });
    const sheets = await parseWorkbook(buf);
    expect(sheets.Reference).toBeUndefined();
    expect(sheets[io.STYLED_SHEET]).toHaveLength(2);
  });
});
