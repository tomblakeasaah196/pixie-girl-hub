"use strict";

// Exercise the actual Express route ordering, permission check, brand gate and
// validation without a database. A header in this isolated test acts as the
// authenticated brand context; the production brand middleware is unchanged.
require("express-async-errors");
const express = require("express");
const request = require("supertest");

jest.mock("../../../src/config/env", () => ({ config: { FEATURE_PXG_CARE_ACCESSORIES_ENABLED: false, MEDIA_MAX_FILE_SIZE_MB: 10 } }));
jest.mock("../../../src/middleware/rbac", () => ({
  requirePermission: (module, action) => (req, res, next) =>
    req.user?.permissions?.includes(`${module}.${action}`) ? next() : res.status(403).json({ error: { code: "DENIED" } }),
}));
jest.mock("../../../src/modules/catalogue/care-accessories.service");
jest.mock("../../../src/modules/catalogue/catalogue.repo", () => ({ findProductById: jest.fn() }));
jest.mock("../../../src/modules/catalogue/catalogue.controller", () =>
  new Proxy({}, { get: () => jest.fn((_req, res) => res.json({ data: "legacy handler" })) }));
jest.mock("../../../src/modules/catalogue/styled.controller", () =>
  new Proxy({}, { get: () => jest.fn((_req, res) => res.json({ data: "styled handler" })) }));
jest.mock("../../../src/modules/catalogue/styled_variants.controller", () =>
  new Proxy({}, { get: () => jest.fn((_req, res) => res.json({ data: "styled variant handler" })) }));
jest.mock("../../../src/modules/catalogue/cost_vault.controller", () =>
  new Proxy({}, { get: () => jest.fn((_req, res) => res.json({ data: "vault handler" })) }));
jest.mock("../../../src/modules/catalogue/usd-reprice.controller", () =>
  new Proxy({}, { get: () => jest.fn((_req, res) => res.json({ data: "USD handler" })) }));
jest.mock("../../../src/modules/catalogue/shades.controller", () =>
  new Proxy({}, { get: () => jest.fn((_req, res) => res.json({ data: "shade handler" })) }));

const { config } = require("../../../src/config/env");
const service = require("../../../src/modules/catalogue/care-accessories.service");
const productRepo = require("../../../src/modules/catalogue/catalogue.repo");
const router = require("../../../src/modules/catalogue/catalogue.routes");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.brand = req.get("x-test-brand") || "pixiegirl";
  req.user = { permissions: (req.get("x-test-perms") || "catalogue.view").split(",") };
  next();
});
app.use("/catalogue", router);
app.use((err, _req, res, _next) => res.status(err.http_status || 500).json({ error: { code: err.code || "ERROR", message: err.message } }));
const careUrl = "/catalogue/care-accessories";
const id = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = false;
  productRepo.findProductById.mockResolvedValue({ product_id: id, catalogue_role: "retail" });
  service.list.mockResolvedValue({ data: [], meta: { total: 0 } });
  service.categories.mockResolvedValue([]);
  service.getOne.mockResolvedValue({ product_id: id });
});

test("only PXG reports availability true, and only after explicit server flag", async () => {
  expect((await request(app).get(`${careUrl}/availability`)).body.data).toEqual({ enabled: false });
  config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = true;
  expect((await request(app).get(`${careUrl}/availability`)).body.data).toEqual({ enabled: true });
  expect((await request(app).get(`${careUrl}/availability`).set("x-test-brand", "faitlynhair")).body.data).toEqual({ enabled: false });
});

test("FLH and flag-off block forged catalogue and legacy image/variant URL before handler", async () => {
  expect((await request(app).get(careUrl)).status).toBe(404);
  expect((await request(app).get(`/catalogue/products/${id}/images`)).status).toBe(404);
  expect(service.list).not.toHaveBeenCalled();
  config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = true;
  for (const url of [careUrl, `${careUrl}/${id}`, `/catalogue/products/${id}/variants`, `/catalogue/products/${id}/images`])
    expect((await request(app).get(url).set("x-test-brand", "faitlynhair")).status).toBe(404);
  expect(service.list).not.toHaveBeenCalled();
  expect(service.getOne).not.toHaveBeenCalled();
});

test("PXG-only list/detail/categories are routed, but every read still needs catalogue.view", async () => {
  config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = true;
  expect((await request(app).get(careUrl).set("x-test-perms", "stock.view")).status).toBe(403);
  expect((await request(app).get(careUrl)).status).toBe(200);
  expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ brand: "pixiegirl" }));
  expect((await request(app).get(`${careUrl}/categories`)).body.data).toEqual([]);
  expect((await request(app).get(`${careUrl}/${id}`)).body.data.product_id).toBe(id);
});

test("create requires Catalogue Create and correct schema; publish requires Catalogue Approve", async () => {
  config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = true;
  expect((await request(app).post(careUrl).send({ name: "Comb" })).status).toBe(403);
  const invalid = await request(app).post(careUrl).set("x-test-perms", "catalogue.create").send({ name: "Comb", batch_number: "x" });
  expect(invalid.status).toBeGreaterThanOrEqual(400);
  expect(service.create).not.toHaveBeenCalled();
  expect((await request(app).post(`${careUrl}/${id}/publish`).set("x-test-perms", "catalogue.edit")).status).toBe(403);
  service.publish.mockResolvedValue({ product_id: id, retail_status: "live" });
  expect((await request(app).post(`${careUrl}/${id}/publish`).set("x-test-perms", "catalogue.approve")).status).toBe(200);
});
