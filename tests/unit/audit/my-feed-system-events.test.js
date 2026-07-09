"use strict";

// Guards the "My activity" feed against silently hiding a user's own
// cross-brand/system events (login, logout, email verification, or actions
// taken under a brand other than whichever one is currently active in the UI).
//
// Two independent layers used to strip these rows out:
//   1. myFeed's WHERE clause used to key on `business = $1` (the caller's
//      active X-Brand-Context brand), which never matches business='system'
//      (the value the audit() helper writes for pre-brand events, since
//      shared.audit_log.business is NOT NULL) nor any *other* brand the user
//      might have acted under.
//   2. Even after widening the WHERE clause, shared.audit_log has RLS enabled
//      with the standard per-business policy (migration 000200). Because
//      RLS_READ_ENFORCE defaults to true, a plain query() call during a
//      request with an ambient brand sets app.current_business to that brand,
//      and Postgres re-filters to `business = current_business()` underneath
//      any WHERE clause the app writes — silently undoing a WHERE-clause-only
//      fix.
//
// The real fix routes myFeed through brandTransaction(null, user_id, …):
// passing brand=null means the business GUC is never set, so RLS's
// `current_business() IS NULL OR …` clause lets every row through (the same
// "no filter" path already used for CEO cross-brand reads), and the query
// scopes purely by user_id — safe, since a user's own action history is never
// someone else's business data. If anyone reverts to a business-filtered
// WHERE clause or a plain query() call here, this test fails.

const mockClientQuery = jest.fn();

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(() => mockClientQuery),
  brandTransaction: jest.fn((brand, userId, fn) => fn({ query: mockClientQuery })),
}));

const db = require("../../../src/config/database");
const repo = require("../../../src/shared/audit/audit.repo");

beforeEach(() => {
  jest.clearAllMocks();
  mockClientQuery
    .mockResolvedValueOnce({ rows: [{ total: 0 }] })
    .mockResolvedValueOnce({ rows: [] });
});

describe("audit.repo.myFeed — cross-brand/system rows are never RLS-filtered out", () => {
  test("runs inside brandTransaction(null, user_id, …), never a live brand", async () => {
    await repo.myFeed({ user_id: "u-1" });

    expect(db.brandTransaction).toHaveBeenCalledWith(
      null,
      "u-1",
      expect.any(Function),
    );
    // Guards against reverting to the plain, brand-scoped query() helper.
    expect(db.query).not.toHaveBeenCalled();
  });

  test("count and page queries filter on user_id only, never on business", async () => {
    await repo.myFeed({ user_id: "u-1" });

    const [countSql, countParams] = mockClientQuery.mock.calls[0];
    const [pageSql, pageParams] = mockClientQuery.mock.calls[1];

    expect(countSql).toMatch(/WHERE\s+user_id\s*=\s*\$1/i);
    expect(pageSql).toMatch(/WHERE\s+user_id\s*=\s*\$1/i);

    // The exact anti-pattern that shipped the bug (twice) must never come back.
    expect(countSql).not.toMatch(/business/i);
    expect(pageSql).not.toMatch(/business/i);

    expect(countParams[0]).toBe("u-1");
    expect(pageParams[0]).toBe("u-1");
  });
});
