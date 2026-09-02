"use strict";

/**
 * `stockService.importCount` — the endpoint behind Stock → Adjustments →
 * Import Count.
 *
 * The matching and planning rules are pinned in their own suites; what matters
 * here is the wiring that decides whether anything gets WRITTEN:
 *   · a preview touches nothing, even when the sheet is perfect;
 *   · a commit files exactly one adjustment and SUBMITS it (never posts);
 *   · a sheet with an unmatched row refuses to commit, because under
 *     unlisted=zero those products would be written down to nil;
 *   · the same refusal is reported (not thrown) during preview, so the review
 *     screen can show it before anyone presses anything.
 */

jest.mock("../../../src/config/database", () => ({
  ex: (client) => (client ? client.query.bind(client) : jest.fn()),
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/stock/stock.repo");

const repo = require("../../../src/modules/stock/stock.repo");
const service = require("../../../src/modules/stock/stock.service");

const BRAND = "faitlynhair";
const USER = { user_id: "u1", display_name: "CEO", email: "ceo@example.com" };
const LOC = {
  location_id: "11111111-1111-4111-8111-111111111111",
  display_name: "Faitlyn Salon de Luxe",
  is_default: true,
  is_active: true,
  on_hand: 12,
};

const product = (product_id, product_code, name) => ({
  product_id,
  product_code,
  name,
  primary_colour: null,
  texture_type: null,
  lace_type: null,
  cap_size: null,
  lace_size_codes: null,
  track_stock: true,
});

const CATALOGUE = [
  product("p1", "FLH079N", "Black 4mm Curl HD13x4 Pixie Wig - Medium"),
  product("p2", "FLH100N", "Black Yaki HD13x6 Pixie Wig - Large"),
  product("p3", "FLH151N", "T3/12 Straight HD6x6 Left Part Pixie Wig - Medium"),
];

const levels = (perProduct) =>
  new Map(
    Object.entries(perProduct).map(([pid, on_hand]) => [
      pid,
      [
        {
          product_id: pid,
          variant_id: `v-${pid}`,
          sku: `SKU-${pid}`,
          variant_name: pid,
          is_active: true,
          on_hand,
          reserved: 0,
        },
      ],
    ]),
  );

/** A sheet row exactly as the CEO's workbook spells it. */
const row = (colour, texture, cap, size, units) => ({
  Color: colour,
  Texture: texture,
  "Cap Construction": cap,
  Size: size,
  "Units No.": units,
});

beforeEach(() => {
  jest.clearAllMocks();
  repo.productsForCountMatch.mockResolvedValue(CATALOGUE);
  repo.locationsWithStock.mockResolvedValue([LOC]);
  repo.levelsByProductAtLocation.mockResolvedValue(
    levels({ p1: 9, p2: 2, p3: 1 }),
  );
  repo.createAdjustment.mockResolvedValue({
    adjustment_id: "adj-1",
    adjustment_number: "FLH-ADJ-0007",
  });
  repo.addAdjustmentLine.mockResolvedValue({});
  repo.getAdjustment.mockResolvedValue({
    adjustment_id: "adj-1",
    adjustment_number: "FLH-ADJ-0007",
    status: "draft",
    lines: [],
  });
  repo.setAdjustmentStatus.mockResolvedValue({ status: "submitted" });
  // createAdjustment runs inside a transaction; run the callback on a stub.
  require("../../../src/config/database").transaction.mockImplementation((fn) =>
    fn({ query: jest.fn().mockResolvedValue({ rows: [] }) }),
  );
});

const run = (input) =>
  service.importCount({
    brand: BRAND,
    user: USER,
    request_id: null,
    input: { blank: "zero", unlisted: "zero", ...input },
  });

// ── preview ──────────────────────────────────────────────

describe("preview (commit: false)", () => {
  test("reconciles without writing anything", async () => {
    const res = await run({
      rows: [row("black", "4mm curl", "HD13*4", "M", 2)],
      unlisted: "skip",
    });

    expect(repo.createAdjustment).not.toHaveBeenCalled();
    expect(res.adjustment).toBeNull();
    // 9 on the system, 2 counted → one -7 correction.
    expect(res.lines).toEqual([
      expect.objectContaining({
        kind: "counted",
        system_count: 9,
        physical_count: 2,
        delta: -7,
      }),
    ]);
  });

  test("reports the ending unit total the sheet will leave behind", async () => {
    const res = await run({
      rows: [
        row("black", "4mm curl", "HD13*4", "M", 2),
        row("black", "Yaki", "HD13*6", "L", 2),
        row("T3/12", "Straight", "HD6*6 left part", "M", 1),
      ],
    });
    // System holds 9+2+1 = 12; the sheet counts 2+2+1 = 5.
    expect(res.summary.system_total).toBe(12);
    expect(res.summary.ends_at).toBe(5);
    expect(res.summary.writeDown).toBe(7);
  });

  test("a blank cell is a counted zero under blank=zero", async () => {
    const res = await run({
      rows: [row("black", "4mm curl", "HD13*4", "M", "")],
      unlisted: "skip",
    });
    expect(res.lines[0]).toMatchObject({ physical_count: 0, delta: -9 });
  });

  test("a blank cell is left alone under blank=skip", async () => {
    const res = await run({
      rows: [row("black", "4mm curl", "HD13*4", "M", "")],
      blank: "skip",
      unlisted: "skip",
    });
    expect(res.lines).toHaveLength(0);
    expect(res.skipped).toHaveLength(1);
  });

  test("products the sheet never names are zeroed under unlisted=zero", async () => {
    const res = await run({
      rows: [row("black", "4mm curl", "HD13*4", "M", 9)],
    });
    // p1 is already correct at 9, so the only lines are the two sweeps.
    expect(res.lines.map((l) => l.kind)).toEqual(["unlisted", "unlisted"]);
    expect(res.lines.every((l) => l.physical_count === 0)).toBe(true);
    expect(res.summary.ends_at).toBe(9);
  });

  test("surfaces blockers instead of throwing, so the review can show them", async () => {
    const res = await run({
      rows: [row("black", "8mm curl", "HD13*4", "M", 3)],
    });
    expect(res.blockers).toEqual([
      expect.stringMatching(/1 row\(s\) matched no base product/),
    ]);
    expect(res.unmatched[0].error).toMatch(/No base product/);
  });
});

// ── commit ───────────────────────────────────────────────

describe("commit", () => {
  test("files ONE adjustment and submits it — never posts", async () => {
    const res = await run({
      rows: [row("black", "4mm curl", "HD13*4", "M", 2)],
      unlisted: "skip",
      commit: true,
    });

    expect(repo.createAdjustment).toHaveBeenCalledTimes(1);
    const header = repo.createAdjustment.mock.calls[0][0].header;
    expect(header.adjustment_type).toBe("count");
    expect(header.location_id).toBe(LOC.location_id);

    expect(repo.addAdjustmentLine).toHaveBeenCalledTimes(1);
    expect(repo.addAdjustmentLine.mock.calls[0][0].line).toMatchObject({
      system_count: 9,
      physical_count: 2,
    });

    // Submitted for approval; posting is a separate, human act.
    expect(repo.setAdjustmentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "submitted" }),
    );
    expect(res.adjustment).toMatchObject({
      adjustment_number: "FLH-ADJ-0007",
      status: "submitted",
    });
  });

  test("refuses to file a sheet with an unmatched row", async () => {
    await expect(
      run({
        rows: [
          row("black", "4mm curl", "HD13*4", "M", 2),
          row("black", "8mm curl", "HD13*4", "M", 3),
        ],
        commit: true,
      }),
    ).rejects.toMatchObject({ code: "COUNT_NOT_RECONCILED" });
    expect(repo.createAdjustment).not.toHaveBeenCalled();
  });

  test("allow_unmatched files anyway, for a checked-by-hand sheet", async () => {
    const res = await run({
      rows: [
        row("black", "4mm curl", "HD13*4", "M", 2),
        row("black", "8mm curl", "HD13*4", "M", 3),
      ],
      unlisted: "skip",
      commit: true,
      allow_unmatched: true,
    });
    expect(res.adjustment.adjustment_number).toBe("FLH-ADJ-0007");
  });

  test("refuses when the system already matches the sheet", async () => {
    await expect(
      run({
        rows: [
          row("black", "4mm curl", "HD13*4", "M", 9),
          row("black", "Yaki", "HD13*6", "L", 2),
          row("T3/12", "Straight", "HD6*6 left part", "M", 1),
        ],
        commit: true,
      }),
    ).rejects.toMatchObject({ code: "NOTHING_TO_CORRECT" });
    expect(repo.createAdjustment).not.toHaveBeenCalled();
  });

  test("refuses to guess when two locations hold stock", async () => {
    repo.locationsWithStock.mockResolvedValue([
      LOC,
      {
        location_id: "22222222-2222-4222-8222-222222222222",
        display_name: "Warehouse",
        is_default: false,
        is_active: true,
        on_hand: 40,
      },
    ]);
    await expect(
      run({ rows: [row("black", "4mm curl", "HD13*4", "M", 2)] }),
    ).rejects.toThrow(/Stock sits at 2 locations/);
  });
});

// ── template round-trip ──────────────────────────────────

describe("rows carrying a product code", () => {
  test("the code settles the match, whatever the axes say", async () => {
    const res = await run({
      rows: [
        {
          "Product Code": "FLH079N",
          "Product Name": "Black 4mm Curl HD13x4 Pixie Wig - Medium",
          Color: "totally wrong",
          Texture: "nonsense",
          "Cap Construction": "??",
          Size: "M",
          "Units No.": 4,
        },
      ],
      unlisted: "skip",
    });
    expect(res.lines).toEqual([
      expect.objectContaining({ product_id: "p1", physical_count: 4 }),
    ]);
  });

  test("an unknown code is reported, not silently matched by axes", async () => {
    const res = await run({
      rows: [{ "Product Code": "FLH999X", "Units No.": 4 }],
      unlisted: "skip",
    });
    expect(res.unmatched[0].error).toMatch(/No base product with code/);
  });
});
