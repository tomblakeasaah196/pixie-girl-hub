"use strict";

/**
 * Styled import — Shade column + diff-only re-import semantics.
 *
 * Owner ask: "export → edit hex codes and shades in Excel → import back and
 * it changes only these items". So we lock in:
 *   • The Styled Products sheet carries a "Shade" column.
 *   • On re-import, a resolvable Shade name re-homes styled_products.shade_id.
 *   • Existing colours' Hex is UPDATED on re-import (not silently skipped).
 *   • Blank cells preserve existing values — styled fields (short/long desc,
 *     prices) and variant price overrides are only patched when the row
 *     supplies them.
 */

const mockQuery = jest.fn();
jest.mock("../../../src/config/database", () => ({ query: mockQuery }));
jest.mock("../../../src/config/brands", () => ({
  VALID: new Set(["pixiegirl", "faitlynhair"]),
  t: (b, tbl) => `${b}.${tbl}`,
}));

const mockStyledService = { create: jest.fn() };
const mockStyledRepo = { update: jest.fn() };
jest.mock(
  "../../../src/modules/catalogue/styled.service",
  () => mockStyledService,
);
jest.mock("../../../src/modules/catalogue/styled.repo", () => mockStyledRepo);

const mockVariantsService = {
  createColour: jest.fn(),
  updateColour: jest.fn(),
  createVariant: jest.fn(),
  updateVariant: jest.fn(),
};
const mockVariantsRepo = {
  listSizeTiers: jest.fn(),
  listLaceSizes: jest.fn(),
  listColours: jest.fn(),
  listVariants: jest.fn(),
  createLaceSize: jest.fn(),
};
jest.mock(
  "../../../src/modules/catalogue/styled_variants.service",
  () => mockVariantsService,
);
jest.mock(
  "../../../src/modules/catalogue/styled_variants.repo",
  () => mockVariantsRepo,
);
jest.mock("../../../src/modules/catalogue/catalogue.service", () => ({
  addCollectionMember: jest.fn(),
}));
jest.mock("../../../src/modules/catalogue/catalogue.repo", () => ({
  addImage: jest.fn(),
}));

const mockShadesRepo = { list: jest.fn(), listStyledLookup: jest.fn() };
jest.mock(
  "../../../src/modules/catalogue/shades.repo",
  () => mockShadesRepo,
);
jest.mock("../../../src/modules/retention/bundle.service", () => ({
  addComponent: jest.fn(),
}));
jest.mock("../../../src/modules/retention/bundle.repo", () => ({}));

const io = require("../../../src/modules/catalogue/catalogue-io.service");
const { buildWorkbook } = require("../../../src/services/spreadsheet.service");

const EXISTING_BASE = "Black Straight HD13x4 Pixie Wig - Small";
const EXISTING_STYLED = {
  styled_id: "styled-1",
  styled_code: "STY-1",
  slug: "sample-pixie",
  name: "Sample Pixie",
};

function routeQueriesToExistingStyled(existingStyledRow = EXISTING_STYLED) {
  mockQuery.mockImplementation((sql) => {
    if (/FROM\s+\w+\.products\b/i.test(sql))
      return Promise.resolve({
        rows: [{ product_id: "base-1", name: EXISTING_BASE }],
      });
    if (/FROM\s+\w+\.product_collections/i.test(sql))
      return Promise.resolve({ rows: [] });
    if (/FROM\s+\w+\.bundle_offers/i.test(sql))
      return Promise.resolve({ rows: [] });
    // findStyledBySlug — returns the existing row so importStyled takes the
    // update branch (this is the round-trip we care about).
    if (/FROM\s+\w+\.styled_products/i.test(sql))
      return Promise.resolve(existingStyledRow ? { rows: [existingStyledRow] } : { rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

async function workbook(rows) {
  return buildWorkbook({
    sheets: [
      {
        name: io.STYLED_SHEET,
        columns: io.templateCols(io.STYLED_COLUMNS),
        rows,
      },
    ],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  routeQueriesToExistingStyled();
  mockVariantsRepo.listSizeTiers.mockResolvedValue([
    { size_code: "S", label: "Small" },
    { size_code: "M", label: "Medium" },
  ]);
  mockVariantsRepo.listLaceSizes.mockResolvedValue([{ lace_code: "HD13X4" }]);
  mockVariantsRepo.listColours.mockResolvedValue([]);
  mockVariantsRepo.listVariants.mockResolvedValue([]);
  mockVariantsService.createColour.mockResolvedValue({ colour_id: "col-1" });
  mockVariantsService.updateColour.mockResolvedValue({ colour_id: "col-existing" });
  mockVariantsService.createVariant.mockResolvedValue({
    styled_variant_id: "v-1",
  });
  mockVariantsService.updateVariant.mockResolvedValue({});
  mockStyledRepo.update.mockImplementation(({ patch }) =>
    Promise.resolve({ ...EXISTING_STYLED, ...patch }),
  );
  mockShadesRepo.list.mockResolvedValue([
    { shade_id: "shade-icy", name: "Icy Grey" },
    { shade_id: "shade-blonde", name: "Khaleesi Blonde" },
  ]);
});

const baseRow = (over) => ({
  styled_name: EXISTING_STYLED.name,
  base: EXISTING_BASE,
  colour: "Classic Black",
  hex: "#1B1B1B",
  lace: "HD13x4",
  size: "S",
  price: 389000,
  is_default_colour: "yes",
  status: "draft",
  ...over,
});

describe("Styled Products template — Shade column", () => {
  test("Shade is a named column on the sheet, ordered between Bundles and Status", () => {
    const headers = io.STYLED_COLUMNS.map((c) => c.header);
    expect(headers).toContain("Shade");
    const iBundles = headers.indexOf("Bundles (comma)");
    const iShade = headers.indexOf("Shade");
    const iStatus = headers.indexOf("Status");
    expect(iBundles).toBeLessThan(iShade);
    expect(iShade).toBeLessThan(iStatus);
  });

  test("Shade column advertises a Reference dropdown backed by 'Existing shades'", () => {
    const shade = io.STYLED_COLUMNS.find((c) => c.header === "Shade");
    expect(shade).toBeTruthy();
    expect(shade.ref).toBe("Existing shades");
  });
});

describe("importStyled — Shade re-homes styled_products.shade_id", () => {
  test("a resolvable Shade name flows into the update patch as shade_id", async () => {
    const buf = await workbook([baseRow({ shade: "Icy Grey", slug: EXISTING_STYLED.slug })]);
    await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    expect(mockStyledRepo.update).toHaveBeenCalledTimes(1);
    const patch = mockStyledRepo.update.mock.calls[0][0].patch;
    expect(patch.shade_id).toBe("shade-icy");
  });

  test("an unknown Shade name is a warning; shade_id is NOT patched", async () => {
    const buf = await workbook([
      baseRow({ shade: "Made Up Shade", slug: EXISTING_STYLED.slug }),
    ]);
    const res = await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    const patch = mockStyledRepo.update.mock.calls[0][0].patch;
    expect(patch).not.toHaveProperty("shade_id");
    expect(res.results.some(
      (r) => r.status === "warn" && /shade "Made Up Shade" not found/.test(r.reason || ""),
    )).toBe(true);
  });

  test("blank Shade leaves the current shade_id untouched (no key in patch)", async () => {
    const buf = await workbook([baseRow({ shade: "", slug: EXISTING_STYLED.slug })]);
    await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    const patch = mockStyledRepo.update.mock.calls[0][0].patch;
    expect(patch).not.toHaveProperty("shade_id");
  });
});

describe("importStyled — existing colours get Hex + Default? diff-applied", () => {
  test("an existing colour's Hex is UPDATED on re-import (not silently skipped)", async () => {
    mockVariantsRepo.listColours.mockResolvedValue([
      { colour_id: "col-existing", name: "Classic Black", hex: "#000000", is_default: true },
    ]);
    const buf = await workbook([
      baseRow({ hex: "#1B1B1B", is_default_colour: "yes", slug: EXISTING_STYLED.slug }),
    ]);
    await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    expect(mockVariantsService.createColour).not.toHaveBeenCalled();
    expect(mockVariantsService.updateColour).toHaveBeenCalledTimes(1);
    const call = mockVariantsService.updateColour.mock.calls[0][0];
    expect(call.colour_id).toBe("col-existing");
    expect(call.patch).toEqual({ hex: "#1B1B1B", is_default: true });
  });

  test("existing colour with blank Hex + blank Default? triggers NO updateColour call", async () => {
    mockVariantsRepo.listColours.mockResolvedValue([
      { colour_id: "col-existing", name: "Classic Black", hex: "#000000", is_default: true },
    ]);
    const buf = await workbook([
      // Row supplies size + price for the variant, but leaves colour metadata blank.
      baseRow({ hex: "", is_default_colour: "", slug: EXISTING_STYLED.slug }),
    ]);
    await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    expect(mockVariantsService.updateColour).not.toHaveBeenCalled();
  });

  test("a NEW colour still goes through createColour with the row's hex", async () => {
    mockVariantsRepo.listColours.mockResolvedValue([]);
    const buf = await workbook([
      baseRow({ colour: "Icy Blonde", hex: "#F5F5DC", slug: EXISTING_STYLED.slug }),
    ]);
    await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    expect(mockVariantsService.createColour).toHaveBeenCalledTimes(1);
    expect(mockVariantsService.createColour.mock.calls[0][0].input).toMatchObject({
      name: "Icy Blonde",
      hex: "#F5F5DC",
    });
  });
});

describe("importStyled — blank cells preserve existing styled + variant fields", () => {
  test("blank Short/Long Description do NOT appear in the styled patch", async () => {
    const buf = await workbook([
      baseRow({
        short_description: "",
        long_description: "",
        slug: EXISTING_STYLED.slug,
      }),
    ]);
    await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    const patch = mockStyledRepo.update.mock.calls[0][0].patch;
    expect(patch).not.toHaveProperty("short_description");
    expect(patch).not.toHaveProperty("long_description");
  });

  test("blank Retail Price cells across the whole group omit retail_price_ngn", async () => {
    const buf = await workbook([
      baseRow({ price: "", slug: EXISTING_STYLED.slug }),
    ]);
    await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    const patch = mockStyledRepo.update.mock.calls[0][0].patch;
    expect(patch).not.toHaveProperty("retail_price_ngn");
  });

  test("blank per-variant price cells DO NOT wipe the current override (updateVariant is skipped)", async () => {
    mockVariantsRepo.listColours.mockResolvedValue([
      { colour_id: "col-existing", name: "Classic Black", hex: "#1B1B1B", is_default: true },
    ]);
    mockVariantsRepo.listVariants.mockResolvedValue([
      {
        styled_variant_id: "v-existing",
        colour_id: "col-existing",
        size_code: "S",
        lace_code: "HD13X4",
        base_product_id: "base-1",
        price_override_ngn: 389000,
      },
    ]);
    const buf = await workbook([
      baseRow({
        // All four price cells intentionally blank — matches the "I only touched
        // hex/shade in Excel" flow.
        price: "",
        compare_at: "",
        // Colour hex + default? also blank — nothing to update on the colour.
        hex: "",
        is_default_colour: "",
        slug: EXISTING_STYLED.slug,
      }),
    ]);
    await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    // Existing variant matches by (colour, size, lace); with nothing to patch,
    // updateVariant should NOT be called at all.
    expect(mockVariantsService.updateVariant).not.toHaveBeenCalled();
    // And no phantom create either.
    expect(mockVariantsService.createVariant).not.toHaveBeenCalled();
  });

  test("supplied variant price cells DO patch (diff, not overwrite of blanks)", async () => {
    mockVariantsRepo.listColours.mockResolvedValue([
      { colour_id: "col-existing", name: "Classic Black" },
    ]);
    mockVariantsRepo.listVariants.mockResolvedValue([
      {
        styled_variant_id: "v-existing",
        colour_id: "col-existing",
        size_code: "S",
        lace_code: "HD13X4",
        base_product_id: "base-1",
      },
    ]);
    const buf = await workbook([
      baseRow({
        price: 400000,
        compare_at: "",
        hex: "",
        is_default_colour: "",
        slug: EXISTING_STYLED.slug,
      }),
    ]);
    await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    expect(mockVariantsService.updateVariant).toHaveBeenCalledTimes(1);
    const patch = mockVariantsService.updateVariant.mock.calls[0][0].patch;
    expect(patch).toEqual({ price_override_ngn: 400000 });
  });
});
