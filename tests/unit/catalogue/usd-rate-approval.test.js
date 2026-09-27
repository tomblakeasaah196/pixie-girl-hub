"use strict";

// The catalogue USD rate is what every dollar checkout, pay link and Nomba USD
// credit converts at — changing it is the CEO's call. The CEO applies directly;
// anyone else's Apply becomes a CEO approval request that changes nothing until
// approved (which applies the REQUESTED rate, in the same transaction).

let mockPending = null;
let mockInstance = null;
const mockApplied = [];

jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({ query: jest.fn() })),
  ex: jest.fn(() => async (sql) => {
    if (/status = 'pending'/.test(sql))
      return { rows: mockPending ? [mockPending] : [] };
    if (/WHERE instance_id = \$1/.test(sql))
      return { rows: mockInstance ? [mockInstance] : [] };
    return { rows: [] };
  }),
  query: jest.fn(async () => ({ rows: [] })),
}));
jest.mock("../../../src/modules/catalogue/usd-reprice.repo", () => ({
  TABLES: [{ key: "base" }],
  status: jest.fn(async () => ({ config: { usd_fx_rate: 1500 }, last_run: null })),
  applyAll: jest.fn(async ({ rate }) => {
    mockApplied.push(rate);
    return { snapshot: {}, counts: { total: 3 }, rows_changed: 3 };
  }),
  insertRun: jest.fn(async () => ({ run_id: "run-1", applied_at: "2026-09-27" })),
  setConfigRate: jest.fn(),
  latestRun: jest.fn(async () => ({ run_id: "run-1", snapshot: {} })),
  restoreSnapshot: jest.fn(async () => 3),
  markUndone: jest.fn(),
}));
jest.mock("../../../src/workflows/engine", () => ({
  openInstance: jest.fn(async ({ reference_id, context }) => ({
    instance_id: "inst-1",
    reference_id,
    status: "pending",
    context,
  })),
  act: jest.fn(async ({ action }) => ({
    status: action === "approve" ? "approved" : "rejected",
  })),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/catalogue/catalogue.events", () => ({ emit: jest.fn() }));
jest.mock("../../../src/services/fx.service", () => ({ isConfigured: () => false }));

const wf = require("../../../src/workflows/engine");
const repo = require("../../../src/modules/catalogue/usd-reprice.repo");
const service = require("../../../src/modules/catalogue/usd-reprice.service");

const CEO = { user_id: "ceo-1", is_ceo: true };
const STAFF = { user_id: "staff-1", is_ceo: false };
const input = { brand: "faitlynhair", request_id: "r", rate: 1550, rounding: "exact", confirm: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = null;
  mockInstance = null;
  mockApplied.length = 0;
});

test("the CEO's Apply reprices at once", async () => {
  const out = await service.apply({ ...input, user: CEO });
  expect(out.status).toBe("applied");
  expect(mockApplied).toEqual([1550]);
  expect(repo.setConfigRate).toHaveBeenCalledWith(expect.objectContaining({ rate: 1550 }));
  expect(wf.openInstance).not.toHaveBeenCalled();
});

test("anyone else's Apply opens a CEO request and changes nothing", async () => {
  const out = await service.apply({ ...input, user: STAFF });
  expect(out).toMatchObject({ status: "pending_approval", instance_id: "inst-1", rate: 1550 });
  expect(mockApplied).toEqual([]);
  expect(repo.setConfigRate).not.toHaveBeenCalled();
  expect(wf.openInstance).toHaveBeenCalledWith(
    expect.objectContaining({
      business: "faitlynhair",
      trigger_module: "catalogue",
      trigger_action: "usd_rate_change",
      reference_table: "catalogue_usd_rate_changes",
      context: expect.objectContaining({
        rate: 1550,
        current_rate: 1500,
        description: expect.stringContaining("₦1,550/$1"),
      }),
    }),
  );
});

test("a second request is refused while one is waiting", async () => {
  mockPending = { instance_id: "inst-0", context: { rate: 1520 }, initiated_at: "x" };
  await expect(service.apply({ ...input, user: STAFF })).rejects.toMatchObject({
    code: "RATE_CHANGE_PENDING",
  });
  expect(wf.openInstance).not.toHaveBeenCalled();
});

test("approving applies the REQUESTED rate in the same transaction", async () => {
  mockInstance = {
    instance_id: "inst-1",
    business: "faitlynhair",
    reference_table: "catalogue_usd_rate_changes",
    reference_id: "ref-1",
    status: "pending",
    context: { rate: 1550, rounding: "whole" },
  };
  const out = await service.approveRateChange({
    brand: "faitlynhair",
    user: CEO,
    request_id: "r",
    instance_id: "inst-1",
  });
  expect(wf.act).toHaveBeenCalledWith(
    expect.objectContaining({ instance_id: "inst-1", action: "approve" }),
  );
  expect(out).toMatchObject({ status: "applied", rate: 1550, rounding: "whole" });
  expect(mockApplied).toEqual([1550]);
});

test("rejecting changes nothing", async () => {
  mockInstance = {
    instance_id: "inst-1",
    business: "faitlynhair",
    reference_table: "catalogue_usd_rate_changes",
    status: "pending",
    context: { rate: 1550 },
  };
  const out = await service.rejectRateChange({
    brand: "faitlynhair",
    user: CEO,
    request_id: "r",
    instance_id: "inst-1",
  });
  expect(out.status).toBe("rejected");
  expect(mockApplied).toEqual([]);
});

test("a decided or foreign request can't be acted on", async () => {
  mockInstance = null; // not this brand's, or not a rate change
  await expect(
    service.approveRateChange({ brand: "faitlynhair", user: CEO, instance_id: "x" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  mockInstance = { instance_id: "inst-1", status: "approved", context: {} };
  await expect(
    service.approveRateChange({ brand: "faitlynhair", user: CEO, instance_id: "inst-1" }),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
  expect(wf.act).not.toHaveBeenCalled();
});

test("only the CEO can undo — undo is a rate change too", async () => {
  await expect(service.undo({ brand: "faitlynhair", user: STAFF })).rejects.toMatchObject({
    code: "CEO_ONLY",
  });
  const out = await service.undo({ brand: "faitlynhair", user: CEO, request_id: "r" });
  expect(out.rows_restored).toBe(3);
});
