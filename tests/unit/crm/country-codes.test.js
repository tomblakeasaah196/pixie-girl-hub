"use strict";

/**
 * CRM country-code helpers (PURE — no DB). These guard the "filter clients by
 * country" resolution and the country_code backfill derivation.
 */

const {
  resolveCountry,
  isoFromPhone,
  matchDialCode,
} = require("../../../src/modules/crm/country-codes");

describe("resolveCountry", () => {
  test("dialing code with +", () => {
    expect(resolveCountry("+234")).toEqual({ iso: "NG", dial: "234" });
  });

  test("dialing code without +", () => {
    expect(resolveCountry("234")).toEqual({ iso: "NG", dial: "234" });
  });

  test("ISO2 (any case) resolves iso + its dial", () => {
    expect(resolveCountry("NG")).toEqual({ iso: "NG", dial: "234" });
    expect(resolveCountry("gb")).toEqual({ iso: "GB", dial: "44" });
  });

  test("longest-prefix wins (212 → Morocco, not 21)", () => {
    expect(resolveCountry("+212")).toEqual({ iso: "MA", dial: "212" });
    expect(resolveCountry("+20")).toEqual({ iso: "EG", dial: "20" });
  });

  test("a full pasted phone number resolves to its country", () => {
    expect(resolveCountry("+2348012345678")).toEqual({
      iso: "NG",
      dial: "234",
    });
  });

  test("unknown numeric code still yields a dial prefix, iso null", () => {
    expect(resolveCountry("999")).toEqual({ iso: null, dial: "999" });
  });

  test("empty / whitespace → nulls", () => {
    expect(resolveCountry("")).toEqual({ iso: null, dial: null });
    expect(resolveCountry("   ")).toEqual({ iso: null, dial: null });
  });
});

describe("isoFromPhone", () => {
  test("international + prefix maps by dialing code", () => {
    expect(isoFromPhone("+447700900123")).toBe("GB");
    expect(isoFromPhone("+1 415 555 0100")).toBe("US");
  });

  test("00 international prefix is honoured", () => {
    expect(isoFromPhone("00447700900123")).toBe("GB");
  });

  test("234… is Nigeria with or without the +", () => {
    expect(isoFromPhone("2348012345678")).toBe("NG");
    expect(isoFromPhone("+2348012345678")).toBe("NG");
  });

  test("local number assumes the given home country", () => {
    expect(isoFromPhone("08012345678", "NG")).toBe("NG");
  });

  test("local number with no home country → null", () => {
    expect(isoFromPhone("08012345678", null)).toBeNull();
  });

  test("empty phone → null", () => {
    expect(isoFromPhone("", "NG")).toBeNull();
    expect(isoFromPhone(null, "NG")).toBeNull();
  });
});

describe("matchDialCode", () => {
  test("greedy longest match", () => {
    expect(matchDialCode("2348012345678")).toBe("234");
    expect(matchDialCode("14155550100")).toBe("1");
  });

  test("no known code → null", () => {
    expect(matchDialCode("000")).toBeNull();
  });
});
