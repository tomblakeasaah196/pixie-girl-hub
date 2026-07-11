"use strict";

/**
 * Chief of Staff planner (cos.planner.js) — cross-step token resolution and the
 * tool-call → step mapping (incl. the workspace-scope guardrail). Pure funcs;
 * cos.repo is mocked so no DB is loaded.
 */

jest.mock("../../../src/modules/chief_of_staff/cos.repo", () => ({
  createPlan: jest.fn(),
  createPlanStep: jest.fn(),
}));

const planner = require("../../../src/modules/chief_of_staff/cos.planner");

describe("resolveTokens", () => {
  it("resolves a whole-string token to the typed value (envelope-aware)", () => {
    const prior = [{ data: { goal_id: "g-1" } }];
    expect(planner.resolveTokens("{{step:0.goal_id}}", prior)).toBe("g-1");
  });

  it("resolves a token embedded in a larger string", () => {
    const prior = [{ data: { goal_id: "g-1" } }];
    expect(planner.resolveTokens("goal:{{step:0.goal_id}}!", prior)).toBe("goal:g-1!");
  });

  it("resolves inside nested objects and arrays", () => {
    const prior = [{ data: { goal_id: "g-1" } }, { data: { task_id: "t-9" } }];
    const payload = {
      id: "{{step:0.goal_id}}",
      items: [{ taskId: "{{step:1.task_id}}" }],
    };
    expect(planner.resolveTokens(payload, prior)).toEqual({
      id: "g-1",
      items: [{ taskId: "t-9" }],
    });
  });

  it("reads both the raw result and its {data:…} envelope", () => {
    expect(planner.pickField({ goal_id: "g" }, "goal_id")).toBe("g");
    expect(planner.pickField({ data: { goal_id: "g" } }, "goal_id")).toBe("g");
    expect(planner.pickField({ data: { a: { b: "c" } } }, "a.b")).toBe("c");
  });

  it("leaves an unresolvable token verbatim (caller detects it)", () => {
    const out = planner.resolveTokens({ id: "{{step:5.goal_id}}" }, []);
    expect(out.id).toBe("{{step:5.goal_id}}");
    expect(planner.hasUnresolvedTokens(out)).toBe(true);
  });

  it("hasUnresolvedTokens is false once every token resolves", () => {
    const prior = [{ data: { goal_id: "g-1" } }];
    const out = planner.resolveTokens({ id: "{{step:0.goal_id}}" }, prior);
    expect(planner.hasUnresolvedTokens(out)).toBe(false);
  });
});

describe("buildSteps (scope guardrail)", () => {
  const goalAction = {
    action_id: "a-goal",
    action_key: "workspace.create_goal",
    method: "POST",
    route: "/api/v1/goals",
    surface: "workspace",
    title: "Create a goal",
    min_confidence: 0.7,
  };
  const byName = new Map([["workspace_create_goal", goalAction]]);

  it("maps a tool call to a step with parsed JSON args", () => {
    const steps = planner.buildSteps({
      toolCalls: [
        {
          function: {
            name: "workspace_create_goal",
            arguments: '{"title":"Launch"}',
          },
        },
      ],
      byName,
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].action_key).toBe("workspace.create_goal");
    expect(steps[0].payload).toEqual({ title: "Launch" });
    expect(steps[0].route).toBe("/api/v1/goals");
  });

  it("REJECTS a tool call not in the workspace allowlist (e.g. a Praxis action)", () => {
    expect(() =>
      planner.buildSteps({
        toolCalls: [{ function: { name: "invoicing_create_invoice", arguments: "{}" } }],
        byName,
      }),
    ).toThrow("outside its workspace scope");
  });

  it("REJECTS an action whose surface is not 'workspace'", () => {
    const badByName = new Map([
      ["x", { action_key: "praxis.thing", surface: "praxis", method: "POST", route: "/x" }],
    ]);
    expect(() =>
      planner.buildSteps({
        toolCalls: [{ function: { name: "x", arguments: "{}" } }],
        byName: badByName,
      }),
    ).toThrow("Non-workspace action");
  });

  it("tolerates malformed JSON arguments (→ empty payload)", () => {
    const steps = planner.buildSteps({
      toolCalls: [{ function: { name: "workspace_create_goal", arguments: "{not json" } }],
      byName,
    });
    expect(steps[0].payload).toEqual({});
  });
});
