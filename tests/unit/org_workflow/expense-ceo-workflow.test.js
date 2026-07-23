"use strict";

// Locks in the "CEO approves all expenses" route (§6.7). The prior two-tier
// manager/CEO split silently 403'd any approver who wasn't the CEO or a literal
// `manager`-role holder — so Reject/Approve appeared to do nothing. The seeded
// route is now a single unconditional CEO stage that applies to every amount.

const defaults = require("../../../src/workflows/default-definitions");
const cond = require("../../../src/workflows/conditions");

const spec = defaults.getSpec("expenses", "submit");

describe("expenses:submit workflow — CEO approves all", () => {
  test("has exactly one stage, approved by the CEO", () => {
    const stages = spec.definition.stages;
    expect(stages).toHaveLength(1);
    expect(stages[0].approvers).toEqual([{ type: "role", value: "ceo" }]);
  });

  test("the single stage is unconditional (no amount threshold)", () => {
    const stage = spec.definition.stages[0];
    expect(stage.threshold_ngn_lte).toBeUndefined();
    expect(stage.threshold_ngn_gt).toBeUndefined();
    expect(cond.stageCondition(stage)).toBeNull();
  });

  test.each([0, 50_000, 200_000, 1_125_000, 9_000_000])(
    "every amount (₦%d) routes to the CEO stage",
    (amount) => {
      const first = cond.firstApplicableStage(spec.definition, {
        total_ngn: amount,
      });
      expect(first).not.toBeNull();
      expect(first.order).toBe(1);
      expect(first.approvers[0].value).toBe("ceo");
      // No further stage exists — one CEO decision completes the route.
      expect(
        cond.nextApplicableStage(spec.definition, { total_ngn: amount }, 1),
      ).toBeNull();
    },
  );
});
