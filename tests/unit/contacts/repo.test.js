"use strict";

// Lightweight mock for the pg pool so we can assert on the SQL the repo emits
// without needing a real connection. db.query is a Jest mock; we inspect
// .mock.calls and stage results via mockResolvedValueOnce.
jest.mock("../../../src/config/database", () => ({
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
}));

const db = require("../../../src/config/database");
const repo = require("../../../src/shared/contacts/contacts.repo");

const lastCall = () => {
  const calls = db.query.mock.calls;
  return calls[calls.length - 1] || [];
};
const captured = {
  get text() {
    return lastCall()[0] ?? null;
  },
  get params() {
    return lastCall()[1] ?? null;
  },
};

const RYNNA = {
  contact_type: ["customer"],
  display_name: "Rynna Nasah",
  first_name: "Rynna",
  last_name: "Nasah",
  primary_phone: "+2349020868023",
  whatsapp_number: "+2349020868023",
  email: "blakeasaah@gmail.com",
  instagram_handle: "_saved_by__grace__",
  priority_level: "new",
  source: "instagram_dm",
  country_code: "NG",
};

beforeEach(() => {
  db.query.mockClear();
});

describe("contacts.repo.create", () => {
  test("emits an INSERT covering every supplied column incl. instagram_handle", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ contact_id: "11111111-1111-1111-1111-111111111111", ...RYNNA }],
      rowCount: 1,
    });
    const out = await repo.create({
      input: RYNNA,
      user_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(captured.text).toMatch(/^INSERT INTO shared\.contacts/);
    expect(captured.text).toContain("instagram_handle");
    expect(captured.text).toContain("display_name");
    expect(captured.text).toContain("primary_phone");
    expect(captured.text).toContain("created_by");
    // RETURNING * round-trips the row.
    expect(captured.text).toMatch(/RETURNING \*/);
    // Params: every supplied column plus created_by, in declaration order.
    // contact_type passes through as-is (TEXT[]).
    expect(captured.params).toEqual(
      expect.arrayContaining([
        "Rynna Nasah",
        "+2349020868023",
        "blakeasaah@gmail.com",
        "_saved_by__grace__",
        "00000000-0000-0000-0000-000000000001",
      ]),
    );
    expect(out.contact_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  test("skips columns that are undefined in input", async () => {
    db.query.mockResolvedValueOnce({ rows: [{}], rowCount: 1 });
    await repo.create({
      input: {
        display_name: "Tiny",
        primary_phone: "+2349000000000",
      },
      user_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(captured.text).toContain("display_name");
    expect(captured.text).toContain("primary_phone");
    // No instagram_handle because it wasn't supplied.
    expect(captured.text).not.toContain("instagram_handle");
    expect(captured.text).not.toContain("email");
  });
});

describe("contacts.repo.findAll", () => {
  test("filters by q across name/phone/email/company", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: 1 }] }) // count
      .mockResolvedValueOnce({ rows: [{ contact_id: "x" }] }); // rows
    const out = await repo.findAll({
      filters: { q: "rynna" },
      page: 1,
      page_size: 25,
      offset: 0,
    });
    expect(db.query).toHaveBeenCalledTimes(2);
    // Last call is the SELECT. Capture from mock results.
    const select = db.query.mock.calls[1][0];
    expect(select).toMatch(
      /display_name ILIKE .* OR primary_phone ILIKE .* OR email ILIKE .* OR company_name ILIKE/,
    );
    expect(db.query.mock.calls[1][1]).toEqual(
      expect.arrayContaining(["%rynna%"]),
    );
    expect(out.meta.total).toBe(1);
    expect(out.meta.has_more).toBe(false);
  });

  test("filters by contact_type via ANY()", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    await repo.findAll({
      filters: { contact_type: "customer" },
      page: 1,
      page_size: 25,
      offset: 0,
    });
    expect(db.query.mock.calls[0][0]).toMatch(/\$1 = ANY\(contact_type\)/);
    expect(db.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["customer"]),
    );
  });

  test("always scopes to non-deleted contacts", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    await repo.findAll({
      filters: {},
      page: 1,
      page_size: 25,
      offset: 0,
    });
    expect(db.query.mock.calls[0][0]).toContain("is_deleted = false");
    expect(db.query.mock.calls[1][0]).toContain("is_deleted = false");
  });

  test("returns the canonical { data, meta } shape", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: 100 }] })
      .mockResolvedValueOnce({ rows: new Array(25).fill({ contact_id: "x" }) });
    const out = await repo.findAll({
      filters: {},
      page: 1,
      page_size: 25,
      offset: 0,
    });
    expect(out).toEqual({
      data: expect.any(Array),
      meta: { page: 1, page_size: 25, total: 100, has_more: true },
    });
    expect(out.data.length).toBe(25);
  });
});

describe("contacts.repo.update", () => {
  test("builds a SET clause containing only the patched columns", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ contact_id: "x", instagram_handle: "new" }],
      rowCount: 1,
    });
    await repo.update({
      id: "11111111-1111-1111-1111-111111111111",
      patch: { instagram_handle: "new" },
    });
    expect(captured.text).toMatch(
      /^UPDATE shared\.contacts SET instagram_handle = \$1 WHERE contact_id = \$2/,
    );
    expect(captured.text).toContain("AND is_deleted = false");
    expect(captured.params).toEqual([
      "new",
      "11111111-1111-1111-1111-111111111111",
    ]);
  });

  test("returns the current row unchanged when patch is empty", async () => {
    // setClause yields no fields → repo calls findById directly. Only one query
    // is fired, and it must be the SELECT, not an empty UPDATE.
    db.query.mockResolvedValueOnce({
      rows: [{ contact_id: "x", display_name: "Rynna" }],
      rowCount: 1,
    });
    const out = await repo.update({
      id: "11111111-1111-1111-1111-111111111111",
      patch: {},
    });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/^SELECT \* FROM shared\.contacts/);
    expect(out.display_name).toBe("Rynna");
  });
});

describe("contacts.repo.softDelete", () => {
  test("flips is_deleted and stamps deleted_at", async () => {
    db.query.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await repo.softDelete({ id: "abc" });
    expect(captured.text).toMatch(
      /UPDATE shared\.contacts SET is_deleted = true, deleted_at = now\(\)/,
    );
    expect(ok).toBe(true);
  });

  test("returns false when nothing was deleted", async () => {
    db.query.mockResolvedValueOnce({ rowCount: 0 });
    const ok = await repo.softDelete({ id: "missing" });
    expect(ok).toBe(false);
  });
});
