"use strict";

const ExcelJS = require("exceljs");
const { slugify } = require("../../../src/modules/catalogue/shades.service");
const io = require("../../../src/modules/catalogue/shades.io");
const shadesRepo = require("../../../src/modules/catalogue/shades.repo");
const {
  parseWorkbook,
} = require("../../../src/services/spreadsheet.service");

describe("Shades — slugify (SEO URL key)", () => {
  test("kebab-cases a shade name", () => {
    expect(slugify("Icy Grey")).toBe("icy-grey");
    expect(slugify("Blacky by Nature")).toBe("blacky-by-nature");
    expect(slugify("Plum Cherry")).toBe("plum-cherry");
    expect(slugify("Khaleesi Blonde")).toBe("khaleesi-blonde");
  });

  test("strips punctuation and collapses separators", () => {
    expect(slugify("  Dark   Copper!! ")).toBe("dark-copper");
    expect(slugify("Brown/Jolie")).toBe("brown-jolie");
  });

  test("empty / falsy input yields an empty string (service falls back to 'shade')", () => {
    expect(slugify("")).toBe("");
    expect(slugify(null)).toBe("");
    expect(slugify(undefined)).toBe("");
  });
});

describe("Shades — import/export column fidelity", () => {
  // Export emits the import shape, so a download re-imports 1:1. Guard the
  // exact headers the importer reads against drift.
  test("the sheet name and required columns are stable", () => {
    expect(io.SHADE_SHEET).toBe("Shades");
    const headers = io.SHADE_COLUMNS.map((c) => c.header);
    expect(headers).toEqual([
      "Name*",
      "Slug",
      "Short Description",
      "Long Description",
      "Cover image URL",
      "Display order",
      "Active",
      "Meta title",
      "Meta description",
      "Products (comma)",
    ]);
  });

  test("templateCols drops internal-only fields but keeps header/key/width/list", () => {
    const cols = io.templateCols(io.SHADE_COLUMNS);
    const active = cols.find((c) => c.key === "is_active");
    expect(active).toMatchObject({ header: "Active", list: ["yes", "no"] });
  });

  test("the Products column carries comma-separated styled-product membership", () => {
    const products = io.SHADE_COLUMNS.find((c) => c.key === "products");
    expect(products).toMatchObject({ header: "Products (comma)" });
    // It forwards a guidance note (not a single-select dropdown — the cell holds
    // many comma-separated names), surfaced via templateCols.
    const col = io.templateCols(io.SHADE_COLUMNS).find(
      (c) => c.key === "products",
    );
    expect(typeof col.note).toBe("string");
    expect(col.list).toBeUndefined();
  });
});

describe("Shades — two-sheet template (Reference + Shades)", () => {
  afterEach(() => jest.restoreAllMocks());

  test("Sheet 1 lists every styled product; Sheet 2 seeds the comma Products cell", async () => {
    jest.spyOn(shadesRepo, "listStyledLookup").mockResolvedValue([
      { styled_id: "1", name: "Icy Pixie", styled_code: "STY-1" },
      { styled_id: "2", name: "Ashen Bob", styled_code: "STY-2" },
      { styled_id: "3", name: "Silver Wave", styled_code: "STY-3" },
    ]);

    const buf = await io.shadesTemplate({ brand: "pixiegirl" });

    // Reference sheet (first tab): read-only, lists all styled products + the
    // validation values the Shades sheet uses.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ref = wb.getWorksheet("Reference");
    expect(ref).toBeTruthy();
    expect(ref.getRow(1).values).toEqual(
      expect.arrayContaining(["Styled products", "Active (yes/no)"]),
    );
    const refNames = [];
    ref.eachRow((row, n) => {
      if (n > 1) refNames.push(row.getCell(1).value);
    });
    expect(refNames).toEqual(
      expect.arrayContaining(["Icy Pixie", "Ashen Bob", "Silver Wave"]),
    );

    // Shades sheet: parseWorkbook ignores the Reference tab and yields the data
    // rows; the sample row pre-fills the comma Products cell with real names.
    const sheets = await parseWorkbook(buf);
    expect(sheets.Reference).toBeUndefined();
    const shadeRows = sheets[io.SHADE_SHEET];
    expect(shadeRows).toHaveLength(1);
    expect(shadeRows[0]["Products (comma)"]).toBe(
      "Icy Pixie, Ashen Bob, Silver Wave",
    );
  });

  test("template degrades gracefully when the brand has no styled products", async () => {
    jest.spyOn(shadesRepo, "listStyledLookup").mockResolvedValue([]);
    const buf = await io.shadesTemplate({ brand: "pixiegirl" });
    const sheets = await parseWorkbook(buf);
    // No products to seed → the cell is blank, not the string "undefined".
    expect(sheets[io.SHADE_SHEET][0]["Products (comma)"] ?? "").toBe("");
  });
});
