"use strict";

// Exercises the REAL cash-request service.disburse with mocked I/O, focusing on
// the CEO single-click disbursement fast-path and the approval invariants.
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
const accounting = require("../../../src/modules/accounting/accounting.service");
const expensesRepo = require("../../../src/modules/expenses/expenses.repo");
const service = require("../../../src/modules/cash_request/cash-request.service");

const CEO = { user_id: "ceo-1", is_ceo: true };
const FINANCE = { user_id: "fin-1", is_ceo: false };

function baseCr(over = {}) {
  return {
    cash_request_id: "cr-1",
    request_number: "PXG-CR-0001",
    submitted_by: "staff-1",
    category_key: "office_supplies",
    purpose: "Buy paper",
    amount_requested_ngn: "50000.00",
    requires_settlement: false,
    status: "approved",
    finance_reviewed_by: null,
    finance_reviewed_at: null,
    finance_decision: null,
    requires_ceo_approval: null,
    ...over,
  };
}

const DISBURSE_INPUT = { bank_transaction_id: "TRF-123" };

beforeEach(() => {
  jest.clearAllMocks();
  accounting.postEntry.mockResolvedValue({ entry_id: "je-1" });
  expensesRepo.nextNumber.mockResolvedValue("PXG-EXP-0001");
  expensesRepo.createExpense.mockResolvedValue({ expense_id: "exp-1" });
  repo.findExpenseCategory.mockResolvedValue({
    category_id: "cat-1",
    default_account_id: "acct-5000",
  });
  repo.updateStatus.mockImplementation(({ status }) =>
    Promise.resolve(baseCr({ status })),
  );
  repo.insertStateHistory.mockResolvedValue();
});

function fieldsFromUpdate() {
  return repo.updateStatus.mock.calls[0][0].fields;
}

describe("cash-request disburse", () => {
  test("finance disburses an approved request → disbursed", async () => {
    repo.findById.mockResolvedValue(baseCr({ status: "approved" }));
    const out = await service.disburse({
      brand: "pixiegirl",
      user: FINANCE,
      request_id: "req-1",
      id: "cr-1",
      input: DISBURSE_INPUT,
    });
    expect(out.status).toBe("disbursed");
    expect(accounting.postEntry).toHaveBeenCalledTimes(1);
    expect(expensesRepo.createExpense).toHaveBeenCalledTimes(1);
  });

  test("finance CANNOT disburse a pending_ceo request", async () => {
    repo.findById.mockResolvedValue(baseCr({ status: "pending_ceo" }));
    await expect(
      service.disburse({
        brand: "pixiegirl",
        user: FINANCE,
        request_id: "req-1",
        id: "cr-1",
        input: DISBURSE_INPUT,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(accounting.postEntry).not.toHaveBeenCalled();
  });

  test("CEO disburses a pending_ceo request in one click, stamping approvals", async () => {
    repo.findById.mockResolvedValue(
      baseCr({
        status: "pending_ceo",
        finance_reviewed_by: "fin-1",
        finance_reviewed_at: "2026-07-01T00:00:00.000Z",
        finance_decision: "approve",
        requires_ceo_approval: true,
      }),
    );
    const out = await service.disburse({
      brand: "pixiegirl",
      user: CEO,
      request_id: "req-1",
      id: "cr-1",
      input: DISBURSE_INPUT,
    });
    expect(out.status).toBe("disbursed");
    const fields = fieldsFromUpdate();
    // CEO approval stamped as part of the disbursement…
    expect(fields.ceo_decided_by).toBe("ceo-1");
    expect(fields.ceo_decision).toBe("approve");
    // …the real finance review is preserved…
    expect(fields.finance_reviewed_by).toBe("fin-1");
    // …and the disbursement fields (DB invariant) are all present.
    expect(fields.disbursed_by).toBe("ceo-1");
    expect(fields.bank_transaction_id).toBe("TRF-123");
    expect(fields.amount_disbursed_ngn).toBe("50000.00");
  });

  test("CEO disburses straight from pending_finance, self-stamping finance review", async () => {
    repo.findById.mockResolvedValue(baseCr({ status: "pending_finance" }));
    const out = await service.disburse({
      brand: "pixiegirl",
      user: CEO,
      request_id: "req-1",
      id: "cr-1",
      input: DISBURSE_INPUT,
    });
    expect(out.status).toBe("disbursed");
    const fields = fieldsFromUpdate();
    expect(fields.finance_reviewed_by).toBe("ceo-1");
    expect(fields.finance_decision).toBe("approve");
    expect(fields.ceo_decided_by).toBe("ceo-1");
  });

  test("CEO disbursing an already-approved request does not re-stamp approvals", async () => {
    repo.findById.mockResolvedValue(
      baseCr({
        status: "approved",
        finance_reviewed_by: "fin-1",
        ceo_decided_by: "someone-else",
      }),
    );
    await service.disburse({
      brand: "pixiegirl",
      user: CEO,
      request_id: "req-1",
      id: "cr-1",
      input: DISBURSE_INPUT,
    });
    const fields = fieldsFromUpdate();
    expect(fields.ceo_decided_by).toBeUndefined();
    expect(fields.finance_reviewed_by).toBeUndefined();
  });

  test("disburse still requires a bank transaction id", async () => {
    repo.findById.mockResolvedValue(baseCr({ status: "approved" }));
    await expect(
      service.disburse({
        brand: "pixiegirl",
        user: CEO,
        request_id: "req-1",
        id: "cr-1",
        input: {},
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_ID_REQUIRED" });
  });

  test("CEO cannot disburse a terminal (cancelled) request", async () => {
    repo.findById.mockResolvedValue(baseCr({ status: "cancelled" }));
    await expect(
      service.disburse({
        brand: "pixiegirl",
        user: CEO,
        request_id: "req-1",
        id: "cr-1",
        input: DISBURSE_INPUT,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
