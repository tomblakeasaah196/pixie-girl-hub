"use strict";

/**
 * Strategy template library + plain-language summary (§6.23). The seeds in
 * template/000066 mirror these, so the library must stay well-formed.
 */

jest.mock("../../../src/config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/services/email.service", () => ({ send: jest.fn() }));

const templates = require("../../../src/modules/retention/strategy.templates");
const { summarize } = require("../../../src/modules/retention/strategy.service");

describe("strategy.templates", () => {
  test("every template is well-formed with at least one step", () => {
    for (const tpl of templates.TEMPLATES) {
      expect(tpl.template_key).toBeTruthy();
      expect(tpl.trigger_type).toBeTruthy();
      expect(Array.isArray(tpl.steps)).toBe(true);
      expect(tpl.steps.length).toBeGreaterThan(0);
      for (const step of tpl.steps) expect(step.action_type).toBeTruthy();
    }
  });

  test("list() surfaces the win-back template with its step count", () => {
    const winback = templates.list().find((t) => t.template_key === "win_back_60d");
    expect(winback).toBeTruthy();
    expect(winback.step_count).toBe(2);
  });

  test("get() returns null for an unknown key", () => {
    expect(templates.get("does_not_exist")).toBeNull();
  });
});

describe("strategy.service.summarize", () => {
  test("composes a When … then … sentence", () => {
    const tpl = templates.get("win_back_60d");
    const text = summarize(
      { trigger_type: tpl.trigger_type, trigger_conditions: tpl.trigger_conditions },
      tpl.steps,
    );
    expect(text).toMatch(/^When win back/i);
    expect(text).toContain("then");
  });
});
