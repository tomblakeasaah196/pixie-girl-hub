"use strict";

/**
 * Contact-type visibility write-gate (contacts §6.12). A role restricted to a
 * subset of contact types must not be able to create — or re-type — a contact
 * into a type it can't see. Enforced in contacts.service before any repo write,
 * so we assert the repo is never reached when the type is out of scope.
 */

jest.mock("../../../src/shared/contacts/contacts.repo");
jest.mock("../../../src/shared/contacts/contacts.timeline.repo");
jest.mock("../../../src/shared/contacts/contacts.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn(async () => {}) }));
jest.mock("../../../src/config/database", () => ({
  // Run the transaction body immediately with a throwaway client.
  transaction: jest.fn(async (fn) => fn({})),
}));

const repo = require("../../../src/shared/contacts/contacts.repo");
const service = require("../../../src/shared/contacts/contacts.service");
const { PermissionDeniedError } = require("../../../src/utils/errors");

const user = { user_id: "00000000-0000-0000-0000-000000000001" };
const ctx = { brand: "pixiegirl", user, request_id: "req-1" };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("create — type write-gate", () => {
  test("blocks creating a type outside the role's allowed set", async () => {
    await expect(
      service.create({
        ...ctx,
        input: { display_name: "A client", contact_type: ["customer"] },
        allowedTypes: ["supplier"],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  test("allows a type within the allowed set", async () => {
    repo.create.mockResolvedValueOnce({ contact_id: "c1" });
    await service.create({
      ...ctx,
      input: { display_name: "A supplier", contact_type: ["supplier"] },
      allowedTypes: ["supplier"],
    });
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  test("unrestricted (null) lets any type through", async () => {
    repo.create.mockResolvedValueOnce({ contact_id: "c2" });
    await service.create({
      ...ctx,
      input: { display_name: "Anyone", contact_type: ["customer", "supplier"] },
      allowedTypes: null,
    });
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
});

describe("update — type write-gate", () => {
  test("blocks re-typing a visible contact into an unseen type", async () => {
    repo.findById.mockResolvedValueOnce({ contact_id: "c3", contact_type: ["supplier"] });
    await expect(
      service.update({
        ...ctx,
        id: "c3",
        patch: { contact_type: ["supplier", "customer"] },
        allowedTypes: ["supplier"],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  test("a contact the scope can't see reads as not-found before any type check", async () => {
    // repo.findById already applies the type filter → returns null for an
    // out-of-scope contact; update surfaces that as a 404, never a 403.
    repo.findById.mockResolvedValueOnce(null);
    await expect(
      service.update({
        ...ctx,
        id: "hidden",
        patch: { notes: "x" },
        allowedTypes: ["supplier"],
      }),
    ).rejects.toMatchObject({ http_status: 404, code: "NOT_FOUND" });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
