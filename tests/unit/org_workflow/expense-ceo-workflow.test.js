"use strict";

// Locks in the executive-approval route for expenses (§6.7). The prior two-tier
// manager/CEO split silently 403'd any approver who wasn't the CEO or a literal
// `manager`-role holder — so Reject/Approve appeared to do nothing. The seeded
// route is now a single unconditional stage that applies to every amount and is
// approvable by EITHER the CEO or the Chief Operating Officer (the owner's
// delegate for expense sign-off).

const defaults = require("../../../src/workflows/default-definitions");
const cond = require("../../../src/workflows/conditions");

const spec = defaults.getSpec("expenses", "submit");

describe("expenses:submit workflow — CEO or COO approves all", () => {
  test("has exactly one stage, approvable by the CEO or the COO", () => {
    const stages = spec.definition.stages;
    expect(stages).toHaveLength(1);
    expect(stages[0].approvers).toEqual([
      { type: "role", value: "ceo" },
      { type: "role", value: "chief_operating_officer" },
    ]);
  });

  test("the single stage is unconditional (no amount threshold)", () => {
    const stage = spec.definition.stages[0];
    expect(stage.threshold_ngn_lte).toBeUndefined();
    expect(stage.threshold_ngn_gt).toBeUndefined();
    expect(cond.stageCondition(stage)).toBeNull();
  });

  test.each([0, 50_000, 200_000, 1_125_000, 9_000_000])(
    "every amount (₦%d) routes to the single executive stage",
    (amount) => {
      const first = cond.firstApplicableStage(spec.definition, {
        total_ngn: amount,
      });
      expect(first).not.toBeNull();
      expect(first.order).toBe(1);
      const approverRoles = first.approvers.map((a) => a.value);
      expect(approverRoles).toContain("ceo");
      expect(approverRoles).toContain("chief_operating_officer");
      // No further stage exists — one executive decision completes the route.
      expect(
        cond.nextApplicableStage(spec.definition, { total_ngn: amount }, 1),
      ).toBeNull();
    },
  );
});
