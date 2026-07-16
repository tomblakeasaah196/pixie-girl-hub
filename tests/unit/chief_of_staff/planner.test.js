"use strict";

/**
 * Chief of Staff planner (cos.planner.js) — cross-step token resolution and the
 * tool-call → step mapping (incl. the workspace-scope guardrail). Pure funcs;
 * cos.repo is mocked so no DB is loaded.
 */

jest.mock("../../../src/modules/chief_of_staff/cos.repo", () => ({
  createPlan: jest.fn(),
  createPlanStep: jest.fn(),
  supersedeOtherProposedPlans: jest.fn(),
}));

const repo = require("../../../src/modules/chief_of_staff/cos.repo");
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

  it("hasUnresolvedTokens is stateless across calls (no /g lastIndex leak)", () => {
    // Regression for the stateful-regex bug (§3.6): a global regex used with
    // .test() carries lastIndex, so the 2nd call could miss a real token.
    const a = { note: "a long prefix before the token {{step:0.goal_id}}" };
    const b = { id: "{{step:1.task_id}} leads the string" };
    expect(planner.hasUnresolvedTokens(a)).toBe(true);
    expect(planner.hasUnresolvedTokens(b)).toBe(true); // must NOT be false
    expect(planner.hasUnresolvedTokens(a)).toBe(true); // stable when repeated
  });

  it("referencedSteps lists the step indices a payload depends on", () => {
    expect(planner.referencedSteps({ id: "{{step:0.goal_id}}" })).toEqual([0]);
    expect(
      planner.referencedSteps({ id: "{{step:0.goal_id}}", taskId: "{{step:4.task_id}}" }),
    ).toEqual([0, 4]);
    // Nested (event participants) + de-duped + sorted.
    expect(
      planner.referencedSteps({ participants: [{ user_id: "{{step:2.user_id}}" }], x: "{{step:2.y}}" }),
    ).toEqual([2]);
    expect(planner.referencedSteps({ title: "no tokens here" })).toEqual([]);
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

describe("deriveTitleSummary", () => {
  it("titles the plan after the goal being created and digests the steps", () => {
    const { title, summary } = planner.deriveTitleSummary({
      content: "Exactly — let me lay out the **full plan** now.",
      steps: [
        { action_key: "workspace.create_goal", payload: { title: "UK Popup Pilot" } },
        { action_key: "workspace.add_milestone", payload: {} },
        { action_key: "workspace.add_milestone", payload: {} },
        { action_key: "workspace.create_task", payload: {} },
        { action_key: "workspace.create_event", payload: {} },
        { action_key: "workspace.create_note", payload: {} },
      ],
    });
    expect(title).toBe("UK Popup Pilot");
    expect(summary).toContain("6 steps");
    expect(summary).toContain("1 goal");
    expect(summary).toContain("2 milestones");
    expect(summary).toContain("1 task");
    expect(summary).toContain("1 calendar event");
    expect(summary).toContain("1 note");
    // Never the raw narration (that lives in the chat bubble above the card).
    expect(summary).not.toContain("full plan");
  });

  it("falls back to a markdown-stripped first sentence when no goal is created", () => {
    const { title } = planner.deriveTitleSummary({
      content: "**Rescheduling** your check-ins around the trip. Then we review.",
      steps: [{ action_key: "workspace.reschedule_event", payload: {} }],
    });
    expect(title).toBe("Rescheduling your check-ins around the trip");
    expect(title).not.toContain("*");
  });
});

describe("planFromCompletion (supersession + build state)", () => {
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
  const args = {
    client: null,
    byName,
    conversation: { conversation_id: "c1" },
    userMsg: { message_id: "m1" },
    user: { user_id: "u1" },
    brand: "faitlynhair",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repo.createPlan.mockResolvedValue({ plan_id: "p-new" });
    repo.createPlanStep.mockImplementation(async ({ s }) => ({ ...s, pending_id: `pd-${s.plan_step}` }));
    repo.supersedeOtherProposedPlans.mockResolvedValue(["p-old"]);
  });

  it("cancels every OTHER proposed plan in the conversation (no stale duplicates)", async () => {
    const out = await planner.planFromCompletion({
      ...args,
      completion: {
        content: "One goal.",
        tool_calls: [{ function: { name: "workspace_create_goal", arguments: '{"title":"G"}' } }],
      },
    });
    expect(repo.supersedeOtherProposedPlans).toHaveBeenCalledWith({
      client: null,
      conversation_id: "c1",
      except_plan_id: "p-new",
    });
    expect(out.superseded).toEqual(["p-old"]);
  });

  it("persists the build state (is_complete=false for a truncated plan)", async () => {
    await planner.planFromCompletion({
      ...args,
      complete: false,
      completion: {
        content: "Partial.",
        tool_calls: [{ function: { name: "workspace_create_goal", arguments: '{"title":"G"}' } }],
      },
    });
    expect(repo.createPlan.mock.calls[0][0].p.is_complete).toBe(false);
  });

  it("returns null (and supersedes nothing) for a plain chat reply", async () => {
    const out = await planner.planFromCompletion({
      ...args,
      completion: { content: "Just chatting.", tool_calls: [] },
    });
    expect(out).toBeNull();
    expect(repo.supersedeOtherProposedPlans).not.toHaveBeenCalled();
  });
});
