"use strict";

const v = require("../../../src/modules/service_jobs/service-jobs.validator");

function run(mw, body) {
  const req = { body };
  let called = false;
  let error;
  try {
    mw(req, {}, () => {
      called = true;
    });
  } catch (e) {
    error = e;
  }
  return { req, called, error };
}

const UUID = "11111111-1111-1111-1111-111111111111";

describe("Stylist Studio validators (PR2)", () => {
  describe("material log", () => {
    test("discrete needs variant_id + quantity", () => {
      expect(run(v.validateMaterialLog, { kind: "discrete" }).error).toBeDefined();
      expect(
        run(v.validateMaterialLog, { kind: "discrete", variant_id: UUID }).error,
      ).toBeDefined();
      const { called, req } = run(v.validateMaterialLog, {
        kind: "discrete",
        variant_id: UUID,
        quantity: 2,
      });
      expect(called).toBe(true);
      expect(req.body.quantity).toBe(2);
    });

    test("chemical needs only chemical_name (no per-wig measure)", () => {
      expect(run(v.validateMaterialLog, { kind: "chemical" }).error).toBeDefined();
      const { called } = run(v.validateMaterialLog, {
        kind: "chemical",
        chemical_name: "Toner 6.1",
        usage_note: "medium",
      });
      expect(called).toBe(true);
    });
  });

  describe("references (style brief)", () => {
    test("creative_freedom needs no payload", () => {
      expect(
        run(v.validateReferenceAdd, { ref_type: "creative_freedom" }).called,
      ).toBe(true);
    });
    test("video_link needs a url", () => {
      expect(
        run(v.validateReferenceAdd, { ref_type: "video_link" }).error,
      ).toBeDefined();
      expect(
        run(v.validateReferenceAdd, {
          ref_type: "video_link",
          url: "https://youtu.be/abc",
        }).called,
      ).toBe(true);
    });
    test("text reference needs a body", () => {
      expect(run(v.validateReferenceAdd, { ref_type: "text" }).error).toBeDefined();
    });
  });

  describe("qc", () => {
    test("result is required and bounded", () => {
      expect(run(v.validateQc, {}).error).toBeDefined();
      expect(run(v.validateQc, { result: "maybe" }).error).toBeDefined();
      expect(
        run(v.validateQc, { result: "pass", quality_rating: 6 }).error,
      ).toBeDefined();
      expect(
        run(v.validateQc, { result: "pass", quality_rating: 5 }).called,
      ).toBe(true);
      expect(
        run(v.validateQc, {
          result: "rework",
          quality_notes: "bangs uneven",
          reassign_to: UUID,
        }).called,
      ).toBe(true);
    });
  });

  describe("write-off", () => {
    test("requires a reason", () => {
      expect(run(v.validateWriteOff, {}).error).toBeDefined();
      expect(run(v.validateWriteOff, { reason: "lost in transit" }).called).toBe(
        true,
      );
    });
  });
});
