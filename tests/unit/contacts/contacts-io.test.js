"use strict";

/**
 * Contacts bulk import/export engine. The DB-touching deps (repo + service)
 * are mocked so the module loads without a database, but the CSV engine
 * (spreadsheet.service) and the Zod validators are REAL — we build a template,
 * parse it back, map rows to validated inputs, and drive a full import.
 */

jest.mock("../../../src/shared/contacts/contacts.repo", () => ({
  findByPhone: jest.fn(),
  addContactTypes: jest.fn(),
  exportRows: jest.fn(),
}));
jest.mock("../../../src/shared/contacts/contacts.service", () => ({
  create: jest.fn(),
  addAddress: jest.fn(),
}));

const repo = require("../../../src/shared/contacts/contacts.repo");
const service = require("../../../src/shared/contacts/contacts.service");
const io = require("../../../src/shared/contacts/contacts-io.service");
const {
  buildCsv,
  parseCsv,
  parseUpload,
} = require("../../../src/services/spreadsheet.service");

beforeEach(() => jest.clearAllMocks());

describe("CSV engine (RFC 4180 round-trip)", () => {
  test("build → parse preserves commas, quotes and newlines", () => {
    const columns = [
      { header: "Name", key: "name" },
      { header: "Note", key: "note" },
    ];
    const rows = [
      { name: "Okafor, Adaeze", note: 'She said "hi"' },
      { name: "Line\nBreak", note: "" },
    ];
    const buf = buildCsv({ columns, rows });
    expect(buf[0]).toBe(0xef); // UTF-8 BOM so Excel reads it correctly
    const parsed = parseCsv(buf);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].Name).toBe("Okafor, Adaeze");
    expect(parsed[0].Note).toBe('She said "hi"');
    expect(parsed[1].Name).toBe("Line\nBreak");
  });

  test("blank lines are skipped", () => {
    const parsed = parseCsv("A,B\r\n1,2\r\n\r\n3,4\r\n");
    expect(parsed).toHaveLength(2);
  });

  test("parseUpload treats a CSV buffer as CSV (not xlsx)", async () => {
    const buf = buildCsv({
      columns: [{ header: "Display Name*", key: "display_name" }],
      rows: [{ display_name: "Test" }],
    });
    const rows = await parseUpload({ buffer: buf, filename: "x.csv" });
    expect(rows).toEqual([{ "Display Name*": "Test" }]);
  });
});

describe("templates", () => {
  test("clients template has the personal columns + one sample row", () => {
    const rows = parseCsv(io.template({ kind: "clients" }));
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r["Display Name*"]).toBe("Adaeze Okafor");
    expect(r["Primary Phone*"]).toBe("+2348012345678");
    expect(r).toHaveProperty("Date of Birth");
    expect(r).toHaveProperty("Instagram Handle");
    // Supplier-only columns are absent from the clients template.
    expect(r).not.toHaveProperty("TIN");
    expect(r).not.toHaveProperty("CAC Number");
  });

  test("suppliers template carries TIN/CAC and drops personal-only columns", () => {
    const rows = parseCsv(io.template({ kind: "suppliers" }));
    const r = rows[0];
    expect(r["Display Name*"]).toBe("Golden Hair Imports Ltd");
    expect(r).toHaveProperty("TIN");
    expect(r).toHaveProperty("CAC Number");
    expect(r).not.toHaveProperty("Date of Birth");
    expect(r).not.toHaveProperty("Instagram Handle");
  });

  test("an unknown kind falls back to the clients template", () => {
    const rows = parseCsv(io.template({ kind: "whatever" }));
    expect(rows[0]["Display Name*"]).toBe("Adaeze Okafor");
  });
});

describe("rowToInputs (header → validated input)", () => {
  test("clients: normalises gender/date/priority and builds a default address", () => {
    const { contact, address } = io.rowToInputs(
      {
        "Display Name*": "Test User",
        "Primary Phone*": "+2348012345678",
        Email: "t@example.com",
        Gender: "female",
        "Date of Birth": "1990-01-01T00:00:00.000Z", // Excel hands us full ISO
        Priority: "VIP",
        "Instagram Handle": "@test.user",
        "Address Line 1": "1 Test Road",
        City: "Lagos",
      },
      "clients",
    );
    expect(contact.contact_type).toEqual(["customer"]);
    expect(contact.gender).toBe("F");
    expect(contact.date_of_birth).toBe("1990-01-01");
    expect(contact.priority_level).toBe("vip");
    expect(contact.instagram_handle).toBe("test.user"); // '@' stripped by Zod
    expect(address).not.toBeNull();
    expect(address.line1).toBe("1 Test Road");
    expect(address.address_type).toBe("delivery");
    expect(address.is_default).toBe(true);
  });

  test("suppliers: type is 'supplier' and TIN/CAC map through", () => {
    const { contact, address } = io.rowToInputs(
      {
        "Display Name*": "Acme Hair Ltd",
        "Primary Phone*": "+2348098765432",
        TIN: "12345678-0001",
        "CAC Number": "RC123456",
      },
      "suppliers",
    );
    expect(contact.contact_type).toEqual(["supplier"]);
    expect(contact.tin).toBe("12345678-0001");
    expect(contact.cac_number).toBe("RC123456");
    expect(address).toBeNull(); // no Address Line 1 → no address
  });

  test("a row missing the required fields throws (reported per-row on import)", () => {
    expect(() => io.rowToInputs({ Email: "x@y.com" }, "clients")).toThrow();
  });

  test("unknown columns are ignored, never fatal", () => {
    const { contact } = io.rowToInputs(
      {
        "Display Name*": "Test User",
        "Primary Phone*": "+2348012345678",
        "Mystery Column": "ignore me",
      },
      "clients",
    );
    expect(contact.display_name).toBe("Test User");
  });
});

describe("importContacts", () => {
  const opts = (buffer) => ({
    brand: "pixiegirl",
    user: { user_id: "u1" },
    request_id: "r1",
    kind: "clients",
    buffer,
    filename: "clients.csv",
  });

  test("creates new contacts and reports a per-row summary", async () => {
    repo.findByPhone.mockResolvedValue(null);
    service.create.mockResolvedValue({
      contact_id: "c1",
      display_name: "Test User",
    });
    service.addAddress.mockResolvedValue({});

    const csv = buildCsv({
      columns: [
        { header: "Display Name*", key: "display_name" },
        { header: "Primary Phone*", key: "primary_phone" },
        { header: "Address Line 1", key: "line1" },
      ],
      rows: [
        {
          display_name: "Test User",
          primary_phone: "+2348012345678",
          line1: "1 Test Road",
        },
      ],
    });

    const res = await io.importContacts(opts(csv));
    expect(res.created).toBe(1);
    expect(res.duplicates).toBe(0);
    expect(res.total).toBe(1);
    expect(res.results[0].status).toBe("created");
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.addAddress).toHaveBeenCalledTimes(1); // address line present
  });

  test("an existing phone is a duplicate — union the type, never recreate", async () => {
    repo.findByPhone.mockResolvedValue({
      contact_id: "e1",
      display_name: "Existing Person",
    });
    repo.addContactTypes.mockResolvedValue(true);

    const csv = buildCsv({
      columns: [
        { header: "Display Name*", key: "display_name" },
        { header: "Primary Phone*", key: "primary_phone" },
      ],
      rows: [{ display_name: "Dupe", primary_phone: "+2348012345678" }],
    });

    const res = await io.importContacts(opts(csv));
    expect(res.created).toBe(0);
    expect(res.duplicates).toBe(1);
    expect(res.results[0].status).toBe("duplicate");
    expect(service.create).not.toHaveBeenCalled();
    expect(repo.addContactTypes).toHaveBeenCalledWith({
      id: "e1",
      types: ["customer"],
    });
  });

  test("an invalid row is reported as an error and does not stop the batch", async () => {
    repo.findByPhone.mockResolvedValue(null);
    service.create.mockResolvedValue({
      contact_id: "c2",
      display_name: "Good",
    });

    // Row 1 has no phone (invalid); row 2 is fine.
    const csv = buildCsv({
      columns: [
        { header: "Display Name*", key: "display_name" },
        { header: "Primary Phone*", key: "primary_phone" },
      ],
      rows: [
        { display_name: "No Phone", primary_phone: "" },
        { display_name: "Good", primary_phone: "+2348011112222" },
      ],
    });

    const res = await io.importContacts(opts(csv));
    expect(res.total).toBe(2);
    expect(res.created).toBe(1);
    const statuses = res.results.map((r) => r.status);
    expect(statuses).toContain("error");
    expect(statuses).toContain("created");
  });
});

describe("export helpers", () => {
  test("normaliseKind maps singular/plural and 'all'", () => {
    expect(io.normaliseKind("client")).toBe("clients");
    expect(io.normaliseKind("suppliers")).toBe("suppliers");
    expect(io.normaliseKind("all")).toBe("all");
    expect(io.normaliseKind(undefined)).toBe("clients");
  });

  test("exportContacts asks the repo for the right type + flattens rows", async () => {
    repo.exportRows.mockResolvedValue([
      {
        display_name: "Acme Ltd",
        contact_type: ["supplier"],
        primary_phone: "+2348098765432",
        created_at: "2026-03-01T10:00:00.000Z",
      },
    ]);
    const buf = await io.exportContacts({
      kind: "suppliers",
      from: "2026-01-01",
      to: "2026-06-01",
    });
    expect(repo.exportRows).toHaveBeenCalledWith({
      type: "supplier",
      from: "2026-01-01",
      to: "2026-06-01",
    });
    const rows = parseCsv(buf);
    expect(rows[0]["Display Name"]).toBe("Acme Ltd");
    expect(rows[0]["Contact Type"]).toBe("supplier");
    expect(rows[0]["Created At"]).toBe("2026-03-01");
  });

  test("exportFilename encodes the kind + period", () => {
    expect(
      io.exportFilename({
        kind: "clients",
        from: "2026-01-01",
        to: "2026-06-01",
      }),
    ).toBe("clients-2026-01-01_2026-06-01.csv");
    expect(io.exportFilename({ kind: "all" })).toBe("contacts.csv");
  });
});
