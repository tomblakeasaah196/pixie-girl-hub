"use strict";

/**
 * Delivery-zone rate-card importer — parse-level tests.
 *
 * Verifies the importer ingests the THREE original supplier rate cards exactly
 * as received (separate workbooks, title banners, ₦-formatted text money,
 * "TBD (Local)" / "Use Local Courier" placeholders) without a database. Builds
 * in-memory workbooks mirroring each supplier's layout.
 */

const ExcelJS = require("exceljs");
const {
  _internals,
} = require("../../../src/modules/logistics/zones.import-export");

const { parseNaira, normName, detectCourier, parseSheet } = _internals;

/** Build a single-sheet workbook from a 2D array of rows. */
async function sheetFrom(name, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name);
  rows.forEach((r) => ws.addRow(r));
  // Round-trip through the binary format so cells read back like a real upload.
  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  return wb2.getWorksheet(name);
}

const TIER_HEADERS = [
  "1 - 2 Wigs\n(Base Rate: Up to 2kg)",
  "3 - 4 Wigs\n(Next Tier: Up to 4kg)",
  "5 - 6 Wigs\n(Large Tier: Up to 6kg)",
  "Every Extra 2 Wigs\n(+ Progressive Add-on)",
];

describe("parseNaira", () => {
  it("parses ₦-formatted text and plain numbers", () => {
    expect(parseNaira("₦88,100")).toBe(88100);
    expect(parseNaira("+ ₦84,000")).toBe(84000);
    expect(parseNaira(7500)).toBe(7500);
    expect(parseNaira("₦4,500")).toBe(4500);
  });
  it("returns null for placeholders / blanks", () => {
    expect(parseNaira("TBD (Local)")).toBeNull();
    expect(parseNaira("Use Local Courier")).toBeNull();
    expect(parseNaira("N/A")).toBeNull();
    expect(parseNaira("")).toBeNull();
    expect(parseNaira(null)).toBeNull();
    expect(parseNaira(undefined)).toBeNull();
  });
});

describe("normName", () => {
  it("normalises away parenthetical drift so seeded zones match", () => {
    expect(normName("Lagos Mainland (Yaba, etc.)")).toBe("lagos mainland");
    expect(normName("Lagos Mainland (Yaba)")).toBe("lagos mainland");
    expect(normName("FCT (Abuja)")).toBe("fct");
    expect(normName("Eti-Osa (Lekki, VI, Ikoyi)")).toBe("eti osa");
  });
});

describe("DHL Global rate card (title banner + ₦ text + Nigeria placeholder)", () => {
  let ws;
  beforeAll(async () => {
    ws = await sheetFrom("Global DHL Rates (+10% Margin)", [
      ["DHL GLOBAL EXPORT RATE CARD (FROM LAGOS) - INCLUDES 10% SAFETY MARGIN"],
      ["Continent", "Country", "DHL Zone (Est.)", ...TIER_HEADERS],
      ["Africa", "Algeria", "Zone 2", "₦88,100", "₦178,600", "₦262,500", "+ ₦84,000"],
      ["Africa", "Benin", "Zone 1", "₦79,400", "₦169,900", "₦250,500", "+ ₦80,600"],
      ["Africa", "Nigeria", "N/A", "Use Local Courier", "Use Local Courier", "Use Local Courier", "N/A"],
    ]);
  });

  it("detects the DHL courier from the banner/headers", () => {
    expect(detectCourier(ws)).toBe("dhl_express");
  });

  it("skips the title row and Nigeria's local-courier placeholder", () => {
    const { rows, skipped } = parseSheet(ws, "dhl_express");
    expect(rows.map((r) => r.name)).toEqual(["Algeria", "Benin"]);
    expect(skipped).toBe(1);
  });

  it("parses the ₦ tier rates into the rate card", () => {
    const { rows } = parseSheet(ws, "dhl_express");
    const algeria = rows.find((r) => r.name === "Algeria");
    expect(algeria.fee_ngn).toBe(88100);
    expect(algeria.rate_card.tiers.map((t) => t.fee_ngn)).toEqual([
      88100, 178600, 262500,
    ]);
    expect(algeria.rate_card.add_on_per_2_ngn).toBe(84000);
  });
});

describe("Nationwide rate card (header in row 1, Lagos TBD placeholder)", () => {
  let ws;
  beforeAll(async () => {
    ws = await sheetFrom("Logistics Rates (Nationwide)", [
      ["State", "Geopolitical Zone", ...TIER_HEADERS],
      ["Abia", "South-East", "₦7,500", "₦10,500", "₦13,500", "+ ₦3,000"],
      ["Lagos", "South-West", "TBD (Local)", "TBD (Local)", "TBD (Local)", "TBD"],
      ["Ogun", "South-West", "₦4,000", "₦5,500", "₦7,000", "+ ₦1,500"],
    ]);
  });

  it("detects the nationwide courier", () => {
    expect(detectCourier(ws)).toBe("nationwide");
  });

  it("imports states but skips Lagos (handled by the Lagos card)", () => {
    const { rows, skipped } = parseSheet(ws, "nationwide");
    expect(rows.map((r) => r.name)).toEqual(["Abia", "Ogun"]);
    expect(skipped).toBe(1);
  });
});

describe("Safe Lagos rate card (title banner + LGA column)", () => {
  let ws;
  beforeAll(async () => {
    ws = await sheetFrom("Safe Rates - Lekki Pickup", [
      ["LAGOS LOGISTICS RATE CARD (PICKUP: LEKKI PHASE 1) - WITH 3PL SAFETY BUFFER"],
      ["Local Government Area (LGA)", "Distance from Lekki Ph 1", ...TIER_HEADERS],
      ["Agege", "Deep Mainland", "₦10,000", "₦12,000", "₦14,000", "+ ₦2,000"],
      ["Eti-Osa (Lekki, VI, Ikoyi)", "Immediate Proximity", "₦4,500", "₦5,500", "₦6,500", "+ ₦1,000"],
    ]);
  });

  it("detects the Safe Lagos courier and parses every LGA", () => {
    expect(detectCourier(ws)).toBe("safe_lagos");
    const { rows, skipped } = parseSheet(ws, "safe_lagos");
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(rows[1].name).toBe("Eti-Osa (Lekki, VI, Ikoyi)");
    expect(rows[1].fee_ngn).toBe(4500);
  });
});

describe("downloaded template round-trip (plain numbers, Zone Code column)", () => {
  it("re-imports the exported template shape", async () => {
    const ws = await sheetFrom("Nigeria - States", [
      [
        "Zone Name",
        "Zone Code (do not change)",
        "1-2 Wigs – Base Rate (NGN)",
        "3-4 Wigs (NGN)",
        "5-6 Wigs (NGN)",
        "Every Extra 2 Wigs – Add-on (NGN)",
        "Active (Y/N)",
      ],
      ["Abia", "NG-AB", 7500, 10500, 13500, 3000, "Y"],
    ]);
    expect(detectCourier(ws)).toBe("nationwide");
    const { rows } = parseSheet(ws, "nationwide");
    expect(rows[0]).toMatchObject({
      name: "Abia",
      country_code: "NG-AB",
      fee_ngn: 7500,
    });
  });
});
