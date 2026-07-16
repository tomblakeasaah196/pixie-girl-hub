"use strict";

/**
 * CoS pre-flight validation (cos.preflight.js) — strips hallucinated keys the
 * strict endpoint validators would reject, and surfaces review-time warnings
 * (missing required / bad enum / bad id / bad datetime), while leaving
 * unresolved {{step:N.field}} tokens alone. Pure — no I/O.
 */

const { preflight } = require("../../../src/modules/chief_of_staff/cos.preflight");

const CREATE_TASK = {
  action_key: "workspace.create_task",
  route: "/api/v1/tasks",
  payload_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      due_at: { type: "string" },
      assigned_to: { type: "string" },
      is_personal: { type: "boolean" },
      reference_type: { type: "string", enum: ["contact"] },
      reference_id: { type: "string" },
    },
    required: ["title"],
  },
};

const ADD_MILESTONE = {
  action_key: "workspace.add_milestone",
  route: "/api/v1/goals/:id/milestones",
  payload_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      target_date: { type: "string" },
    },
    required: ["id", "title"],
  },
};

const UUID = "11111111-1111-4111-8111-111111111111";

test("strips a hallucinated key the strict validator would reject", () => {
  const { payload, dropped } = preflight({
    action: CREATE_TASK,
    payload: { title: "Ship", contact_id: "abc", notes: "x" },
  });
  expect(payload).toEqual({ title: "Ship" });
  expect(dropped).toEqual(expect.arrayContaining(["contact_id", "notes"]));
});

test("warns on a missing required field", () => {
  const { note } = preflight({ action: CREATE_TASK, payload: { priority: "high" } });
  expect(note).toMatch(/missing/i);
  expect(note).toMatch(/title/i);
});

test("warns on a value outside an enum", () => {
  const { note } = preflight({
    action: CREATE_TASK,
    payload: { title: "T", priority: "sometime" },
  });
  expect(note).toMatch(/priority/i);
});

test("warns when an assignee is a name, not a user_id", () => {
  const { note } = preflight({
    action: CREATE_TASK,
    payload: { title: "T", assigned_to: "Ada" },
  });
  expect(note).toMatch(/assignee|user_id|valid id/i);
});

test("warns on an unparseable datetime", () => {
  const { note } = preflight({
    action: CREATE_TASK,
    payload: { title: "T", due_at: "next Friday" },
  });
  expect(note).toMatch(/date/i);
});

test("a fully valid task produces no warning", () => {
  const { note } = preflight({
    action: CREATE_TASK,
    payload: { title: "T", priority: "high", assigned_to: UUID, due_at: "2026-07-17T18:00:00+01:00" },
  });
  expect(note).toBeNull();
});

test("an unresolved {{step:N.field}} token is treated as present, not invalid", () => {
  // id is required + id-like; a token must NOT trip missing-required or bad-id.
  const { note, payload } = preflight({
    action: ADD_MILESTONE,
    payload: { id: "{{step:0.goal_id}}", title: "M1" },
  });
  expect(note).toBeNull();
  expect(payload.id).toBe("{{step:0.goal_id}}");
});

test("no schema → payload passes through untouched", () => {
  const { payload, note } = preflight({
    action: { action_key: "x", payload_schema: null },
    payload: { anything: 1 },
  });
  expect(payload).toEqual({ anything: 1 });
  expect(note).toBeNull();
});
