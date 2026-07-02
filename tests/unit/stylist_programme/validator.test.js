"use strict";

/**
 * Stylist Programme v2 validators — the public application payload, vetting
 * rubric, dispute action, and programme-config patch shapes.
 */

const v = require("../../../src/modules/stylist_programme/stylist.validator");

const run = (mw, body) => {
  const req = { body };
  mw(req, null, () => {});
  return req.body;
};

describe("validatePublicApply", () => {
  const valid = {
    display_name: "Ada Styles",
    email: "ada@example.com",
    country_code: "NG",
    city: "Lagos",
    instagram_url: "https://instagram.com/adastyles",
    answers: [
      {
        question_id: "0b7f3f39-3a3f-4a51-a9ff-70cf5b0adb01",
        answer: "I love the brand",
      },
      { question_id: "0b7f3f39-3a3f-4a51-a9ff-70cf5b0adb02", answer: true },
    ],
  };

  test("accepts a complete application", () => {
    const out = run(v.validatePublicApply, valid);
    expect(out.display_name).toBe("Ada Styles");
    expect(out.answers).toHaveLength(2);
  });

  test("rejects a missing email", () => {
    const { email, ...rest } = valid;
    expect(() => run(v.validatePublicApply, rest)).toThrow();
  });

  test("rejects a bad portfolio URL", () => {
    expect(() =>
      run(v.validatePublicApply, { ...valid, portfolio_url: "not-a-url" }),
    ).toThrow();
  });
});

describe("validateVettingReview", () => {
  test("accepts a rubric with recommendation", () => {
    const out = run(v.validateVettingReview, {
      rubric: [
        { criterion: "Portfolio", score: 8, max: 10 },
        { criterion: "Brand fit", score: 9, max: 10 },
      ],
      recommendation: "advance",
    });
    expect(out.rubric).toHaveLength(2);
  });

  test("rejects an empty rubric", () => {
    expect(() =>
      run(v.validateVettingReview, { rubric: [], recommendation: "advance" }),
    ).toThrow();
  });

  test("rejects an unknown recommendation", () => {
    expect(() =>
      run(v.validateVettingReview, {
        rubric: [{ criterion: "Portfolio", score: 8, max: 10 }],
        recommendation: "maybe",
      }),
    ).toThrow();
  });
});

describe("validateDispute", () => {
  test("open with reason parses", () => {
    const out = run(v.validateDispute, { action: "open", reason: "damaged" });
    expect(out.action).toBe("open");
  });
  test("resolve with outcome parses", () => {
    const out = run(v.validateDispute, {
      action: "resolve",
      resolution: "refunded customer",
      outcome: "uphold",
    });
    expect(out.outcome).toBe("uphold");
  });
  test("unknown action rejected", () => {
    expect(() => run(v.validateDispute, { action: "escalate" })).toThrow();
  });
});

describe("validateConfigPatch", () => {
  test("accepts routing weight tuning", () => {
    const out = run(v.validateConfigPatch, {
      quality_hold_days: 10,
      routing_weights: {
        distance: 50,
        tier: 20,
        rating: 15,
        capacity: 10,
        specialty: 5,
      },
    });
    expect(out.quality_hold_days).toBe(10);
  });
  test("rejects a negative hold", () => {
    expect(() => run(v.validateConfigPatch, { quality_hold_days: -1 })).toThrow();
  });
  test("rejects unknown keys", () => {
    expect(() => run(v.validateConfigPatch, { nonsense: true })).toThrow();
  });
});

describe("portal validators", () => {
  test("payout details require sane account number", () => {
    expect(() =>
      run(v.validateMyPayoutDetails, { payout_account_number: "12" }),
    ).toThrow();
    const out = run(v.validateMyPayoutDetails, {
      payout_bank_name: "GTB",
      payout_account_number: "0123456789",
      payout_account_name: "Ada Styles",
    });
    expect(out.payout_bank_name).toBe("GTB");
  });

  test("referral link target must be a path", () => {
    expect(() =>
      run(v.validateReferralLink, { target_path: "https://evil.example" }),
    ).toThrow();
    const out = run(v.validateReferralLink, { target_path: "/shop/wigs" });
    expect(out.target_path).toBe("/shop/wigs");
  });
});
