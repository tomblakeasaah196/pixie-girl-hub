"use strict";

/**
 * Styled colour×size pricing helpers (catalogue PR). `computeEffective` and
 * `colourShort` are pure; the DB-touching deps the service pulls in are mocked
 * so the math + SKU short-code logic are verified in isolation.
 */

jest.mock("../../../src/modules/catalogue/styled_variants.repo", () => ({}));
jest.mock("../../../src/modules/catalogue/styled.repo", () => ({}));
jest.mock("../../../src/modules/catalogue/catalogue.repo", () => ({}));
jest.mock("../../../src/modules/catalogue/catalogue.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/shared/documents/documents.service", () => ({
  store: jest.fn(),
}));
jest.mock("../../../src/services/media-compression.service", () => ({
  compressUpload: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({ transaction: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));

const {
  computeEffective,
  colourShort,
} = require("../../../src/modules/catalogue/styled_variants.service");

describe("computeEffective (styled retail = anchor + colour + size premiums)", () => {
  test("anchor + colour premium + size premium", () => {
    expect(
      computeEffective({
        anchor: 100000,
        colour_premium: 5000,
        size_premium: 15000,
        override: null,
      }),
    ).toBe(120000);
  });

  test("zero premiums → anchor unchanged (every colour same price by default)", () => {
    expect(
      computeEffective({
        anchor: 90000,
        colour_premium: 0,
        size_premium: 0,
        override: null,
      }),
    ).toBe(90000);
  });

  test("an explicit override wins over the computed price", () => {
    expect(
      computeEffective({
        anchor: 100000,
        colour_premium: 5000,
        size_premium: 15000,
        override: 99000,
      }),
    ).toBe(99000);
  });

  test("override of 0 is honoured (not treated as unset)", () => {
    expect(
      computeEffective({
        anchor: 100000,
        colour_premium: 5000,
        size_premium: 15000,
        override: 0,
      }),
    ).toBe(0);
  });

  test("no anchor yet → null (price not set), unless overridden", () => {
    expect(
      computeEffective({
        anchor: null,
        colour_premium: 5000,
        size_premium: 15000,
        override: null,
      }),
    ).toBeNull();
    expect(
      computeEffective({
        anchor: null,
        colour_premium: 0,
        size_premium: 0,
        override: 80000,
      }),
    ).toBe(80000);
  });

  test("string numerics coerce (API sends money as strings)", () => {
    expect(
      computeEffective({
        anchor: "100000",
        colour_premium: "5000",
        size_premium: "15000",
        override: null,
      }),
    ).toBe(120000);
  });

  test("lace premium is included (matches the SQL: + lace.premium)", () => {
    expect(
      computeEffective({
        anchor: 389000,
        colour_premium: 0,
        size_premium: 15000,
        lace_premium: 40000,
        override: null,
      }),
    ).toBe(444000);
  });

  test("missing lace premium defaults to 0 (no-lace products)", () => {
    expect(
      computeEffective({
        anchor: 389000,
        colour_premium: 0,
        size_premium: 0,
        override: null,
      }),
    ).toBe(389000);
  });

  test("override still wins even with a lace premium present", () => {
    expect(
      computeEffective({
        anchor: 389000,
        colour_premium: 0,
        size_premium: 15000,
        lace_premium: 40000,
        override: 425000,
      }),
    ).toBe(425000);
  });
});

describe("colourShort (deterministic, collision-safe SKU code)", () => {
  test("derives an UPPERCASE short from the name + colour id tail", () => {
    expect(
      colourShort({ name: "Dark Copper", colour_id: "a1b2c3d4-aa-bb" }),
    ).toBe("DARBB");
  });

  test("is deterministic for the same colour", () => {
    const c = { name: "Honey Blonde", colour_id: "f00d-1234-zz99" };
    expect(colourShort(c)).toBe(colourShort(c));
  });

  test("two same-prefix names stay distinct via the id tail", () => {
    const a = colourShort({
      name: "Natural Black",
      colour_id: "1111-2222-3333",
    });
    const b = colourShort({
      name: "Natural Brown",
      colour_id: "4444-5555-6666",
    });
    expect(a).not.toBe(b);
  });

  test("falls back to CLR when the name has no alphanumerics", () => {
    expect(colourShort({ name: "!!!", colour_id: "abcd-ef" })).toBe("CLREF");
  });
});
