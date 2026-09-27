"use strict";

// Care & Accessories is switched on/off from Catalogue → Config (the size-config
// save), not a server .env variable. The save must store the switch for Pixie
// Girl, make it take effect at once (drop the gate's cached value AFTER the
// commit), and refuse it for any other brand.

jest.mock("../../../src/config/env", () => ({ config: {} }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn((fn) => fn({ query: jest.fn() })),
  query: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/catalogue/catalogue.events", () => ({ emit: jest.fn() }));
jest.mock("../../../src/modules/catalogue/styled_variants.repo");
jest.mock("../../../src/modules/catalogue/care-accessories.gate", () => ({
  ...jest.requireActual("../../../src/modules/catalogue/care-accessories.gate"),
  invalidate: jest.fn(),
}));

const repo = require("../../../src/modules/catalogue/styled_variants.repo");
const gate = require("../../../src/modules/catalogue/care-accessories.gate");
const { audit } = require("../../../src/middleware/audit");
const { saveSizeConfig } = require("../../../src/modules/catalogue/styled_variants.service");
const { validateSizeConfig } = require("../../../src/modules/catalogue/styled_variants.validator");

const user = { user_id: "u1" };

beforeEach(() => {
  jest.clearAllMocks();
  repo.listSizeTiers.mockResolvedValue([]);
  repo.listLaceSizes.mockResolvedValue([]);
  repo.getConfig.mockResolvedValue({ care_accessories_enabled: true });
  repo.upsertConfig.mockImplementation(async ({ patch }) => ({ ...patch }));
});

test("PXG: the switch is stored, audited, and takes effect immediately", async () => {
  const out = await saveSizeConfig({
    brand: "pixiegirl", user, request_id: "r1", input: { care_accessories_enabled: false },
  });
  expect(repo.upsertConfig).toHaveBeenCalledWith(
    expect.objectContaining({ brand: "pixiegirl", patch: expect.objectContaining({ care_accessories_enabled: false }) }),
  );
  expect(out.config.care_accessories_enabled).toBe(false);
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({ after: expect.objectContaining({ care_accessories_enabled: false }) }),
  );
  expect(gate.invalidate).toHaveBeenCalledTimes(1);
});

test("other Config saves leave the switch (and the gate cache) alone", async () => {
  await saveSizeConfig({ brand: "pixiegirl", user, request_id: "r2", input: { rewig_enabled: false } });
  expect(repo.upsertConfig.mock.calls[0][0].patch.care_accessories_enabled).toBeUndefined();
  expect(gate.invalidate).not.toHaveBeenCalled();
});

test("FLH can never store the switch — refused before any write", async () => {
  await expect(
    saveSizeConfig({ brand: "faitlynhair", user, request_id: "r3", input: { care_accessories_enabled: true } }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(repo.upsertConfig).not.toHaveBeenCalled();
  expect(gate.invalidate).not.toHaveBeenCalled();
});

test("the validator accepts only a boolean switch", () => {
  const run = (body) => validateSizeConfig({ body }, {}, () => {});
  expect(() => run({ care_accessories_enabled: true })).not.toThrow();
  expect(() => run({ care_accessories_enabled: "yes" })).toThrow();
});
