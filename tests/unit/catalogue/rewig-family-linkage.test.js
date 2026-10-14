"use strict";

/**
 * Rewig family stamping at base-creation time (000088 follow-up).
 *
 * Rewig availability only counts a sibling base when both bases carry a
 * size_code AND share a base_family_id. Nothing at runtime used to set
 * either — the only writer was migration 000088's one-off name backfill —
 * so a base added via "Create other sizes" (or the wizard, or Clone) joined
 * no family and its styled variants read "out of stock" the moment their
 * own size hit zero, even with an adjacent size on the shelf (the reported
 * Light Blonde XL case: XL base created from the L base, 12 L in stock,
 * XL unsellable). These tests pin the creation-time stamping.
 *
 * Hermetic: the repo + transaction are mocked, mirroring
 * rewig-donor-selection.test.js.
 */

jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({ query: jest.fn(async () => ({ rows: [] })) })),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/shared/outbox/outbox", () => ({
  enqueue: jest.fn(async () => {}),
}));
jest.mock("../../../src/services/numbering.service", () => ({
  nextProductCode: jest.fn(async () => "FLH100N"),
}));
jest.mock("../../../src/services/media-compression.service", () => ({
  compressUploadChecked: jest.fn(),
  normalizeImageInput: jest.fn(),
}));
jest.mock("../../../src/services/background-cutout.service", () => ({
  isolateSubject: jest.fn(),
}));
jest.mock("../../../src/shared/documents/documents.service", () => ({}));
jest.mock("../../../src/modules/catalogue/care-accessories.repo", () => ({}));
jest.mock("../../../src/modules/catalogue/care-accessories.gate", () => ({}));
jest.mock("../../../src/modules/catalogue/cost_vault.service", () => ({}));
jest.mock("../../../src/modules/catalogue/catalogue.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/modules/catalogue/catalogue.repo", () => ({
  findProductById: jest.fn(),
  getDefaultVariant: jest.fn(),
  productSlugTaken: jest.fn(async () => false),
  createProduct: jest.fn(),
  createVariant: jest.fn(async () => ({ variant_id: "v-new", reorder_point: 0 })),
  updateProduct: jest.fn(async () => ({})),
  listSizeTiers: jest.fn(),
}));

const repo = require("../../../src/modules/catalogue/catalogue.repo");
const service = require("../../../src/modules/catalogue/catalogue.service");

const BRAND = "faitlynhair";
const USER = { user_id: "u1" };
const TIERS = [
  { size_code: "S", label: "Small", display_order: 1, is_active: true },
  { size_code: "M", label: "Medium", display_order: 2, is_active: true },
  { size_code: "L", label: "Large", display_order: 3, is_active: true },
  { size_code: "XL", label: "Extra Large", display_order: 4, is_active: true },
];
const FAMILY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** An L base as "Create other sizes" would have left it before this fix. */
function orphanSource() {
  return {
    product_id: "base-L",
    catalogue_role: "base",
    is_deleted: false,
    name: "T3/12 Straight HD13x6 Pixie - Large",
    cap_size: "Large",
    size_code: null,
    base_family_id: null,
    rewig_eligible: true,
  };
}

beforeEach(() => {
  repo.listSizeTiers.mockResolvedValue(TIERS);
  repo.getDefaultVariant.mockResolvedValue({
    price_storefront_ngn: 100000,
    variant_cap_size: "Large",
  });
  repo.createProduct.mockImplementation(async ({ input }) => ({
    ...input,
    product_id: `pid:${input.name}`,
    product_code: "FLH100N",
  }));
});

describe("sizeCodeForCapSize / familyKeyForName", () => {
  test("cap-size labels and codes resolve to the tier code", () => {
    expect(service.sizeCodeForCapSize(TIERS, "Extra Large")).toBe("XL");
    expect(service.sizeCodeForCapSize(TIERS, "large")).toBe("L");
    expect(service.sizeCodeForCapSize(TIERS, "XL")).toBe("XL");
    expect(service.sizeCodeForCapSize(TIERS, "Adjustable")).toBeNull();
    expect(service.sizeCodeForCapSize(TIERS, null)).toBeNull();
  });

  test("family key strips the trailing size label (000088's convention)", () => {
    expect(service.familyKeyForName("T3/12 Straight - Large", TIERS)).toBe(
      "T3/12 Straight",
    );
    expect(service.familyKeyForName("T3/12 Straight - Extra Large", TIERS)).toBe(
      "T3/12 Straight",
    );
    expect(service.familyKeyForName("Plain Base", TIERS)).toBe("Plain Base");
  });
});

describe("createSiblingSizes — the reported XL case", () => {
  test("new XL base joins the source's family with its own size_code, and the orphan source is healed into the same family", async () => {
    repo.findProductById.mockResolvedValue(orphanSource());

    const out = await service.createSiblingSizes({
      brand: BRAND,
      user: USER,
      request_id: "r1",
      id: "base-L",
      sizes: [{ name: "T3/12 Straight HD13x6 Pixie - Extra Large", cap_size: "Extra Large" }],
    });

    expect(out.count).toBe(1);
    const created = repo.createProduct.mock.calls.map((c) => c[0].input);
    expect(created).toHaveLength(1);
    expect(created[0].size_code).toBe("XL");
    expect(created[0].base_family_id).toEqual(expect.any(String));

    // Source healed: same family, its own tier stamped.
    expect(repo.updateProduct).toHaveBeenCalledTimes(1);
    const heal = repo.updateProduct.mock.calls[0][0];
    expect(heal.id).toBe("base-L");
    expect(heal.patch.base_family_id).toBe(created[0].base_family_id);
    expect(heal.patch.size_code).toBe("L");
  });

  test("a source already in a family is reused untouched", async () => {
    repo.findProductById.mockResolvedValue({
      ...orphanSource(),
      size_code: "L",
      base_family_id: FAMILY,
    });

    await service.createSiblingSizes({
      brand: BRAND,
      user: USER,
      request_id: "r1",
      id: "base-L",
      sizes: [{ name: "T3/12 Straight HD13x6 Pixie - Extra Large", cap_size: "Extra Large" }],
    });

    expect(repo.updateProduct).not.toHaveBeenCalled();
    const created = repo.createProduct.mock.calls.map((c) => c[0].input);
    expect(created[0].base_family_id).toBe(FAMILY);
    expect(created[0].size_code).toBe("XL");
  });

  test("an unresolvable size gets NULL size_code, never the source's tier", async () => {
    repo.findProductById.mockResolvedValue({
      ...orphanSource(),
      size_code: "L",
      base_family_id: FAMILY,
    });

    await service.createSiblingSizes({
      brand: BRAND,
      user: USER,
      request_id: "r1",
      id: "base-L",
      sizes: [{ name: "T3/12 Straight HD13x6 Pixie - Adjustable", cap_size: "Adjustable" }],
    });

    const created = repo.createProduct.mock.calls.map((c) => c[0].input);
    expect(created[0].size_code).toBeNull();
    expect(created[0].base_family_id).toBe(FAMILY);
  });
});

describe("createBaseProducts (wizard size run)", () => {
  test("the whole run shares one family, each base with its own size_code", async () => {
    const products = TIERS.map((t) => ({
      name: `T3/12 Straight HD13x6 Pixie - ${t.label}`,
      cap_size: t.label,
      variant: { variant_cap_size: t.label },
    }));

    await service.createBaseProducts({
      brand: BRAND,
      user: USER,
      request_id: "r1",
      input: { products },
    });

    const created = repo.createProduct.mock.calls.map((c) => c[0].input);
    expect(created.map((c) => c.size_code)).toEqual(["S", "M", "L", "XL"]);
    expect(new Set(created.map((c) => c.base_family_id)).size).toBe(1);
    expect(created[0].base_family_id).toEqual(expect.any(String));
  });
});

describe("cloneProduct", () => {
  test("clone of an orphan source mints one family for both", async () => {
    repo.findProductById.mockResolvedValue(orphanSource());

    await service.cloneProduct({
      brand: BRAND,
      user: USER,
      request_id: "r1",
      id: "base-L",
    });

    const created = repo.createProduct.mock.calls.map((c) => c[0].input);
    expect(created[0].size_code).toBe("L");
    expect(created[0].base_family_id).toEqual(expect.any(String));
    const heal = repo.updateProduct.mock.calls[0][0];
    expect(heal.patch.base_family_id).toBe(created[0].base_family_id);
  });
});
