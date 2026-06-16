"use strict";

const v = require("../../../src/modules/service_catalogue/service-catalogue.validator");

function run(mw, body) {
  const req = { body };
  let called = false;
  let error;
  try {
    mw(req, {}, () => {
      called = true;
    });
  } catch (e) {
    error = e;
  }
  return { req, called, error };
}

describe("service catalogue validators", () => {
  test("create requires name and slug", () => {
    const { error: err1 } = run(v.validateCreateService, { name: "Revamp" });
    expect(err1).toBeDefined();
    const { error: err2 } = run(v.validateCreateService, { slug: "revamp" });
    expect(err2).toBeDefined();
  });

  test("slug must be lowercase + hyphenated", () => {
    const { error } = run(v.validateCreateService, {
      name: "Wig Revamp",
      slug: "Wig Revamp",
    });
    expect(error).toBeDefined();
  });

  test("accepts a complete create", () => {
    const { called } = run(v.validateCreateService, {
      name: "Wig Revamp",
      slug: "wig-revamp",
      description: "Re-style, re-ventilate or re-tint an existing wig",
      base_price_ngn: 25000,
      duration_minutes: 240,
      category: "revamp",
    });
    expect(called).toBe(true);
  });

  test("update accepts partial", () => {
    const { called } = run(v.validateUpdateService, {
      base_price_ngn: 30000,
    });
    expect(called).toBe(true);
  });
});
