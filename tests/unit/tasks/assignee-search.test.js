"use strict";

// Guards the raw SQL of the assignee search — the identity source behind the
// assignee picker AND the CoS's workspace.search_users tool (the ONLY place a
// valid `assigned_to` user_id comes from).
//
// The bug class this pins down: "tell the operations manager" resolved to
// nobody because the query matched name/email/RBAC role but never
// staff_profiles.job_title — the field the CEO actually thinks in. The search
// is now tokenised over a haystack of name + email + job title + all role
// names (any word order), job_title rides back on every row so two Samuels
// are tellable apart, and ILIKE wildcards in the query are escaped so they
// match literally. If any of that regresses, this fails.

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(),
}));

const db = require("../../../src/config/database");
const repo = require("../../../src/shared/tasks/tasks.repo");

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ rows: [] });
});

const lastSql = () => db.query.mock.calls[0][0];
const lastParams = () => db.query.mock.calls[0][1];

describe("tasks.repo.listAssignableUsers — job-title search", () => {
  test("selects job_title via a soft-delete-aware staff_profiles join", async () => {
    await repo.listAssignableUsers({ brand: "pixiegirl" });
    const sql = lastSql();

    expect(sql).toMatch(/sp\.job_title/);
    expect(sql).toMatch(
      /LEFT JOIN shared\.staff_profiles sp\s+ON sp\.profile_id = u\.staff_profile_id AND sp\.is_deleted = false/,
    );
    // Roster shape the CoS persona + disambiguation depend on.
    expect(sql).toMatch(/u\.user_id/);
    expect(sql).toMatch(/u\.email/);
    expect(sql).toMatch(/u\.is_ceo/);
    expect(sql).toMatch(/AS role_name/);
  });

  test("no search → base filters only, brand + default limit 50", async () => {
    await repo.listAssignableUsers({ brand: "pixiegirl" });
    expect(lastSql()).not.toMatch(/ILIKE/);
    expect(lastParams()).toEqual(["pixiegirl", 50]);
  });

  test("multi-word query: every token must match the haystack (any order)", async () => {
    await repo.listAssignableUsers({
      brand: "pixiegirl",
      search: "operations manager",
    });
    const sql = lastSql();
    const params = lastParams();

    // One ILIKE per token, ANDed — word order in the query can't matter.
    expect(sql.match(/ILIKE/g)).toHaveLength(2);
    expect(params).toContain("%operations%");
    expect(params).toContain("%manager%");

    // The haystack covers every way the CEO names a person.
    expect(sql).toMatch(/u\.display_name/);
    expect(sql).toMatch(/u\.email/);
    expect(sql).toMatch(/sp\.job_title/);
    expect(sql).toMatch(/string_agg\(r2\.role_name, ' '\)/);
  });

  test("escapes ILIKE wildcards so % and _ match literally", async () => {
    await repo.listAssignableUsers({ brand: "pixiegirl", search: "100%_a" });
    expect(lastParams()).toContain("%100\\%\\_a%");
  });

  test("caps runaway input: max 8 tokens, limit clamped to 100", async () => {
    await repo.listAssignableUsers({
      brand: "pixiegirl",
      search: "a b c d e f g h i j",
      limit: 5000,
    });
    expect(lastSql().match(/ILIKE/g)).toHaveLength(8);
    expect(lastParams()[lastParams().length - 1]).toBe(100);
  });

  test("whitespace-only search is a plain roster list", async () => {
    await repo.listAssignableUsers({ brand: "faitlynhair", search: "   " });
    expect(lastSql()).not.toMatch(/ILIKE/);
    expect(lastParams()).toEqual(["faitlynhair", 50]);
  });

  test("CEO ranks first so 'assign to me' grounding never scrolls away", async () => {
    await repo.listAssignableUsers({ brand: "pixiegirl" });
    expect(lastSql()).toMatch(/ORDER BY u\.is_ceo DESC/);
  });
});
