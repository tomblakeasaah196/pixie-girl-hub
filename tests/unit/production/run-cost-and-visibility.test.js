"use strict";

/**
 * Production & Landed Cost — unit coverage for the three behaviours that made
 * a run's cost real instead of a permanent ₦0:
 *
 *   1. OPENING A RUN CARRIES PRODUCTS AND MONEY. `openRun` turns product lines
 *      into individually-coded production_run_units and rolls the priced lines
 *      into one `factory_unit_cost` component converted at the run's FX rate.
 *      Before, a run could only be opened with a title and a unit count, so
 *      nothing ever reached cost_components and the landed cost stayed zero.
 *
 *   2. FX IS NEVER ASSUMED TO BE 1. A ¥5,000 factory invoice must not book as
 *      ₦5,000. When no rate is supplied the system rate is used; when neither
 *      exists the write is refused rather than silently corrupting the cost
 *      basis that prices every product.
 *
 *   3. NGN COST IS INVISIBLE TO THE FACTORY MANAGER. The China factory manager
 *      operates the same module as the CEO but must never see the Naira landed
 *      cost — the server strips those columns rather than relying on the UI.
 *
 * Pure-unit: repo, audit, events, currency and stock deps are stubbed — no DB.
 */

jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({}),
  query: jest.fn(),
  ex: () => jest.fn(),
}));

jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));

jest.mock("../../../src/modules/production/production.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));

jest.mock("../../../src/modules/stock/stock.service", () => ({
  recordMovement: jest.fn(),
}));

jest.mock("../../../src/services/currency.service", () => ({
  systemFxRate: jest.fn(),
}));

jest.mock("../../../src/shared/access/roles.repo", () => ({
  findRoleByName: jest.fn(),
}));

jest.mock("../../../src/modules/production/production.repo", () => ({
  nextNumber: jest.fn(),
  createRun: jest.fn(),
  getRun: jest.fn(),
  getRunBare: jest.fn(),
  listRuns: jest.fn(),
  setRunStatus: jest.fn(),
  bumpUnitsReceived: jest.fn(),
  addCostComponent: jest.fn(),
  addUnits: jest.fn(),
  countUnits: jest.fn(),
  variantSkus: jest.fn(),
  getPoWithLines: jest.fn(),
  linkPoLinesToRun: jest.fn(),
  setRunPerUnitCost: jest.fn(),
  getLatestBreakdown: jest.fn(),
  markBreakdownsNotLatest: jest.fn(),
  insertBreakdown: jest.fn(),
  listBreakdowns: jest.fn(),
}));

const repo = require("../../../src/modules/production/production.repo");
const currency = require("../../../src/services/currency.service");
const rolesRepo = require("../../../src/shared/access/roles.repo");
const service = require("../../../src/modules/production/production.service");

const FM_ROLE = "11111111-1111-1111-1111-000000000007";
const BRAND = "faitlynhair";
const CEO = { user_id: "u-ceo", is_ceo: true, role_ids: [] };
const FACTORY_MANAGER = {
  user_id: "u-fm",
  is_ceo: false,
  role_ids: [FM_ROLE],
};

/** A run row as the DB would return it after the roll-up trigger fired. */
function runRow(over = {}) {
  return {
    run_id: "run-1",
    run_number: "FLH-RUN-0002",
    title: "Big Chops Collection August",
    status: "planned",
    units_planned: 1000,
    units_produced: 0,
    units_received: 0,
    total_factory_cost_ngn: "10000.00",
    total_freight_ngn: "0.00",
    total_customs_ngn: "0.00",
    total_3pl_lagos_ngn: "0.00",
    total_styling_ngn: "0.00",
    total_packaging_ngn: "0.00",
    total_wastage_ngn: "0.00",
    total_other_ngn: "0.00",
    total_landed_cost_ngn: "10000.00",
    per_unit_cost_ngn: "10.00",
    effective_funding_rate: null,
    funding_currency: "CNY",
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  rolesRepo.findRoleByName.mockResolvedValue({ role_id: FM_ROLE });
  repo.nextNumber.mockResolvedValue("FLH-RUN-0002");
  repo.countUnits.mockResolvedValue(0);
  repo.variantSkus.mockResolvedValue({
    "var-1": "FLH-BC-18",
    "var-2": "FLH-BC-20",
  });
  repo.addUnits.mockResolvedValue([]);
  repo.addCostComponent.mockResolvedValue({ component_id: "c-1" });
  repo.getRunBare.mockResolvedValue(runRow());
  repo.getRun.mockResolvedValue(runRow());
  repo.getLatestBreakdown.mockResolvedValue(null);
  repo.insertBreakdown.mockResolvedValue({ breakdown_id: "b-1" });
  repo.markBreakdownsNotLatest.mockResolvedValue(undefined);
  repo.setRunPerUnitCost.mockResolvedValue(runRow());
  repo.createRun.mockResolvedValue(runRow());
});

describe("openRun — products and factory cost land on the run", () => {
  it("creates one unit per item and one factory_unit_cost component at the FX rate", async () => {
    currency.systemFxRate.mockResolvedValue(210);

    await service.openRun({
      brand: BRAND,
      user: CEO,
      request_id: "req-1",
      input: {
        title: "Big Chops Collection August",
        currency: "CNY",
        lines: [
          { variant_id: "var-1", quantity: 3, unit_cost: 100 },
          { variant_id: "var-2", quantity: 2, unit_cost: 50 },
        ],
      },
    });

    // units_planned is derived from the lines, not typed by hand.
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({
          units_planned: 5,
          funding_currency: "CNY",
        }),
      }),
    );

    // 3 + 2 = 5 individually-coded units, sequenced off the run number.
    const units = repo.addUnits.mock.calls[0][0].units;
    expect(units).toHaveLength(5);
    expect(units.map((u) => u.unit_code)).toEqual([
      "FLH-RUN-0002-001",
      "FLH-RUN-0002-002",
      "FLH-RUN-0002-003",
      "FLH-RUN-0002-004",
      "FLH-RUN-0002-005",
    ]);
    expect(units[0]).toMatchObject({
      variant_id: "var-1",
      sku_snapshot: "FLH-BC-18",
    });
    expect(units[4]).toMatchObject({
      variant_id: "var-2",
      sku_snapshot: "FLH-BC-20",
    });

    // (3 × 100) + (2 × 50) = ¥400 → ₦84,000 at 210.
    expect(repo.addCostComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        c: expect.objectContaining({
          cost_type: "factory_unit_cost",
          amount: "400.00",
          currency: "CNY",
          amount_ngn: "84000.00",
          applies_to_units: 5,
        }),
      }),
    );
  });

  it("imports a purchase order's lines and stamps the run back onto them", async () => {
    currency.systemFxRate.mockResolvedValue(210);
    repo.getPoWithLines.mockResolvedValue({
      po_id: "po-1",
      po_number: "FLH-PO-0007",
      supplier_id: "sup-1",
      po_currency: "USD",
      lines: [
        {
          line_id: "l-1",
          variant_id: "var-1",
          description: "18in",
          qty_ordered: 4,
          unit_price: "25.00",
        },
      ],
    });

    await service.openRun({
      brand: BRAND,
      user: CEO,
      request_id: "req-2",
      input: { title: "From PO", po_id: "po-1" },
    });

    expect(repo.addUnits.mock.calls[0][0].units).toHaveLength(4);
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({
          supplier_id: "sup-1",
          po_id: "po-1",
          units_planned: 4,
        }),
      }),
    );
    expect(repo.linkPoLinesToRun).toHaveBeenCalledWith(
      expect.objectContaining({ po_id: "po-1", run_id: "run-1" }),
    );
  });

  it("opens a run with no lines without inventing a cost component", async () => {
    await service.openRun({
      brand: BRAND,
      user: CEO,
      request_id: "req-3",
      input: { title: "Empty run" },
    });
    expect(repo.addCostComponent).not.toHaveBeenCalled();
    // The breakdown history still starts at open, so cost has a baseline.
    expect(repo.insertBreakdown).toHaveBeenCalled();
  });
});

describe("addCostComponent — FX is resolved, never assumed", () => {
  it("converts a foreign cost at the system rate when none is supplied", async () => {
    currency.systemFxRate.mockResolvedValue(210);

    await service.addCostComponent({
      brand: BRAND,
      user: CEO,
      request_id: "req-4",
      id: "run-1",
      input: {
        cost_type: "freight_international",
        amount: 5000,
        currency: "CNY",
      },
    });

    expect(repo.addCostComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        c: expect.objectContaining({
          amount_ngn: "1050000.00", // 5000 × 210 — NOT 5000
          fx_rate_used: "210",
          recorded_by: "u-ceo",
        }),
      }),
    );
  });

  it("prefers the rate the operator actually converted at", async () => {
    currency.systemFxRate.mockResolvedValue(210);

    await service.addCostComponent({
      brand: BRAND,
      user: CEO,
      request_id: "req-5",
      id: "run-1",
      input: {
        cost_type: "customs_duty",
        amount: 100,
        currency: "USD",
        fx_rate_used: 1650,
      },
    });

    expect(repo.addCostComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        c: expect.objectContaining({
          amount_ngn: "165000.00",
          fx_rate_used: "1650",
        }),
      }),
    );
  });

  it("refuses the write when no rate exists rather than booking at 1:1", async () => {
    currency.systemFxRate.mockResolvedValue(null);

    await expect(
      service.addCostComponent({
        brand: BRAND,
        user: CEO,
        request_id: "req-6",
        id: "run-1",
        input: { cost_type: "packaging", amount: 900, currency: "CNY" },
      }),
    ).rejects.toMatchObject({ code: "FX_RATE_UNAVAILABLE" });

    expect(repo.addCostComponent).not.toHaveBeenCalled();
  });
});

describe("cost visibility — the factory manager never sees Naira", () => {
  it("strips every NGN column for a factory manager", async () => {
    const out = service.redactRun(
      {
        ...runRow(),
        components: [
          {
            component_id: "c-1",
            amount: "400.00",
            currency: "CNY",
            amount_ngn: "84000.00",
            fx_rate_used: "210",
          },
        ],
      },
      false,
    );

    expect(out.total_landed_cost_ngn).toBeUndefined();
    expect(out.per_unit_cost_ngn).toBeUndefined();
    expect(out.total_factory_cost_ngn).toBeUndefined();
    expect(out.cost_redacted).toBe(true);
    // The factory's own invoice figure survives — they typed it and must
    // be able to check it.
    expect(out.components[0].amount).toBe("400.00");
    expect(out.components[0].currency).toBe("CNY");
    expect(out.components[0].amount_ngn).toBeUndefined();
  });

  it("leaves the run untouched for a cost-visible caller", () => {
    const run = runRow();
    expect(service.redactRun(run, true)).toBe(run);
  });

  it("resolves visibility from the caller's roles", async () => {
    await expect(service.canSeeCost(CEO)).resolves.toBe(true);
    await expect(service.canSeeCost(FACTORY_MANAGER)).resolves.toBe(false);
    await expect(
      service.canSeeCost({
        user_id: "u-ops",
        is_ceo: false,
        role_ids: ["some-other-role"],
      }),
    ).resolves.toBe(true);
  });

  it("redacts the list endpoint for a factory manager", async () => {
    repo.listRuns.mockResolvedValue({
      data: [runRow()],
      page: 1,
      page_size: 25,
      total: 1,
    });

    const page = await service.listRuns({
      brand: BRAND,
      user: FACTORY_MANAGER,
    });
    expect(page.data[0].total_landed_cost_ngn).toBeUndefined();
    expect(page.data[0].run_number).toBe("FLH-RUN-0002");
  });

  it("refuses the landed-cost breakdown outright — there is nothing left to redact", async () => {
    await expect(
      service.getLandedCost({
        brand: BRAND,
        user: FACTORY_MANAGER,
        id: "run-1",
      }),
    ).rejects.toMatchObject({ code: "COST_HIDDEN" });
  });
});

describe("receiveProduction — cannot over-receive a run", () => {
  it("rejects a quantity beyond what is outstanding", async () => {
    repo.getRunBare.mockResolvedValue(
      runRow({ units_planned: 10, units_received: 8 }),
    );

    await expect(
      service.receiveProduction({
        brand: BRAND,
        user: CEO,
        request_id: "req-7",
        id: "run-1",
        input: { variant_id: "var-1", location_id: "loc-1", quantity: 5 },
      }),
    ).rejects.toMatchObject({ code: "OVER_RECEIPT" });
  });

  it("accepts a receipt within the outstanding count", async () => {
    repo.getRunBare.mockResolvedValue(
      runRow({ units_planned: 10, units_received: 8 }),
    );
    repo.bumpUnitsReceived.mockResolvedValue(
      runRow({ units_planned: 10, units_received: 10 }),
    );

    const out = await service.receiveProduction({
      brand: BRAND,
      user: CEO,
      request_id: "req-8",
      id: "run-1",
      input: { variant_id: "var-1", location_id: "loc-1", quantity: 2 },
    });

    expect(out.units_received).toBe(10);
    expect(repo.bumpUnitsReceived).toHaveBeenCalledWith(
      expect.objectContaining({ qty: 2 }),
    );
  });
});
