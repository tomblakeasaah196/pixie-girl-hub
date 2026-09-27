"use strict";

// A catalogue USD rate request approved from the generic approvals inbox must
// APPLY the requested rate (via the catalogue module), not just flip the
// workflow instance to approved and leave the rate unchanged.

let mockInstance;

jest.mock("../../../src/shared/org_workflow/approvals.repo", () => ({
  findInstance: jest.fn(async () => mockInstance),
  listDecisions: jest.fn(async () => []),
}));
jest.mock("../../../src/workflows/engine", () => ({
  act: jest.fn(async () => ({ status: "approved", current_stage: 1 })),
  normaliseStages: jest.fn(() => []),
}));
jest.mock("../../../src/modules/catalogue/usd-reprice.service", () => ({
  RATE_CHANGE_REF: "catalogue_usd_rate_changes",
  approveRateChange: jest.fn(async () => ({ status: "applied" })),
  rejectRateChange: jest.fn(async () => ({ status: "rejected" })),
}));
jest.mock("../../../src/shared/org_workflow/org.events", () => ({ emit: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));

const wf = require("../../../src/workflows/engine");
const usdReprice = require("../../../src/modules/catalogue/usd-reprice.service");
const service = require("../../../src/shared/org_workflow/approvals.service");

const CEO = { user_id: "ceo-1", is_ceo: true };
const base = { instance_id: "inst-1", status: "pending", definition: { stages: [] } };

beforeEach(() => jest.clearAllMocks());

test("approving a rate request from the inbox applies it through the catalogue", async () => {
  mockInstance = { ...base, reference_table: "catalogue_usd_rate_changes" };
  await service.act({
    brand: "faitlynhair",
    user: CEO,
    request_id: "r",
    instance_id: "inst-1",
    action: "approve",
  });
  expect(usdReprice.approveRateChange).toHaveBeenCalledWith(
    expect.objectContaining({ brand: "faitlynhair", instance_id: "inst-1" }),
  );
  expect(wf.act).not.toHaveBeenCalled();
});

test("rejecting one goes through the catalogue too", async () => {
  mockInstance = { ...base, reference_table: "catalogue_usd_rate_changes" };
  await service.act({
    brand: "faitlynhair",
    user: CEO,
    request_id: "r",
    instance_id: "inst-1",
    action: "reject",
  });
  expect(usdReprice.rejectRateChange).toHaveBeenCalled();
  expect(wf.act).not.toHaveBeenCalled();
});

test("every other approval is decided by the engine as before", async () => {
  mockInstance = { ...base, reference_table: "expenses" };
  await service.act({
    brand: "faitlynhair",
    user: CEO,
    request_id: "r",
    instance_id: "inst-1",
    action: "approve",
  });
  expect(wf.act).toHaveBeenCalled();
  expect(usdReprice.approveRateChange).not.toHaveBeenCalled();
});
