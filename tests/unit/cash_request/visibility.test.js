"use strict";

// Exercises the REAL cash-request service reads to prove approve-gated
// visibility: a view-only ('own' scope) caller may only open requests they
// submitted; approvers / CEO ('all' scope) see any request. The list query is
// delegated to repo.findAll, which receives the (already-gated) scope.

jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({ query: jest.fn() }),
  ex: () => jest.fn(),
  query: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/cash_request/cash-request.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/modules/cash_request/cash-request.repo");
jest.mock("../../../src/modules/accounting/accounting.service");
jest.mock("../../../src/modules/expenses/expenses.repo");
jest.mock("../../../src/modules/business_setup/business-config.repo");

const repo = require("../../../src/modules/cash_request/cash-request.repo");
const service = require("../../../src/modules/cash_request/cash-request.service");

const OWNER = { user_id: "staff-1", is_ceo: false };
const OTHER = { user_id: "staff-2", is_ceo: false };

function baseCr(over = {}) {
  return {
    cash_request_id: "cr-1",
    request_number: "PXG-CR-0001",
    submitted_by: "staff-1",
    purpose: "Buy paper",
    amount_requested_ngn: "50000.00",
    status: "pending_finance",
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.findById.mockResolvedValue(baseCr());
  repo.listDocuments.mockResolvedValue([{ document_id: "d-1" }]);
  repo.getHistory.mockResolvedValue([{ to_status: "pending_finance" }]);
});

describe("cash-request getById visibility", () => {
  test("'own' scope: submitter can open their own request", async () => {
    const cr = await service.getById({
      brand: "pixiegirl",
      id: "cr-1",
      scope: "own",
      user: OWNER,
    });
    expect(cr.cash_request_id).toBe("cr-1");
  });

  test("'own' scope: a non-submitter is refused (404, not leaked)", async () => {
    await expect(
      service.getById({
        brand: "pixiegirl",
        id: "cr-1",
        scope: "own",
        user: OTHER,
      }),
    ).rejects.toThrow("CashRequest");
  });

  test("'all' scope (approver/CEO): anyone's request is visible", async () => {
    const cr = await service.getById({
      brand: "pixiegirl",
      id: "cr-1",
      scope: "all",
      user: OTHER,
    });
    expect(cr.cash_request_id).toBe("cr-1");
  });
});

describe("cash-request sub-resources inherit the same gate", () => {
  test("listDocuments is blocked for a non-submitter under 'own'", async () => {
    await expect(
      service.listDocuments({
        brand: "pixiegirl",
        id: "cr-1",
        scope: "own",
        user: OTHER,
      }),
    ).rejects.toThrow("CashRequest");
    expect(repo.listDocuments).not.toHaveBeenCalled();
  });

  test("getHistory is blocked for a non-submitter under 'own'", async () => {
    await expect(
      service.getHistory({
        brand: "pixiegirl",
        id: "cr-1",
        scope: "own",
        user: OTHER,
      }),
    ).rejects.toThrow("CashRequest");
    expect(repo.getHistory).not.toHaveBeenCalled();
  });

  test("owner under 'own' still gets documents", async () => {
    const docs = await service.listDocuments({
      brand: "pixiegirl",
      id: "cr-1",
      scope: "own",
      user: OWNER,
    });
    expect(docs).toHaveLength(1);
    expect(repo.listDocuments).toHaveBeenCalled();
  });
});

describe("cash-request list delegates the gated scope to the repo", () => {
  test("'own' scope is passed straight through to findAll", async () => {
    repo.findAll.mockResolvedValue({ data: [], meta: {} });
    await service.list({
      brand: "pixiegirl",
      user: OWNER,
      scope: "own",
      filters: {},
      page: 1,
      page_size: 25,
    });
    expect(repo.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "own", user_id: "staff-1" }),
    );
  });
});
