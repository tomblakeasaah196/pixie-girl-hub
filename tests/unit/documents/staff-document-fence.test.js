/**
 * The Documents module must not be a back door into HR.
 *
 * Employee documents (contracts, NIN slips, passport photographs) live in
 * shared.documents like every other file, but the `documents` permission is
 * granted far more widely than `hr_payroll` — so the module has to refuse
 * them even when handed a valid id. "Not found" rather than "forbidden", so
 * probing an id tells the caller nothing about who works here.
 */

"use strict";

jest.mock("../../../src/shared/documents/documents.repo");
jest.mock("../../../src/services/storage.service");
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/shared/documents/documents.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn((fn) => fn({ query: jest.fn() })),
  query: jest.fn(),
  ex: () => jest.fn(),
}));

const repo = require("../../../src/shared/documents/documents.repo");
const storage = require("../../../src/services/storage.service");
const service = require("../../../src/shared/documents/documents.service");
const { NotFoundError } = require("../../../src/utils/errors");

const BRAND = "faitlynhair";
const DOC_ID = "22222222-2222-2222-2222-222222222222";
const USER = { user_id: "33333333-3333-3333-3333-333333333333" };

const staffDoc = {
  document_id: DOC_ID,
  document_number: "DOC-0001",
  business: BRAND,
  document_type: "nin",
  title: "NIN Slip",
  file_path: "faitlynhair/documents/DOC-0001.pdf",
  mime_type: "application/pdf",
  reference_type: "staff_profile",
  reference_id: "11111111-1111-1111-1111-111111111111",
  is_deleted: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  repo.HR_ONLY_REFERENCE = "staff_profile";
});

test("getById refuses an employee document", async () => {
  repo.findById.mockResolvedValue(staffDoc);
  await expect(service.getById({ brand: BRAND, id: DOC_ID })).rejects.toThrow(
    NotFoundError,
  );
});

test("download refuses an employee document without touching storage", async () => {
  repo.findById.mockResolvedValue(staffDoc);
  await expect(service.download({ brand: BRAND, id: DOC_ID })).rejects.toThrow(
    NotFoundError,
  );
  expect(storage.get).not.toHaveBeenCalled();
});

test("remove refuses an employee document — HR owns that lifecycle", async () => {
  repo.findById.mockResolvedValue(staffDoc);
  await expect(
    service.remove({ brand: BRAND, user: USER, id: DOC_ID }),
  ).rejects.toThrow(NotFoundError);
  expect(repo.softDelete).not.toHaveBeenCalled();
});

test("listForReference refuses the staff_profile reference type outright", () => {
  expect(() =>
    service.listForReference({
      brand: BRAND,
      reference_type: "staff_profile",
      reference_id: "11111111-1111-1111-1111-111111111111",
    }),
  ).toThrow(NotFoundError);
  expect(repo.listByReference).not.toHaveBeenCalled();
});

test("an ordinary document is still served normally", async () => {
  const invoice = { ...staffDoc, reference_type: "invoice", document_type: "invoice" };
  repo.findById.mockResolvedValue(invoice);
  repo.attachTags.mockResolvedValue(undefined);
  storage.get.mockResolvedValue(Buffer.from("pdf"));

  await expect(service.getById({ brand: BRAND, id: DOC_ID })).resolves.toMatchObject({
    document_id: DOC_ID,
  });
  await expect(service.download({ brand: BRAND, id: DOC_ID })).resolves.toMatchObject({
    mime_type: "application/pdf",
  });
});
