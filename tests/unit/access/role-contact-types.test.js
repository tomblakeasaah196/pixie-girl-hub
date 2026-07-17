"use strict";

/**
 * Effective contact-type visibility across a role set (contacts §6.12). The
 * union model with default-open: any role WITHOUT an access row is unrestricted
 * and widens the whole set to "sees everything"; when every role is restricted,
 * the result is the union of their allowed types.
 */

jest.mock("../../../src/config/database", () => {
  const query = jest.fn(async () => ({ rows: [] }));
  return { query, ex: (c) => (c ? c.query.bind(c) : query) };
});

const db = require("../../../src/config/database");
const roles = require("../../../src/shared/access/roles.repo");

beforeEach(() => db.query.mockClear());

describe("contactTypesForRoles", () => {
  test("empty role set → [] (no query)", async () => {
    const out = await roles.contactTypesForRoles({ role_ids: [] });
    expect(out).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  test("a role with no access row makes the whole set unrestricted (null)", async () => {
    // Two roles requested, only one has a restriction row → the other is
    // unrestricted → null.
    db.query.mockResolvedValueOnce({
      rows: [{ role_id: "r1", contact_types: ["supplier"] }],
    });
    const out = await roles.contactTypesForRoles({ role_ids: ["r1", "r2"] });
    expect(out).toBeNull();
  });

  test("every role restricted → union of their types (deduped)", async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { role_id: "r1", contact_types: ["supplier"] },
        { role_id: "r2", contact_types: ["supplier", "retail_partner"] },
      ],
    });
    const out = await roles.contactTypesForRoles({ role_ids: ["r1", "r2"] });
    expect(new Set(out)).toEqual(new Set(["supplier", "retail_partner"]));
  });

  test("every role restricted to nothing → [] (sees no contacts)", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ role_id: "r1", contact_types: [] }],
    });
    const out = await roles.contactTypesForRoles({ role_ids: ["r1"] });
    expect(out).toEqual([]);
  });
});
