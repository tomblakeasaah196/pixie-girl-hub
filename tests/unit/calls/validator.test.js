"use strict";

/**
 * Unit tests for the calls Zod schemas.
 */

const { schemas, OUTCOMES } = require("../../../src/modules/calls/calls.validator");

describe("calls validators", () => {
  describe("acceptCall", () => {
    test("accepts a realistic SDP answer", () => {
      const sdp = "v=0\r\no=- 20518 0 IN IP4 0.0.0.0\r\ns=-\r\nm=audio 54400 RTP/SAVPF 111";
      expect(schemas.acceptCall.parse({ sdp })).toEqual({ sdp });
    });

    test("rejects a missing/short sdp and unknown keys", () => {
      expect(() => schemas.acceptCall.parse({})).toThrow();
      expect(() => schemas.acceptCall.parse({ sdp: "v=0" })).toThrow();
      expect(() =>
        schemas.acceptCall.parse({ sdp: "v=0 something long enough", extra: 1 }),
      ).toThrow();
    });

    test("caps runaway payloads", () => {
      expect(() =>
        schemas.acceptCall.parse({ sdp: "x".repeat(200_001) }),
      ).toThrow();
    });
  });

  describe("recordOutcome", () => {
    test("accepts every catalogued outcome, with and without notes", () => {
      for (const outcome of OUTCOMES) {
        expect(schemas.recordOutcome.parse({ outcome })).toEqual({ outcome });
      }
      expect(
        schemas.recordOutcome.parse({
          outcome: "deal_closed",
          notes: "Closed on the 24-inch bundle",
        }),
      ).toMatchObject({ outcome: "deal_closed" });
    });

    test("rejects unknown outcomes, oversize notes and stray keys", () => {
      expect(() =>
        schemas.recordOutcome.parse({ outcome: "not_a_thing" }),
      ).toThrow();
      expect(() =>
        schemas.recordOutcome.parse({
          outcome: "other",
          notes: "x".repeat(2001),
        }),
      ).toThrow();
      expect(() =>
        schemas.recordOutcome.parse({ outcome: "other", is_admin: true }),
      ).toThrow();
    });
  });
});
