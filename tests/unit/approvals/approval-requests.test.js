"use strict";

/**
 * The approval spine — every module's approvals behave the same way.
 *
 * Before this, an approver was told a decision was waiting but not where
 * (notifications and tasks carried a reference but no link), and approving
 * left the task open at every tier, so approvers tidied up by hand. These
 * tests pin the two halves of the contract:
 *   requestApproval — one deep-linked task + notification per approver, once;
 *   settleApproval  — the decision closes every open task for the record.
 */

// jest.mock factories may only close over names prefixed `mock`.
const mockCreatedTasks = [];
const mockNotified = [];
const mockState = { openTasks: [], closedArgs: null };

jest.mock("../../../src/shared/tasks/tasks.repo", () => ({
  createTask: jest.fn(async ({ task }) => {
    const row = { ...task, task_id: `task-${mockCreatedTasks.length + 1}` };
    mockCreatedTasks.push(row);
    return row;
  }),
  openTasksForReference: jest.fn(async () => mockState.openTasks),
  closeTasksForReference: jest.fn(async (args) => {
    mockState.closedArgs = args;
    return mockState.openTasks.map((t) => ({
      task_id: t.task_id,
      assigned_to: t.assigned_to,
    }));
  }),
}));
jest.mock("../../../src/shared/tasks/tasks.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn(async (n) => {
    mockNotified.push(n);
    return { id: "n-1" };
  }),
}));

const {
  requestApproval,
  settleApproval,
} = require("../../../src/shared/approvals/approval-requests");
const tasksRepo = require("../../../src/shared/tasks/tasks.repo");

const BRAND = "faitlynhair";
const REF = {
  reference_type: "stock_adjustment",
  reference_id: "adj-1",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreatedTasks.length = 0;
  mockNotified.length = 0;
  mockState.openTasks = [];
  mockState.closedArgs = null;
});

describe("requestApproval", () => {
  it("gives every approver a task AND a notification that link to the record", async () => {
    const { tasks } = await requestApproval({
      brand: BRAND,
      ...REF,
      approver_user_ids: ["ceo-1", "ops-1"],
      requested_by: "clerk-1",
      title: "Approve stock write-off FLH-ADJ-0007",
      description: "Damaged in transit · -2 unit(s)",
    });

    expect(tasks).toHaveLength(2);
    expect(mockNotified).toHaveLength(2);
    // The link is what was missing: an approver was told to decide but not
    // where. Both halves carry it.
    for (const n of mockNotified) {
      expect(n.action_url).toBe("/stock?tab=adjustments&adjustment=adj-1");
    }
    expect(mockCreatedTasks.map((t) => t.assigned_to)).toEqual(["ceo-1", "ops-1"]);
    expect(mockCreatedTasks[0].reference_type).toBe("stock_adjustment");
    expect(mockCreatedTasks[0].created_by).toBe("clerk-1");
  });

  it("does not stack a second task on an approver who already holds one", async () => {
    mockState.openTasks = [{ task_id: "task-existing", assigned_to: "ceo-1" }];

    const { tasks, skipped } = await requestApproval({
      brand: BRAND,
      ...REF,
      approver_user_ids: ["ceo-1", "ops-1"],
      title: "Approve stock write-off FLH-ADJ-0007",
    });

    expect(skipped).toBe(1);
    expect(tasks.map((t) => t.assigned_to)).toEqual(["ops-1"]);
  });

  it("never lets one approver's failure deny the others", async () => {
    tasksRepo.createTask.mockImplementationOnce(async () => {
      throw new Error("db down for this one");
    });

    const { tasks } = await requestApproval({
      brand: BRAND,
      ...REF,
      approver_user_ids: ["ceo-1", "ops-1"],
      title: "Approve stock write-off FLH-ADJ-0007",
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigned_to).toBe("ops-1");
  });

  it("an unknown reference type still raises the task, just without a link", async () => {
    const { tasks } = await requestApproval({
      brand: BRAND,
      reference_type: "something_we_have_no_screen_for",
      reference_id: "x-1",
      approver_user_ids: ["ceo-1"],
      title: "Approve it",
    });

    expect(tasks).toHaveLength(1);
    expect(mockNotified[0].action_url).toBeNull();
  });
});

describe("settleApproval", () => {
  it("closes every approver's task — including the tier that never acted", async () => {
    mockState.openTasks = [
      { task_id: "t-1", assigned_to: "ceo-1" },
      { task_id: "t-2", assigned_to: "ops-1" },
    ];

    const { closed } = await settleApproval({
      brand: BRAND,
      ...REF,
      outcome: "approved",
      requester_user_id: "clerk-1",
      actor_name: "Tom-Blake A.",
    });

    expect(closed).toBe(2);
    expect(mockState.closedArgs.status).toBe("done");
  });

  it("tells the requester the outcome, with a link back", async () => {
    await settleApproval({
      brand: BRAND,
      ...REF,
      outcome: "rejected",
      requester_user_id: "clerk-1",
      actor_name: "Tom-Blake A.",
      title: "Stock adjustment FLH-ADJ-0007",
    });

    expect(mockNotified).toHaveLength(1);
    expect(mockNotified[0].user_id).toBe("clerk-1");
    expect(mockNotified[0].title).toBe("Stock adjustment FLH-ADJ-0007 was rejected");
    expect(mockNotified[0].reference_id).toBe("adj-1");
  });

  it("cancels rather than completes a withdrawn request", async () => {
    // A request that vanished was never decided — completing its tasks would
    // credit approvers with work that never happened.
    mockState.openTasks = [{ task_id: "t-1", assigned_to: "ceo-1" }];

    await settleApproval({ brand: BRAND, ...REF, outcome: "cancelled" });

    expect(mockState.closedArgs.status).toBe("cancelled");
  });

  it("stays silent when a stage hand-off names no requester", async () => {
    mockState.openTasks = [{ task_id: "t-1", assigned_to: "ceo-1" }];

    await settleApproval({
      brand: BRAND,
      ...REF,
      outcome: "approved",
      requester_user_id: null,
    });

    expect(mockNotified).toHaveLength(0);
  });
});
