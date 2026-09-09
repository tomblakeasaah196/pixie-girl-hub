/**
 * Employee documents — the fence and the filing rules.
 *
 * These files (contracts, NIN slips, passport photographs) are the most
 * sensitive the Hub holds, so the tests that matter are the ones that keep
 * them where they belong:
 *
 *   · An id from another brand, or from another employee, reads as "not
 *     found" rather than handing bytes back.
 *   · A type's upload guard is enforced server-side, not just by the file
 *     picker's `accept` attribute.
 *   · A type in use is archived rather than deleted, because shared.documents
 *     rows reference its key and are immutable.
 *   · The missing-required checklist is computed from the live catalogue.
 */

"use strict";

jest.mock("../../../src/shared/hr_payroll/staff_documents.repo");
jest.mock("../../../src/shared/hr_payroll/hr_ops.repo");
jest.mock("../../../src/shared/documents/documents.service");
jest.mock("../../../src/services/storage.service");
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/shared/hr_payroll/hr.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn((fn) => fn({ query: jest.fn() })),
  query: jest.fn(),
  ex: () => jest.fn(),
}));

const repo = require("../../../src/shared/hr_payroll/staff_documents.repo");
const hrRepo = require("../../../src/shared/hr_payroll/hr_ops.repo");
const documents = require("../../../src/shared/documents/documents.service");
const storage = require("../../../src/services/storage.service");
const { audit } = require("../../../src/middleware/audit");
const service = require("../../../src/shared/hr_payroll/staff_documents.service");
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require("../../../src/utils/errors");

const BRAND = "faitlynhair";
const PROFILE_ID = "11111111-1111-1111-1111-111111111111";
const DOC_ID = "22222222-2222-2222-2222-222222222222";
const USER = { user_id: "33333333-3333-3333-3333-333333333333" };

function type(overrides = {}) {
  return {
    type_id: "44444444-4444-4444-4444-444444444444",
    business: BRAND,
    type_key: "nin",
    label: "NIN Slip",
    is_required: true,
    accepts: "any",
    sort_order: 30,
    is_active: true,
    is_system: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.STAFF_REF = "staff_profile";
  hrRepo.profileById.mockResolvedValue({
    profile_id: PROFILE_ID,
    employee_number: "FLH-EMP-0014",
  });
});

// ── The fence ──────────────────────────────────────────────

describe("scoping", () => {
  test("uploading against a profile the brand can't see is a 404", async () => {
    hrRepo.profileById.mockResolvedValue(null);
    await expect(
      service.upload({
        brand: BRAND,
        user: USER,
        profileId: PROFILE_ID,
        buffer: Buffer.from("x"),
        filename: "nin.pdf",
        mime_type: "application/pdf",
        document_type: "nin",
      }),
    ).rejects.toThrow(NotFoundError);
    expect(documents.store).not.toHaveBeenCalled();
  });

  test("a document id belonging to another employee is not readable", async () => {
    repo.findForProfile.mockResolvedValue(null);
    await expect(
      service.fetchFile({ brand: BRAND, profileId: PROFILE_ID, documentId: DOC_ID }),
    ).rejects.toThrow(NotFoundError);
    expect(storage.get).not.toHaveBeenCalled();
  });

  test("every read of the bytes is scoped by profile, not by id alone", async () => {
    repo.findForProfile.mockResolvedValue({
      document_id: DOC_ID,
      document_number: "DOC-0001",
      file_path: "faitlynhair/documents/DOC-0001.pdf",
      mime_type: "application/pdf",
      title: "Contract",
    });
    storage.get.mockResolvedValue(Buffer.from("pdf"));

    await service.fetchFile({ brand: BRAND, profileId: PROFILE_ID, documentId: DOC_ID });

    expect(repo.findForProfile).toHaveBeenCalledWith(
      expect.objectContaining({ brand: BRAND, profileId: PROFILE_ID, documentId: DOC_ID }),
    );
  });

  test("a download is audited as a sensitive access; a preview is not", async () => {
    repo.findForProfile.mockResolvedValue({
      document_id: DOC_ID,
      document_number: "DOC-0001",
      file_path: "k",
      mime_type: "application/pdf",
      document_type: "contract",
      title: "Contract",
    });
    storage.get.mockResolvedValue(Buffer.from("pdf"));

    await service.fetchFile({
      brand: BRAND,
      profileId: PROFILE_ID,
      documentId: DOC_ID,
      mode: "preview",
      user: USER,
    });
    expect(audit).not.toHaveBeenCalled();

    await service.fetchFile({
      brand: BRAND,
      profileId: PROFILE_ID,
      documentId: DOC_ID,
      mode: "download",
      user: USER,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action_key: "hr.staff_document.download",
        is_sensitive: true,
      }),
    );
  });

  test("My HR resolves the profile from the token, never from the URL", async () => {
    hrRepo.profileForUser.mockResolvedValue({ profile_id: PROFILE_ID });
    repo.findForProfile.mockResolvedValue({
      document_id: DOC_ID,
      document_number: "DOC-1",
      file_path: "k",
      mime_type: "image/jpeg",
      title: "Passport",
    });
    storage.get.mockResolvedValue(Buffer.from("jpg"));

    await service.fetchMyFile({ brand: BRAND, user: USER, documentId: DOC_ID });

    expect(hrRepo.profileForUser).toHaveBeenCalledWith(
      expect.objectContaining({ brand: BRAND, userId: USER.user_id }),
    );
    expect(repo.findForProfile).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: PROFILE_ID }),
    );
  });
});

// ── Filing rules ───────────────────────────────────────────

describe("upload", () => {
  const upload = (over = {}) =>
    service.upload({
      brand: BRAND,
      user: USER,
      profileId: PROFILE_ID,
      buffer: Buffer.from("x"),
      filename: "file.pdf",
      mime_type: "application/pdf",
      document_type: "nin",
      ...over,
    });

  beforeEach(() => {
    documents.store.mockResolvedValue({
      document_id: DOC_ID,
      document_number: "DOC-0001",
      document_type: "nin",
      title: "NIN Slip",
      mime_type: "application/pdf",
      file_size_bytes: 1,
      created_at: "2026-09-09T00:00:00.000Z",
    });
  });

  test("a type outside the catalogue is refused", async () => {
    repo.findTypeByKey.mockResolvedValue(null);
    await expect(upload({ document_type: "made_up" })).rejects.toThrow(ValidationError);
    expect(documents.store).not.toHaveBeenCalled();
  });

  test("an archived type is refused — it is retired, not usable", async () => {
    repo.findTypeByKey.mockResolvedValue(type({ is_active: false }));
    await expect(upload()).rejects.toThrow(ValidationError);
  });

  test("an image-only type rejects a PDF", async () => {
    repo.findTypeByKey.mockResolvedValue(
      type({ type_key: "passport_photo", label: "Passport Photograph", accepts: "image" }),
    );
    await expect(
      upload({ document_type: "passport_photo", mime_type: "application/pdf" }),
    ).rejects.toThrow(/must be an image/i);
  });

  test("a PDF-only type rejects an image", async () => {
    repo.findTypeByKey.mockResolvedValue(type({ accepts: "pdf" }));
    await expect(upload({ mime_type: "image/png" })).rejects.toThrow(/must be a PDF/i);
  });

  test("anything that is neither a PDF nor an image is refused outright", async () => {
    repo.findTypeByKey.mockResolvedValue(type());
    await expect(
      upload({ mime_type: "application/zip", filename: "file.zip" }),
    ).rejects.toThrow(/PDF or an image/i);
  });

  test("files against the staff profile so the Documents module can't reach it", async () => {
    repo.findTypeByKey.mockResolvedValue(type());
    await upload();
    expect(documents.store).toHaveBeenCalledWith(
      expect.objectContaining({
        reference_type: "staff_profile",
        reference_id: PROFILE_ID,
        document_type: "nin",
      }),
    );
  });

  test("falls back to the type's label when no title is given", async () => {
    repo.findTypeByKey.mockResolvedValue(type());
    await upload({ title: "   " });
    expect(documents.store).toHaveBeenCalledWith(
      expect.objectContaining({ title: "NIN Slip" }),
    );
  });
});

// ── The checklist ──────────────────────────────────────────

describe("missing_required", () => {
  test("lists required types the employee has no document for", async () => {
    repo.listTypes.mockResolvedValue([
      type({ type_key: "contract", label: "Employment Contract", is_required: true }),
      type({ type_key: "nin", label: "NIN Slip", is_required: true }),
      type({ type_key: "cv", label: "CV", is_required: false }),
    ]);
    repo.listForProfile.mockResolvedValue([
      {
        document_id: DOC_ID,
        document_type: "contract",
        type_label: "Employment Contract",
        mime_type: "application/pdf",
        created_at: "2026-09-09T00:00:00.000Z",
      },
    ]);

    const out = await service.listForEmployee({ brand: BRAND, profileId: PROFILE_ID });

    expect(out.missing_required.map((m) => m.type_key)).toEqual(["nin"]);
  });

  test("never leaks the storage path or content hash to the client", async () => {
    repo.listTypes.mockResolvedValue([]);
    repo.listForProfile.mockResolvedValue([
      {
        document_id: DOC_ID,
        document_type: "nin",
        type_label: "NIN Slip",
        mime_type: "image/jpeg",
        file_path: "faitlynhair/documents/DOC-1.jpg",
        content_hash: "abc123",
        created_at: "2026-09-09T00:00:00.000Z",
      },
    ]);

    const out = await service.listForEmployee({ brand: BRAND, profileId: PROFILE_ID });

    expect(out.documents[0]).not.toHaveProperty("file_path");
    expect(out.documents[0]).not.toHaveProperty("content_hash");
    expect(out.documents[0].is_image).toBe(true);
  });
});

// ── The catalogue ──────────────────────────────────────────

describe("document types", () => {
  test("slugs the label into a stable key", () => {
    expect(service.slugify("Guarantor Form")).toBe("guarantor_form");
    expect(service.slugify("  N.I.N. slip ")).toBe("n_i_n_slip");
  });

  test("a duplicate live type is a conflict, not a second row", async () => {
    repo.findTypeByKey.mockResolvedValue(type({ is_active: true }));
    await expect(
      service.createType({ brand: BRAND, user: USER, input: { label: "NIN Slip" } }),
    ).rejects.toThrow(ConflictError);
    expect(repo.insertType).not.toHaveBeenCalled();
  });

  test("re-creating an archived type revives it, keeping its filed documents", async () => {
    const archived = type({ is_active: false, label: "Medical Report", type_key: "medical" });
    repo.findTypeByKey.mockResolvedValue(archived);
    repo.updateType.mockResolvedValue({ ...archived, is_active: true });

    await service.createType({
      brand: BRAND,
      user: USER,
      input: { label: "Medical Report" },
    });

    expect(repo.insertType).not.toHaveBeenCalled();
    expect(repo.updateType).toHaveBeenCalledWith(
      expect.objectContaining({
        typeId: archived.type_id,
        patch: expect.objectContaining({ is_active: true }),
      }),
    );
  });

  test("a label with nothing sluggable is rejected", async () => {
    await expect(
      service.createType({ brand: BRAND, user: USER, input: { label: "!!!" } }),
    ).rejects.toThrow(ValidationError);
  });

  test("a seeded type is archived, never deleted", async () => {
    repo.findTypeById.mockResolvedValue(type({ is_system: true }));
    repo.countDocumentsOfType.mockResolvedValue(0);
    repo.updateType.mockResolvedValue(type({ is_active: false }));

    const out = await service.removeType({ brand: BRAND, user: USER, typeId: "t1" });

    expect(out).toMatchObject({ deleted: false, archived: true });
    expect(repo.deleteType).not.toHaveBeenCalled();
  });

  test("a custom type in use is archived so filed documents keep their label", async () => {
    repo.findTypeById.mockResolvedValue(type({ is_system: false, type_key: "work_permit" }));
    repo.countDocumentsOfType.mockResolvedValue(3);
    repo.updateType.mockResolvedValue(type({ is_active: false }));

    const out = await service.removeType({ brand: BRAND, user: USER, typeId: "t1" });

    expect(out).toMatchObject({ deleted: false, archived: true, documents: 3 });
    expect(repo.deleteType).not.toHaveBeenCalled();
  });

  test("an unused custom type is deleted outright", async () => {
    repo.findTypeById.mockResolvedValue(type({ is_system: false, type_key: "work_permit" }));
    repo.countDocumentsOfType.mockResolvedValue(0);
    repo.deleteType.mockResolvedValue(true);

    const out = await service.removeType({ brand: BRAND, user: USER, typeId: "t1" });

    expect(out).toMatchObject({ deleted: true, archived: false });
    expect(repo.deleteType).toHaveBeenCalled();
  });
});
