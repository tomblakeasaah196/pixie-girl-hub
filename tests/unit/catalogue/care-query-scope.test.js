"use strict";

jest.mock("../../../src/config/database", () => ({ ex: (client) => client.query.bind(client), query: jest.fn() }));
const repo = require("../../../src/modules/catalogue/catalogue.repo");
const careRepo = require("../../../src/modules/catalogue/care-accessories.repo");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const rows = () => ({ query: jest.fn().mockResolvedValue({ rows: [{ total: 0 }] }) });

async function catalogueList(brand, filters) {
  const client = rows();
  await repo.findAllProducts({ client, brand, filters });
  return client.query.mock.calls;
}

test("legacy product listing searches the BASE role even for FLH; Care opts in explicitly", async () => {
  for (const brand of ["pixiegirl", "faitlynhair"]) {
    const calls = await catalogueList(brand, { q: "Oil" });
    expect(calls[0][0]).toContain("p.catalogue_role = $1");
    expect(calls[0][1][0]).toBe("base");
    expect(calls[1][1][0]).toBe("base");
    expect(calls[1][0]).not.toContain("AS stock_on_hand");
  }
  const care = await catalogueList("pixiegirl", { catalogue_role: "retail", q: "PXG-OIL-50" });
  expect(care[0][1]).toEqual(["retail", "%PXG-OIL-50%"]);
  expect(care[1][0]).toMatch(/pvq\.sku ILIKE/);
  expect(care[1][0]).toMatch(/pvq\.barcode ILIKE/);
  expect(care[1][0]).toContain("AS stock_on_hand");
  expect(care[1][0]).toContain("cat.name AS category_name");
  expect(care[1][0]).toContain("cat.category_id = p.category_id");
  expect(care[1][0]).not.toContain("PXG-OIL-50");
});

test("staff Care detail gets physical stock across all locations; sellable availability remains location-limited", async () => {
  const client = rows();
  await repo.findProductById({ client, brand: "pixiegirl", id: "oil", includeOnHand: true });
  await repo.listVariants({ client, brand: "pixiegirl", product_id: "oil", includeOnHand: true });
  for (const [sql] of client.query.mock.calls) {
    expect(sql).toContain("AS stock_on_hand");
    expect(sql).toContain("AS stock_available");
    expect(sql).toContain("available_for_storefront = true");
    expect(sql).toMatch(/SUM\(sl\.on_hand\)/);
  }
});

test("Cost Vault/legacy plaintext standard cost cannot masquerade as a Care operational COGS basis", async () => {
  const client = rows();
  await stockRepo.getCostBasisForVariants({ client, brand: "pixiegirl", variant_ids: ["v50"] });
  const [sql] = client.query.mock.calls[0];
  expect(sql).toContain("WHEN p.catalogue_role = 'retail' THEN NULLIF(vc.avg_cost_ngn, 0)");
  expect(sql).toContain("ELSE COALESCE(NULLIF(vc.avg_cost_ngn, 0), pv.cost_price_ngn)");
});

test("deactivation/trash cannot strand stock or outstanding purchase/shipment lines", async () => {
  const client = rows();
  await careRepo.deactivate({ client, brand: "pixiegirl", product_id: "oil", variant_id: "v50" });
  await careRepo.trash({ client, brand: "pixiegirl", id: "oil" });
  for (const [sql] of client.query.mock.calls) {
    expect(sql).toContain("po_lines");
    expect(sql).toContain("purchase_orders");
    expect(sql).toContain("qty_outstanding > 0");
    expect(sql).toContain("inbound_shipment_lines");
    expect(sql).toContain("inbound_shipments");
    expect(sql).toMatch(/sl\.on_hand <> 0 OR sl\.reserved <> 0/);
  }
});

test("bulk stock register and historical inventory reports exclude retail SKUs", async () => {
  const client = rows();
  await stockRepo.listProductStock({ client, brand: "pixiegirl", filters: { q: "Oil" } });
  const [sql] = client.query.mock.calls[0];
  expect(sql).toContain("p.catalogue_role = 'base'");
  expect(sql).toContain("LEFT JOIN lv ON lv.product_id = p.product_id");
});
