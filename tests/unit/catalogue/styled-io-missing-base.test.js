"use strict";

/**
 * Task 8 — block import when base products are missing, but let the rest
 * succeed. We feed a REAL workbook (built with the spreadsheet engine) through
 * importStyled with the DB + write services mocked, and assert:
 *   • a group whose every base is missing is blocked (no styled created);
 *   • a group with a valid seed base still imports, and a single row inside it
 *     that names a missing base is skipped (not silently re-homed);
 *   • the grouped missing_bases report lists each missing base once with the
 *     styled products + sizes that need it.
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
jest.mock("../../../src/modules/retention/bundle.service", () => ({
  addComponent: jest.fn(),
}));
jest.mock("../../../src/modules/retention/bundle.repo", () => ({}));

const io = require("../../../src/modules/catalogue/catalogue-io.service");
const { buildWorkbook } = require("../../../src/services/spreadsheet.service");

// Aliases for readability in the assertions below.
const query = mockQuery;
const styledService = mockStyledService;
const variantsService = mockVariantsService;
const variantsRepo = mockVariantsRepo;

// The only base that exists in the brand.
const EXISTING_BASE = "Black Straight HD13x4 Pixie Wig - Small";

function mockQueryRouter() {
  query.mockImplementation((sql) => {
    if (/FROM\s+\w+\.products/i.test(sql))
      return Promise.resolve({
        rows: [{ product_id: "base-1", name: EXISTING_BASE }],
      });
    if (/FROM\s+\w+\.product_collections/i.test(sql))
      return Promise.resolve({ rows: [] });
    if (/FROM\s+\w+\.bundle_offers/i.test(sql))
      return Promise.resolve({ rows: [] });
    // findStyledBySlug → none exist, so every group is a fresh create.
    if (/FROM\s+\w+\.styled_products/i.test(sql))
      return Promise.resolve({ rows: [] });
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
  mockQueryRouter();
  variantsRepo.listSizeTiers.mockResolvedValue([
    { size_code: "S", label: "Small" },
    { size_code: "M", label: "Medium" },
  ]);
  variantsRepo.listLaceSizes.mockResolvedValue([{ lace_code: "HD13X4" }]);
  variantsRepo.listColours.mockResolvedValue([]);
  variantsRepo.listVariants.mockResolvedValue([]);
  variantsService.createColour.mockResolvedValue({ colour_id: "col-1" });
  variantsService.createVariant.mockResolvedValue({
    styled_variant_id: "v-1",
  });
  styledService.create.mockImplementation(({ input }) =>
    Promise.resolve({ styled_id: "styled-1", styled_code: "STY-1", ...input }),
  );
});

const baseRow = (over) => ({
  styled_name: "Good One",
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

describe("importStyled — missing base blocking + grouped report", () => {
  test("blocks a group whose every base is missing; the rest import", async () => {
    const buf = await workbook([
      baseRow(), // Good One / S — valid base
      baseRow({ size: "M" }), // Good One / M — valid base
      baseRow({
        styled_name: "Bad One",
        base: "Nonexistent Body Wave 13x6 - Medium",
        size: "M",
      }),
    ]);

    const res = await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });

    // The valid styled product was created exactly once; the bad one never was.
    expect(styledService.create).toHaveBeenCalledTimes(1);
    expect(styledService.create.mock.calls[0][0].input.name).toBe("Good One");
    expect(res.created).toBe(1);

    // Grouped report names the missing base once, with the styled + size.
    expect(res.missing_bases).toHaveLength(1);
    expect(res.missing_bases[0]).toMatchObject({
      base: "Nonexistent Body Wave 13x6 - Medium",
      styled_products: ["Bad One"],
      sizes: ["M"],
    });
    expect(res.skipped_missing_base).toBeGreaterThanOrEqual(1);
  });

  test("a single row with a missing base is skipped, not re-homed onto the seed base", async () => {
    const buf = await workbook([
      baseRow(), // S — valid base → creates the variant
      baseRow({ size: "M", base: "Ghost Base - Medium" }), // missing → skip row
    ]);

    const res = await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });

    // Styled created; only the valid row produced a variant (the ghost row did
    // NOT fall back to the seed base).
    expect(styledService.create).toHaveBeenCalledTimes(1);
    expect(variantsService.createVariant).toHaveBeenCalledTimes(1);
    expect(variantsService.createVariant.mock.calls[0][0].input.size_code).toBe(
      "S",
    );

    expect(res.missing_bases).toHaveLength(1);
    expect(res.missing_bases[0].base).toBe("Ghost Base - Medium");
    expect(res.missing_bases[0].sizes).toEqual(["M"]);
    expect(res.skipped_missing_base).toBe(1);
  });

  test("no missing bases → empty report, everything imports", async () => {
    const buf = await workbook([baseRow(), baseRow({ size: "M" })]);
    const res = await io.importStyled({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      buffer: buf,
    });
    expect(res.missing_bases).toEqual([]);
    expect(res.skipped_missing_base).toBe(0);
    expect(res.created).toBe(1);
    expect(variantsService.createVariant).toHaveBeenCalledTimes(2);
  });
});
