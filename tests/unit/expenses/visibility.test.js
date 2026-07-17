"use strict";

// Exercises the REAL expenses service reads to prove approve-gated visibility:
// a view-only ('own' scope) caller sees only expenses / advances they
// submitted; approvers / CEO ('all' scope) see everyone's. The list handlers
// translate 'own' into a submitted_by / requested_by filter.

jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({ query: jest.fn() }),
  ex: () => jest.fn(),
  query: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/expenses/expenses.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/modules/expenses/expenses.repo");
jest.mock("../../../src/workflows/engine");
jest.mock("../../../src/modules/accounting/accounting.service");
jest.mock("../../../src/shared/documents/documents.service");
jest.mock("../../../src/services/media-compression.service");

const repo = require("../../../src/modules/expenses/expenses.repo");
const service = require("../../../src/modules/expenses/expenses.service");

const OWNER = { user_id: "staff-1", is_ceo: false };
const OTHER = { user_id: "staff-2", is_ceo: false };

beforeEach(() => {
  jest.clearAllMocks();
  repo.findById.mockResolvedValue({
    expense_id: "exp-1",
    submitted_by: "staff-1",
    status: "pending",
    lines: [],
  });
  repo.getAdvance.mockResolvedValue({
    advance_id: "adv-1",
    requested_by: "staff-1",
    status: "pending",
  });
  repo.listReceipts.mockResolvedValue([{ receipt_id: "r-1" }]);
  repo.listExpenses.mockResolvedValue({ data: [], meta: {} });
  repo.listAdvances.mockResolvedValue({ data: [], meta: {} });
  repo.kpis.mockResolvedValue({ pending_amount: 0 });
});

describe("expenses getById visibility", () => {
  test("'own' scope: submitter can open their own expense", async () => {
    const e = await service.getById({
      brand: "pixiegirl",
      id: "exp-1",
      scope: "own",
      user: OWNER,
    });
    expect(e.expense_id).toBe("exp-1");
  });

  test("'own' scope: a non-submitter is refused", async () => {
    await expect(
      service.getById({
        brand: "pixiegirl",
        id: "exp-1",
        scope: "own",
        user: OTHER,
      }),
    ).rejects.toThrow("Expense");
  });

  test("'all' scope: anyone's expense is visible", async () => {
    const e = await service.getById({
      brand: "pixiegirl",
      id: "exp-1",
      scope: "all",
      user: OTHER,
    });
    expect(e.expense_id).toBe("exp-1");
  });
});

describe("expenses advances + receipts inherit the gate", () => {
  test("getAdvance refuses a non-requester under 'own'", async () => {
    await expect(
      service.getAdvance({
        brand: "pixiegirl",
        id: "adv-1",
        scope: "own",
        user: OTHER,
      }),
    ).rejects.toThrow("Cash advance");
  });

  test("listReceipts is blocked for a non-submitter under 'own'", async () => {
    await expect(
      service.listReceipts({
        brand: "pixiegirl",
        id: "exp-1",
        scope: "own",
        user: OTHER,
      }),
    ).rejects.toThrow("Expense");
    expect(repo.listReceipts).not.toHaveBeenCalled();
  });
});

describe("expenses list handlers translate 'own' to a self filter", () => {
  test("listExpenses under 'own' forces submitted_by = caller", async () => {
    await service.listExpenses({
      brand: "pixiegirl",
      scope: "own",
      user: OWNER,
      filters: { submitted_by: "staff-2" }, // attempt to view another user
      page: 1,
      page_size: 25,
    });
    expect(repo.listExpenses).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ submitted_by: "staff-1" }),
      }),
    );
  });

  test("listAdvances under 'all' applies no self filter", async () => {
    await service.listAdvances({
      brand: "pixiegirl",
      scope: "all",
      user: OWNER,
      filters: {},
      page: 1,
      page_size: 25,
    });
    const arg = repo.listAdvances.mock.calls[0][0];
    expect(arg.filters.requested_by).toBeUndefined();
  });

  test("kpis under 'own' aggregate only the caller's expenses", async () => {
    await service.kpis({ brand: "pixiegirl", scope: "own", user: OWNER });
    expect(repo.kpis).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "own", user_id: "staff-1" }),
    );
  });
});
