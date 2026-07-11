"use strict";

/**
 * Chief of Staff follow-up state machine (cos.followups.service.js).
 * Pure helpers + the respond → reason → act transitions. Repo, executor,
 * plan machinery, governance and notifications are mocked (no DB/HTTP).
 */

jest.mock("../../../src/modules/chief_of_staff/cos.accountability.repo");
jest.mock("../../../src/modules/chief_of_staff/cos.repo");
jest.mock("../../../src/modules/chief_of_staff/cos.plan-executor", () => ({
  confirmPlan: jest.fn(),
}));
jest.mock("../../../src/modules/praxis_ai/praxis.executor", () => ({
  executeAction: jest.fn(),
}));
jest.mock("../../../src/modules/praxis_ai/praxis.repo");
jest.mock("../../../src/shared/goals/goals.repo");
jest.mock("../../../src/modules/ai_governance/governance.service");
jest.mock("../../../src/services/notifications.service", () => ({ notify: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({}),
}));

const repo = require("../../../src/modules/chief_of_staff/cos.accountability.repo");
const cosRepo = require("../../../src/modules/chief_of_staff/cos.repo");
const planExecutor = require("../../../src/modules/chief_of_staff/cos.plan-executor");
const executor = require("../../../src/modules/praxis_ai/praxis.executor");
const praxisRepo = require("../../../src/modules/praxis_ai/praxis.repo");
const governance = require("../../../src/modules/ai_governance/governance.service");
const svc = require("../../../src/modules/chief_of_staff/cos.followups.service");

const USER = { user_id: "u1", is_ceo: true };
const CTX = { user: USER, brand: "pixiegirl", request_id: "r1", auth_header: "Bearer x" };

beforeEach(() => {
  jest.clearAllMocks();
  // updateFollowup echoes the merged row so assertions can read state/answer.
  repo.updateFollowup.mockImplementation(async ({ id, fields = {} }) => ({
    followup_id: id,
    ...fields,
  }));
});

describe("pure helpers", () => {
  test("addDaysDateOnly / addDaysIso shift by whole days", () => {
    expect(svc.addDaysDateOnly("2026-07-11", 7)).toBe("2026-07-18");
    expect(svc.addDaysIso("2026-07-11T15:00:00.000Z", 7)).toBe(
      "2026-07-18T15:00:00.000Z",
    );
  });

  test("buildSuggestions offers reschedule only for goal/milestone", () => {
    const taskKinds = svc.buildSuggestions({ subject_type: "task" }).map((s) => s.kind);
    const goalKinds = svc.buildSuggestions({ subject_type: "goal" }).map((s) => s.kind);
    expect(taskKinds).toEqual(["move_deadline", "notify_stakeholder"]);
    expect(goalKinds).toContain("reschedule_dependents");
  });
});

describe("respond", () => {
  test("'done' marks the subject done via the executor and resolves", async () => {
    repo.findFollowupForUser.mockResolvedValue({
      followup_id: "f1",
      state: "asked",
      subject_type: "task",
      subject_id: "t1",
    });
    executor.executeAction.mockResolvedValue({ ok: true, result: { data: {} } });

    const out = await svc.respond({ ...CTX, id: "f1", answer: "done" });

    const call = executor.executeAction.mock.calls[0][0];
    expect(call.pending.route).toBe("/api/v1/tasks/:id/status");
    expect(call.pending.payload).toEqual({ id: "t1", status: "done" });
    expect(out.followup.state).toBe("resolved");
    expect(out.followup.answer).toBe("done");
  });

  test("'delayed' asks why and does not touch the subject", async () => {
    repo.findFollowupForUser.mockResolvedValue({
      followup_id: "f1",
      state: "asked",
      subject_type: "task",
      subject_id: "t1",
    });

    const out = await svc.respond({ ...CTX, id: "f1", answer: "delayed" });

    expect(executor.executeAction).not.toHaveBeenCalled();
    expect(out.followup.state).toBe("answered");
    expect(out.question).toBe("What caused the delay?");
  });

  test("rejects an answer on an already-resolved follow-up", async () => {
    repo.findFollowupForUser.mockResolvedValue({ followup_id: "f1", state: "resolved" });
    await expect(svc.respond({ ...CTX, id: "f1", answer: "done" })).rejects.toThrow();
  });
});

describe("reason", () => {
  test("captures the reason and returns suggestions", async () => {
    repo.findFollowupForUser.mockResolvedValue({
      followup_id: "f1",
      state: "answered",
      answer: "delayed",
      subject_type: "milestone",
      subject_id: "m1",
    });

    const out = await svc.reason({ ...CTX, id: "f1", reason: "Supplier slipped" });

    expect(out.suggested_actions.map((s) => s.kind)).toContain("reschedule_dependents");
    expect(repo.updateFollowup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "f1",
        fields: expect.objectContaining({ reason: "Supplier slipped" }),
      }),
    );
  });
});

describe("act", () => {
  const answeredGoal = {
    followup_id: "f1",
    state: "answered",
    answer: "delayed",
    subject_type: "goal",
    subject_id: "g1",
    suggested_actions: [
      { kind: "move_deadline", payload: { days: 7 } },
      { kind: "reschedule_dependents", payload: { days: 7 } },
    ],
  };

  test("move_deadline shifts the goal target via the executor and resolves", async () => {
    repo.findFollowupForUser.mockResolvedValue(answeredGoal);
    require("../../../src/shared/goals/goals.repo").findGoal.mockResolvedValue({
      goal_id: "g1",
      target_date: "2026-07-11",
    });
    executor.executeAction.mockResolvedValue({ ok: true, result: { data: {} } });

    const out = await svc.act({
      ...CTX,
      id: "f1",
      action: { kind: "move_deadline", payload: { days: 7 } },
    });

    const call = executor.executeAction.mock.calls[0][0];
    expect(call.pending.route).toBe("/api/v1/goals/:id");
    expect(call.pending.payload).toEqual({ id: "g1", target_date: "2026-07-18" });
    expect(out.followup.state).toBe("resolved");
  });

  test("reschedule_dependents builds + runs a batch re-plan", async () => {
    repo.findFollowupForUser.mockResolvedValue(answeredGoal);
    governance.listActions.mockResolvedValue([
      { action_key: "workspace.update_milestone", action_id: "a1", method: "PATCH", route: "/api/v1/goals/:id/milestones/:mid" },
      { action_key: "workspace.update_task", action_id: "a2", method: "PATCH", route: "/api/v1/tasks/:id" },
    ]);
    repo.openMilestones.mockResolvedValue([
      { milestone_id: "m1", title: "M", target_date: "2026-07-20" },
    ]);
    repo.openGoalTasks.mockResolvedValue([
      { task_id: "t2", title: "T", due_at: "2026-07-21T10:00:00.000Z" },
    ]);
    praxisRepo.listConversations.mockResolvedValue([]);
    praxisRepo.createConversation.mockResolvedValue({ conversation_id: "c1" });
    cosRepo.createPlan.mockResolvedValue({ plan_id: "plan-x" });
    cosRepo.createPlanStep.mockResolvedValue({});
    planExecutor.confirmPlan.mockResolvedValue({ plan_id: "plan-x", status: "executed" });

    const out = await svc.act({
      ...CTX,
      id: "f1",
      action: { kind: "reschedule_dependents", payload: { days: 7 } },
    });

    // Two steps built (one milestone + one task), then the plan is executed.
    expect(cosRepo.createPlanStep).toHaveBeenCalledTimes(2);
    expect(planExecutor.confirmPlan).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plan-x" }),
    );
    expect(out.plan).toEqual({ plan_id: "plan-x", status: "executed" });
    expect(out.followup.state).toBe("resolved");
  });

  test("rejects a suggestion that wasn't offered", async () => {
    repo.findFollowupForUser.mockResolvedValue({
      ...answeredGoal,
      suggested_actions: [{ kind: "move_deadline", payload: { days: 7 } }],
    });
    await expect(
      svc.act({ ...CTX, id: "f1", action: { kind: "reschedule_dependents" } }),
    ).rejects.toThrow();
  });
});
