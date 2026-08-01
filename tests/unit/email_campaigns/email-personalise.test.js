/**
 * Unit tests — services/email-personalise (the shared token vocabulary both
 * mail engines render with).
 */

"use strict";

const p = require("../../../src/services/email-personalise");

describe("normaliseCustomTokens", () => {
  it("accepts a clean list and normalises casing/labels", () => {
    const out = p.normaliseCustomTokens([
      { token: "Whatsapp_Line", label: "WhatsApp line", value: "+234 800 000 0000" },
      { token: "store_hours", value: "9am – 7pm" },
    ]);
    expect(out).toEqual([
      { token: "whatsapp_line", label: "WhatsApp line", value: "+234 800 000 0000" },
      { token: "store_hours", label: "store_hours", value: "9am – 7pm" },
    ]);
  });

  it("rejects reserved names", () => {
    expect(() => p.normaliseCustomTokens([{ token: "first_name" }])).toThrow(
      /built-in/,
    );
    expect(() => p.normaliseCustomTokens([{ token: "points_balance" }])).toThrow(
      /built-in/,
    );
  });

  it("rejects bad names and duplicates", () => {
    expect(() => p.normaliseCustomTokens([{ token: "1bad" }])).toThrow(/not a valid/);
    expect(() => p.normaliseCustomTokens([{ token: "has space" }])).toThrow(/not a valid/);
    expect(() =>
      p.normaliseCustomTokens([{ token: "twice" }, { token: "twice" }]),
    ).toThrow(/twice/);
  });
});

describe("customTokenMap", () => {
  it("maps values and silently drops junk", () => {
    expect(
      p.customTokenMap([
        { token: "promo_code", value: "PIXIE10" },
        { token: "first_name", value: "nope" }, // reserved → dropped
        { token: "BAD NAME", value: "x" },
        null,
      ]),
    ).toEqual({ promo_code: "PIXIE10" });
  });
});

describe("displayTokensFromFacts", () => {
  it("formats loyalty numbers for prose", () => {
    const t = p.displayTokensFromFacts({
      points_balance: 1250,
      lifetime_points: 3400,
      tier_name: "Gold",
      order_count: 4,
      lifetime_spend: 350000,
      days_since_last_order: 12,
      days_since_signup: 230,
    });
    expect(t.points_balance).toBe("1,250");
    expect(t.lifetime_spend).toBe("₦350,000");
    expect(t.tier_name).toBe("Gold");
    expect(t.days_since_last_order).toBe("12");
  });

  it("renders missing facts as empty strings, never null/NaN", () => {
    const t = p.displayTokensFromFacts(undefined);
    for (const v of Object.values(t)) expect(v).toBe("");
    expect(p.displayTokensFromFacts({ points_balance: "abc" }).points_balance).toBe("");
  });
});
