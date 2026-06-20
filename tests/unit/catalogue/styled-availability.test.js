"use strict";

/**
 * Styled-product availability cascade (P0-6 / P0-7). availabilityState is a
 * pure function: given the base's available units + pre-order config it
 * decides in_stock / preorder / out_of_stock and the PRODUCTION-framed copy.
 * DB-touching deps are mocked so the logic is verified in isolation.
 */

jest.mock("../../../src/modules/catalogue/styled.repo", () => ({}));
jest.mock("../../../src/modules/catalogue/catalogue.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({ transaction: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));

const {
  availabilityState,
} = require("../../../src/modules/catalogue/styled.service");

describe("availabilityState", () => {
  test("stock on hand → in_stock", () => {
    const r = availabilityState(4, { preorder_enabled: false });
    expect(r.state).toBe("in_stock");
    expect(r.available).toBe(4);
  });

  test("zero stock, pre-order off → out_of_stock (no message)", () => {
    const r = availabilityState(0, { preorder_enabled: false });
    expect(r.state).toBe("out_of_stock");
    expect(r.available).toBe(0);
    expect(r.message).toBeUndefined();
  });

  test("zero stock, pre-order with a date → production-framed ready date", () => {
    const r = availabilityState(0, {
      preorder_enabled: true,
      expected_ready_date: "2026-07-05",
    });
    expect(r.state).toBe("preorder");
    expect(r.message).toMatch(/In production · ready ~/);
    // Production framing, never a generic "ships".
    expect(r.message).not.toMatch(/ship/i);
    expect(r.expected_ready_date).toBe("2026-07-05");
  });

  test("zero stock, pre-order with only a lead time → made-to-order copy", () => {
    const r = availabilityState(0, {
      preorder_enabled: true,
      production_lead_days: 21,
    });
    expect(r.state).toBe("preorder");
    expect(r.message).toBe("Made to order · ~21 days in production");
  });

  test("zero stock, pre-order with no date or lead → generic production copy", () => {
    const r = availabilityState(0, { preorder_enabled: true });
    expect(r.state).toBe("preorder");
    expect(r.message).toBe("Made to order · in production");
  });
});
