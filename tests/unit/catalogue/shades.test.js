"use strict";

const { slugify } = require("../../../src/modules/catalogue/shades.service");
const io = require("../../../src/modules/catalogue/shades.io");

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
      "Visible on website?",
    ]);
  });

  test("templateCols drops internal-only fields but keeps header/key/width/list", () => {
    const cols = io.templateCols(io.SHADE_COLUMNS);
    const active = cols.find((c) => c.key === "is_active");
    expect(active).toMatchObject({ header: "Active", list: ["yes", "no"] });
  });
});
