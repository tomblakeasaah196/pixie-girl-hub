"use strict";

// Guards two independent bugs that both made "My activity" show "No activity
// yet" even when shared.audit_log genuinely had rows for the caller.
//
// Bug 1 (data reachability): myFeed's WHERE clause used to key on
// `business = $1` (the caller's active X-Brand-Context brand). That never
// matches business='system' (written for pre-brand events — login, logout,
// email verification — since shared.audit_log.business is NOT NULL and no
// brand is selected yet), nor any *other* brand the user acted under. Even
// after widening the WHERE clause, shared.audit_log has RLS enabled with the
// standard per-business policy (migration 000200): when RLS_READ_ENFORCE is
// on and a request has an ambient brand, a plain query() sets
// app.current_business to that brand, and Postgres re-filters underneath any
// WHERE clause the app writes — silently undoing a WHERE-clause-only fix.
// The real fix routes myFeed through brandTransaction(null, user_id, …):
// brand=null means the business GUC is never set, so RLS's `current_business()
// IS NULL OR …` clause passes every row through, while the query itself still
// hard-scopes to user_id — safe, since a user's own history is never someone
// else's business data.
//
// Bug 2 (envelope shape — the ACTUAL root cause of the reported symptom):
// apps/admin/src/lib/api.ts unwraps every `{ data: T }` response straight to
// `T`, *unless* it sees a sibling `meta` key, in which case it preserves the
// whole envelope (the convention every other paginated repo — stock.repo.js,
// purchasing.repo.js — already follows: `{ data, meta: { page, total, ... } }`).
// myFeed used to return page/page_size/total/window as flat siblings of
// `data` instead of nested under `meta`, so the client saw no `meta` key,
// treated it as a single-resource response, and silently discarded
// everything but the bare array. The frontend then read `feed.data.data` —
// but `feed.data` was already just the array, so `.data` on it was always
// undefined, and the UI showed "No activity yet" even with real rows sitting
// in the database and a fully correct WHERE clause. If myFeed ever goes back
// to a flat shape (page/total not nested under `meta`), this fails.

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
    .mockResolvedValueOnce({ rows: [{ total: 2 }] })
    .mockResolvedValueOnce({
      rows: [{ log_id: "a", occurred_at: new Date().toISOString() }],
    });
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

describe("audit.repo.myFeed — response envelope matches the app-wide {data, meta} convention", () => {
  test("pagination fields are nested under meta, not flat siblings of data", async () => {
    const result = await repo.myFeed({ user_id: "u-1", page: 1, page_size: 10 });

    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("meta");
    expect(result.meta).toEqual(
      expect.objectContaining({
        page: 1,
        page_size: 10,
        total: 2,
        has_more: expect.any(Boolean),
        window: expect.stringMatching(/^(24h|all_time)$/),
      }),
    );

    // The exact anti-pattern that broke apps/admin/src/lib/api.ts's envelope
    // detection: page/page_size/total/window must never sit at the top level.
    expect(result).not.toHaveProperty("page");
    expect(result).not.toHaveProperty("page_size");
    expect(result).not.toHaveProperty("total");
    expect(result).not.toHaveProperty("window");
  });

  test("the zero-limit early-return path also nests under meta", async () => {
    // page beyond max_total ⇒ limit computes to 0 ⇒ takes the early-return
    // branch that never touches the DB — must match the same envelope shape.
    const result = await repo.myFeed({
      user_id: "u-1",
      page: 10,
      page_size: 10,
      max_total: 30,
    });

    expect(db.brandTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: [],
      meta: {
        window: "all_time",
        page: 10,
        page_size: 10,
        total: 30,
        has_more: false,
      },
    });
  });
});
