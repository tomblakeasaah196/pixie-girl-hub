"use strict";

// Verifies postEntry's self-healing fiscal-period resolution (ensureOpenPeriod).
jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({ query: jest.fn() }),
  ex: () => jest.fn(),
  query: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/accounting/accounting.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/modules/accounting/accounting.repo");

const repo = require("../../../src/modules/accounting/accounting.repo");
const { audit } = require("../../../src/middleware/audit");
const service = require("../../../src/modules/accounting/accounting.service");

const PERIOD = { period_id: "per-1", period_name: "Jul 2026" };

const ENTRY = {
  brand: "faitlynhair",
  user_id: "u1",
  entry: { source_type: "expense", posting_date: "2026-07-15", reference: "R1" },
  lines: [
    { account_code: "5000", debit_ngn: "1000.00" },
    { account_code: "1100", credit_ngn: "1000.00" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  repo.getAccountByCode.mockImplementation(({ code }) =>
    Promise.resolve({ account_id: `acct-${code}` }),
  );
  repo.nextEntryNumber.mockResolvedValue("FLH-JE-0001");
  repo.insertEntry.mockResolvedValue({ entry_id: "je-1" });
  repo.insertLine.mockResolvedValue({});
  repo.setEntryStatus.mockResolvedValue({});
  repo.findEntryById.mockResolvedValue({ entry_id: "je-1", status: "posted" });
  // Default: nothing open, nothing future, nothing covering, create succeeds.
  repo.findActivePeriod.mockResolvedValue(null);
  repo.openFuturePeriod.mockResolvedValue(null);
  repo.findPeriodCoveringDate.mockResolvedValue(null);
  repo.createOpenMonthPeriod.mockResolvedValue(null);
});

test("uses an already-open period without touching future/create", async () => {
  repo.findActivePeriod.mockResolvedValue(PERIOD);
  const out = await service.postEntry(ENTRY);
  expect(out.entry_id).toBe("je-1");
  expect(repo.openFuturePeriod).not.toHaveBeenCalled();
  expect(repo.createOpenMonthPeriod).not.toHaveBeenCalled();
});

test("auto-opens a 'future' period that now covers the date", async () => {
  repo.openFuturePeriod.mockResolvedValue(PERIOD);
  const out = await service.postEntry(ENTRY);
  expect(out.entry_id).toBe("je-1");
  expect(repo.openFuturePeriod).toHaveBeenCalled();
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({ action_key: "accounting.period.auto_open" }),
  );
});

test("auto-creates the calendar month when no period covers the date", async () => {
  repo.createOpenMonthPeriod.mockResolvedValue(PERIOD);
  const out = await service.postEntry(ENTRY);
  expect(out.entry_id).toBe("je-1");
  expect(repo.createOpenMonthPeriod).toHaveBeenCalled();
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({ action_key: "accounting.period.auto_create" }),
  );
});

test("refuses to post into a deliberately closed period", async () => {
  repo.findPeriodCoveringDate.mockResolvedValue({
    period_id: "per-closed",
    status: "closed",
  });
  await expect(service.postEntry(ENTRY)).rejects.toMatchObject({
    code: "NO_OPEN_PERIOD",
  });
  expect(repo.createOpenMonthPeriod).not.toHaveBeenCalled();
  expect(repo.insertEntry).not.toHaveBeenCalled();
});

test("recovers from an insert race by re-reading the active period", async () => {
  // create returns null (ON CONFLICT DO NOTHING lost the race), then the row
  // is visible as active on re-read.
  repo.createOpenMonthPeriod.mockResolvedValue(null);
  repo.findActivePeriod
    .mockResolvedValueOnce(null) // first call in ensureOpenPeriod
    .mockResolvedValueOnce(PERIOD); // re-read after the race
  const out = await service.postEntry(ENTRY);
  expect(out.entry_id).toBe("je-1");
});
