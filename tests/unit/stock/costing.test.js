"use strict";

const {
  isCostingExempt,
  applyMovementToCosting,
} = require("../../../src/modules/stock/stock.costing");

describe("weighted-average variant costing (policy Q9)", () => {
  test("soft locks and internal transfers are exempt", () => {
    for (const type of [
      "reserve",
      "release_reserve",
      "transfer_in",
      "transfer_out",
    ]) {
      expect(isCostingExempt(type)).toBe(true);
      expect(
        applyMovementToCosting(
          { qty_tracked: "10.00", avg_cost_ngn: "500.0000" },
          { movement_type: type, quantity: 5, unit_cost_ngn: "900" },
        ),
      ).toBeNull();
    }
  });

  test("first costed receipt sets the average", () => {
    const next = applyMovementToCosting(null, {
      movement_type: "receive",
      quantity: 20,
      unit_cost_ngn: "1500.00",
    });
    expect(next).toEqual({ qty_tracked: "20.00", avg_cost_ngn: "1500.0000" });
  });

  test("second receipt reweights: (10×100 + 30×200) / 40 = 175", () => {
    const next = applyMovementToCosting(
      { qty_tracked: "10.00", avg_cost_ngn: "100.0000" },
      { movement_type: "receive", quantity: 30, unit_cost_ngn: "200.00" },
    );
    expect(next).toEqual({ qty_tracked: "40.00", avg_cost_ngn: "175.0000" });
  });

  test("outflow relieves at the average without changing it", () => {
    const next = applyMovementToCosting(
      { qty_tracked: "40.00", avg_cost_ngn: "175.0000" },
      { movement_type: "sale", quantity: -15 },
    );
    expect(next).toEqual({ qty_tracked: "25.00", avg_cost_ngn: "175.0000" });
  });

  test("uncosted inflow (found stock / return) keeps the average", () => {
    const next = applyMovementToCosting(
      { qty_tracked: "25.00", avg_cost_ngn: "175.0000" },
      { movement_type: "adjustment_in", quantity: 2, unit_cost_ngn: null },
    );
    expect(next).toEqual({ qty_tracked: "27.00", avg_cost_ngn: "175.0000" });
  });

  test("outflows that predate costing clamp the weight at zero", () => {
    const next = applyMovementToCosting(
      { qty_tracked: "3.00", avg_cost_ngn: "175.0000" },
      { movement_type: "damage", quantity: -10 },
    );
    expect(next).toEqual({ qty_tracked: "0.00", avg_cost_ngn: "175.0000" });
  });

  test("a costed receipt after a zero weight restarts the average", () => {
    const next = applyMovementToCosting(
      { qty_tracked: "0.00", avg_cost_ngn: "175.0000" },
      { movement_type: "receive", quantity: 5, unit_cost_ngn: "220.00" },
    );
    expect(next).toEqual({ qty_tracked: "5.00", avg_cost_ngn: "220.0000" });
  });

  test("fractional receipts keep 4dp precision: (1×100 + 2×99.99) / 3", () => {
    const next = applyMovementToCosting(
      { qty_tracked: "1.00", avg_cost_ngn: "100.0000" },
      { movement_type: "receive", quantity: 2, unit_cost_ngn: "99.99" },
    );
    expect(next.avg_cost_ngn).toBe("99.9933");
  });
});
