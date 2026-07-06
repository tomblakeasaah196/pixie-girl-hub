"use strict";

/**
 * Signature verification contract (signer page).
 *
 * Locks in the two invariants the public verify page depends on:
 *   1. The verification code shown on a signed document is a stable, short,
 *      human-readable projection of the full audit hash.
 *   2. The integrity hash binds signer + document + signature image + time, so
 *      recomputing it detects any tampering with those fields.
 */

const {
  codeFromHash,
  signatureHash,
} = require("../../../src/shared/documents/documents.esign.service");

describe("e-signature verification helpers", () => {
  describe("codeFromHash", () => {
    const hash =
      "a4f8e2c91b3d7056fa29e41c8b5d037f6a0011223344556677889900aabbccdd";

    it("formats as three uppercase 4-char groups", () => {
      expect(codeFromHash(hash)).toBe("A4F8-E2C9-1B3D");
      expect(codeFromHash(hash)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    });

    it("is deterministic for the same hash", () => {
      expect(codeFromHash(hash)).toBe(codeFromHash(hash));
    });

    it("derives only from the first 12 hex chars", () => {
      const other = "a4f8e2c91b3d" + "ffffffffffffffffffffffffffffffff";
      expect(codeFromHash(other)).toBe(codeFromHash(hash));
    });
  });

  describe("signatureHash", () => {
    const base = {
      signer_id: "11111111-1111-1111-1111-111111111111",
      document_id: "22222222-2222-2222-2222-222222222222",
      signature: "data:image/png;base64,AAAA",
      signed_at: "2026-07-05T09:42:17.123Z",
    };

    it("recomputes identically for the same inputs (verify = intact)", () => {
      expect(signatureHash(base)).toBe(signatureHash({ ...base }));
    });

    it("is a 64-char hex sha256", () => {
      expect(signatureHash(base)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("changes when the signature image is tampered with", () => {
      const tampered = { ...base, signature: "data:image/png;base64,BBBB" };
      expect(signatureHash(tampered)).not.toBe(signatureHash(base));
    });

    it("changes when the signer, document, or timestamp changes", () => {
      const h = signatureHash(base);
      expect(signatureHash({ ...base, signer_id: "x" })).not.toBe(h);
      expect(signatureHash({ ...base, document_id: "y" })).not.toBe(h);
      expect(signatureHash({ ...base, signed_at: "2026-07-05T09:42:18.000Z" })).not.toBe(h);
    });

    it("the verification code follows from the hash", () => {
      expect(codeFromHash(signatureHash(base))).toMatch(
        /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/,
      );
    });
  });
});
