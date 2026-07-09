"use strict";

const v = require("../../../src/modules/whatsapp_templates/whatsapp-templates.validator");

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

const BODY = [{ type: "BODY", text: "Hi {{1}}, your order shipped." }];

describe("whatsapp_templates validator", () => {
  test("accepts a valid template create", () => {
    const { called, req } = run(v.validateCreate, {
      name: "order_shipped_update",
      language: "en_US",
      category: "UTILITY",
      components: BODY,
      submit: true,
    });
    expect(called).toBe(true);
    expect(req.body.category).toBe("UTILITY");
    expect(req.body.submit).toBe(true);
  });

  test("defaults submit to false and language to en_US", () => {
    const { called, req } = run(v.validateCreate, {
      name: "welcome_back",
      category: "MARKETING",
      components: BODY,
    });
    expect(called).toBe(true);
    expect(req.body.submit).toBe(false);
    expect(req.body.language).toBe("en_US");
  });

  test("rejects an invalid template name (uppercase / spaces)", () => {
    const { error } = run(v.validateCreate, {
      name: "Order Shipped",
      category: "UTILITY",
      components: BODY,
    });
    expect(error).toBeDefined();
  });

  test("rejects an unknown category", () => {
    const { error } = run(v.validateCreate, {
      name: "x",
      category: "PROMO",
      components: BODY,
    });
    expect(error).toBeDefined();
  });

  test("rejects create with no components", () => {
    const { error } = run(v.validateCreate, {
      name: "x",
      category: "UTILITY",
      components: [],
    });
    expect(error).toBeDefined();
  });

  test("accepts a partial update (category only)", () => {
    const { called } = run(v.validateUpdate, { category: "MARKETING" });
    expect(called).toBe(true);
  });

  test("rate accepts SERVICE and a zero amount", () => {
    const { called, req } = run(v.validateRate, {
      category: "SERVICE",
      amount_ngn: 0,
    });
    expect(called).toBe(true);
    expect(req.body.amount_ngn).toBe(0);
  });

  test("rate rejects a negative amount", () => {
    const { error } = run(v.validateRate, {
      category: "UTILITY",
      amount_ngn: -5,
    });
    expect(error).toBeDefined();
  });
});
