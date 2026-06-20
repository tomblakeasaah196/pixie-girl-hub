"use strict";

/**
 * AI draft parsing helpers (P0-8). extractJson must tolerate the model
 * wrapping JSON in code fences or prose; slugify must yield clean kebab-case.
 * Heavy deps are mocked so only the pure helpers load.
 */

jest.mock("../../../src/modules/catalogue/catalogue.repo", () => ({}));
jest.mock("../../../src/modules/catalogue/styled.service", () => ({}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({}));
jest.mock("../../../src/services/llm.service", () => ({}));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn() },
}));

const {
  extractJson,
  slugify,
} = require("../../../src/modules/catalogue/product_ai.service");

describe("extractJson", () => {
  test("parses a bare JSON object", () => {
    expect(extractJson('{"name":"Bardot Bob"}')).toEqual({
      name: "Bardot Bob",
    });
  });

  test("parses JSON inside ```json fences with surrounding prose", () => {
    const text =
      'Sure!\n```json\n{"name":"Silk Press","style_addon_price_ngn":15000}\n```\nHope that helps.';
    expect(extractJson(text)).toEqual({
      name: "Silk Press",
      style_addon_price_ngn: 15000,
    });
  });

  test("returns null on unparseable content", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("")).toBeNull();
    expect(extractJson(null)).toBeNull();
  });
});

describe("slugify", () => {
  test("kebab-cases and strips punctuation", () => {
    expect(slugify('Bardot Bob — 18" HD Lace!')).toBe("bardot-bob-18-hd-lace");
  });
  test("trims leading/trailing separators", () => {
    expect(slugify("  Honey Blonde  ")).toBe("honey-blonde");
  });
});
