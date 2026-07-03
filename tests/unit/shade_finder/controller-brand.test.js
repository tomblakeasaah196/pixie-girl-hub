"use strict";

// Regression guard: brandHint must resolve the storefront brand against the
// live VALID_BRANDS Set with .has() — NOT .includes() (a Set has no .includes,
// which threw "VALID_BRANDS.includes is not a function" on every /session call
// and 500'd the whole Shade Finder).
const {
  _internal,
} = require("../../../src/modules/shade_finder/shade-finder.controller");

describe("shade finder controller brandHint", () => {
  test("resolves a valid brand from X-Brand-Context", () => {
    const req = { headers: { "x-brand-context": "faitlynhair" }, query: {} };
    expect(_internal.brandHint(req)).toBe("faitlynhair");
  });

  test("falls back to pixiegirl when no hint is given", () => {
    const req = { headers: {}, query: {} };
    expect(_internal.brandHint(req)).toBe("pixiegirl");
  });

  test("is case-insensitive on the brand hint", () => {
    const req = { headers: { "x-brand-context": "FaitlynHair" }, query: {} };
    expect(_internal.brandHint(req)).toBe("faitlynhair");
  });

  test("rejects an unknown storefront with a 400 AppError", () => {
    const req = { headers: { "x-brand-context": "nope" }, query: {} };
    expect(() => _internal.brandHint(req)).toThrow(/unknown brand/);
  });
});
