"use strict";

// Guards the "My activity" feed against silently hiding a user's own
// pre-brand-context events (login, logout, email verification).
//
// Background: shared.audit_log.business is NOT NULL, so the audit() helper
// (src/middleware/audit.js) writes business='system' for anything that
// happens before a brand is selected — most importantly login/logout
// (src/shared/hr_payroll/auth.service.js). myFeed's WHERE clause used to key
// on `business = $1` (the caller's active X-Brand-Context brand, e.g.
// 'pixiegirl'), which never equals 'system' — so a freshly provisioned
// CEO/Owner account whose only audit history was logging in saw "No activity
// yet" even though shared.audit_log already had rows for them. The fix widens
// the filter to `business IN ($1, 'system')`. If anyone reverts to a bare
// `business = $1`, this fails.

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(),
}));

const db = require("../../../src/config/database");
const repo = require("../../../src/shared/audit/audit.repo");

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ rows: [{ total: 0 }] });
});

describe("audit.repo.myFeed — includes the user's own system-level rows", () => {
  test("count and page queries key on business IN ($1, 'system'), never a bare business = $1", async () => {
    await repo.myFeed({ brand: "pixiegirl", user_id: "u-1" });

    const [countSql, countParams] = db.query.mock.calls[0];
    const [pageSql, pageParams] = db.query.mock.calls[1];

    const inSystem = /business\s+IN\s*\(\s*\$1\s*,\s*'system'\s*\)/i;
    expect(countSql).toMatch(inSystem);
    expect(pageSql).toMatch(inSystem);

    // The exact anti-pattern that shipped the bug must never come back.
    expect(countSql).not.toMatch(/business\s*=\s*\$1(?!\s*,)/i);
    expect(pageSql).not.toMatch(/business\s*=\s*\$1(?!\s*,)/i);

    expect(countParams[0]).toBe("pixiegirl");
    expect(pageParams[0]).toBe("pixiegirl");
  });
});
