"use strict";

/**
 * Declarative condition evaluator (§6.23 strategy engine). Pure — no mocks.
 * The evaluator is the gate that lets strategies be data-only, so every
 * operator + the all/any/not composition are verified here.
 */

const { evaluate, describe: describeCond } = require("../../../src/modules/retention/strategy.conditions");

const facts = {
  days_since_last_order: 60,
  order_count: 3,
  lifetime_spend: 150000,
  tier_key: "gold",
  has_ordered: true,
  tags: ["vip", "wholesale"],
};

describe("strategy.conditions.evaluate", () => {
  test("empty / null predicate is always true", () => {
    expect(evaluate({}, facts)).toBe(true);
    expect(evaluate(null, facts)).toBe(true);
  });

  test("comparison operators", () => {
    expect(evaluate({ field: "order_count", op: "gte", value: 3 }, facts)).toBe(true);
    expect(evaluate({ field: "order_count", op: "gt", value: 3 }, facts)).toBe(false);
    expect(evaluate({ field: "days_since_last_order", op: "lt", value: 90 }, facts)).toBe(true);
    expect(evaluate({ field: "tier_key", op: "eq", value: "gold" }, facts)).toBe(true);
    expect(evaluate({ field: "tier_key", op: "neq", value: "bronze" }, facts)).toBe(true);
  });

  test("in / nin / contains / exists", () => {
    expect(evaluate({ field: "tier_key", op: "in", value: ["gold", "platinum"] }, facts)).toBe(true);
    expect(evaluate({ field: "tier_key", op: "nin", value: ["bronze"] }, facts)).toBe(true);
    expect(evaluate({ field: "tags", op: "contains", value: "vip" }, facts)).toBe(true);
    expect(evaluate({ field: "tags", op: "contains", value: "none" }, facts)).toBe(false);
    expect(evaluate({ field: "tier_key", op: "exists" }, facts)).toBe(true);
    expect(evaluate({ field: "missing", op: "not_exists" }, facts)).toBe(true);
  });

  test("all / any / not composition", () => {
    expect(
      evaluate(
        { all: [{ field: "has_ordered", op: "eq", value: true }, { field: "order_count", op: "gte", value: 3 }] },
        facts,
      ),
    ).toBe(true);
    expect(
      evaluate(
        { any: [{ field: "order_count", op: "gt", value: 100 }, { field: "tier_key", op: "eq", value: "gold" }] },
        facts,
      ),
    ).toBe(true);
    expect(evaluate({ not: { field: "tier_key", op: "eq", value: "bronze" } }, facts)).toBe(true);
  });

  test("unknown operator and malformed node fail closed", () => {
    expect(evaluate({ field: "order_count", op: "wat", value: 1 }, facts)).toBe(false);
    expect(evaluate({ random: true }, facts)).toBe(false);
  });
});

describe("strategy.conditions.describe", () => {
  test("renders human-readable text", () => {
    expect(describeCond({})).toBe("");
    expect(
      describeCond({ all: [{ field: "days_since_last_order", op: "gte", value: 60 }] }),
    ).toBe("days since last order is at least 60");
  });
});
