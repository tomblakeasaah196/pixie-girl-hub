"use strict";

/**
 * CoS planner EVAL suite — golden scenarios through the real
 * build → pre-flight → cross-step-token pipeline.
 *
 * Where the other planner tests check one mechanism at a time, this locks in
 * end-to-end BEHAVIOUR for representative CEO intentions: a good model's
 * tool-calls must yield correctly-ordered, valid, token-wired steps; a sloppy
 * model's must be cleaned (hallucinated keys stripped) and flagged (pre-flight
 * warning) at build time. It's the regression net for Phase 0 — a catalogue or
 * pre-flight change that breaks a known-good plan fails here.
 *
 * The catalogue fixture MIRRORS the live rows (migrations 000324/000333/000347);
 * keep it in sync when the catalogue schema changes — same rule as the persona.
 */

const planner = require("../../../src/modules/chief_of_staff/cos.planner");

const safeName = (key) => String(key).replace(/[^a-zA-Z0-9_-]/g, "_");

// ── Catalogue fixture (mirrors surface='workspace' write rows) ──
const ACTIONS = [
  {
    action_id: "a-goal",
    action_key: "workspace.create_goal",
    method: "POST",
    route: "/api/v1/goals",
    surface: "workspace",
    min_confidence: 0.7,
    payload_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        target_date: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    action_id: "a-milestone",
    action_key: "workspace.add_milestone",
    method: "POST",
    route: "/api/v1/goals/:id/milestones",
    surface: "workspace",
    min_confidence: 0.7,
    payload_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        target_date: { type: "string" },
        display_order: { type: "integer" },
      },
      required: ["id", "title"],
    },
  },
  {
    action_id: "a-task",
    action_key: "workspace.create_task",
    method: "POST",
    route: "/api/v1/tasks",
    surface: "workspace",
    min_confidence: 0.7,
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
        reminder_minutes: { type: "integer" },
      },
      required: ["title"],
    },
  },
  {
    action_id: "a-event",
    action_key: "workspace.create_event",
    method: "POST",
    route: "/api/v1/calendar",
    surface: "workspace",
    min_confidence: 0.7,
    payload_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        event_type: { type: "string", enum: ["meeting", "call", "review", "other"] },
        start_at: { type: "string" },
        end_at: { type: "string" },
        participants: { type: "array" },
        reminder_minutes: { type: "integer" },
      },
      required: ["title", "event_type", "start_at", "end_at"],
    },
  },
  {
    action_id: "a-link-task",
    action_key: "workspace.link_task",
    method: "POST",
    route: "/api/v1/goals/:id/tasks/:taskId/link",
    surface: "workspace",
    min_confidence: 0.7,
    payload_schema: {
      type: "object",
      properties: { id: { type: "string" }, taskId: { type: "string" } },
      required: ["id", "taskId"],
    },
  },
];

const byName = new Map(ACTIONS.map((a) => [safeName(a.action_key), a]));
const call = (key, args) => ({ function: { name: safeName(key), arguments: JSON.stringify(args) } });

const UUID = "11111111-1111-4111-8111-111111111111";

// ── Golden scenarios ───────────────────────────────────────
test("a launch plan builds goal → milestones → task → link in order, tokens wired, no warnings", () => {
  const toolCalls = [
    call("workspace.create_goal", { title: "Launch accessories line", priority: "high", target_date: "2026-08-31" }),
    call("workspace.add_milestone", { id: "{{step:0.goal_id}}", title: "Finalise supplier", target_date: "2026-06-15" }),
    call("workspace.add_milestone", { id: "{{step:0.goal_id}}", title: "Design catalogue", target_date: "2026-07-15" }),
    call("workspace.create_task", { title: "Kickoff", assigned_to: UUID, due_at: "2026-06-01T17:00:00+01:00" }),
    call("workspace.link_task", { id: "{{step:0.goal_id}}", taskId: "{{step:3.task_id}}" }),
  ];
  const steps = planner.buildSteps({ toolCalls, byName });

  expect(steps.map((s) => s.action_key)).toEqual([
    "workspace.create_goal",
    "workspace.add_milestone",
    "workspace.add_milestone",
    "workspace.create_task",
    "workspace.link_task",
  ]);
  // Every step is clean — no review-time warning.
  expect(steps.every((s) => !s.preflight_note)).toBe(true);
  // Cross-step tokens survive verbatim into the persisted payload.
  expect(steps[1].payload.id).toBe("{{step:0.goal_id}}");
  expect(steps[4].payload.taskId).toBe("{{step:3.task_id}}");
});

test("cross-step tokens resolve to real ids at execution time", () => {
  const toolCalls = [
    call("workspace.create_goal", { title: "G" }),
    call("workspace.create_task", { title: "T" }),
    call("workspace.link_task", { id: "{{step:0.goal_id}}", taskId: "{{step:1.task_id}}" }),
  ];
  const steps = planner.buildSteps({ toolCalls, byName });
  const prior = [];
  prior[0] = { data: { goal_id: "g-1" } };
  prior[1] = { data: { task_id: "t-1" } };
  const resolved = planner.resolveTokens(steps[2].payload, prior);
  expect(resolved).toEqual({ id: "g-1", taskId: "t-1" });
  expect(planner.hasUnresolvedTokens(resolved)).toBe(false);
});

test("a personal task keeps is_personal + reminder and needs no assignee", () => {
  const steps = planner.buildSteps({
    toolCalls: [call("workspace.create_task", { title: "Call accountant", is_personal: true, due_at: "2026-06-15T10:00:00+01:00", reminder_minutes: 60 })],
    byName,
  });
  expect(steps[0].preflight_note).toBeNull();
  expect(steps[0].payload.is_personal).toBe(true);
  expect(steps[0].payload.reminder_minutes).toBe(60);
});

test("a contact-linked task keeps reference fields", () => {
  const steps = planner.buildSteps({
    toolCalls: [call("workspace.create_task", { title: "Follow up", reference_type: "contact", reference_id: UUID })],
    byName,
  });
  expect(steps[0].preflight_note).toBeNull();
  expect(steps[0].payload).toEqual({ title: "Follow up", reference_type: "contact", reference_id: UUID });
});

test("a sloppy model is cleaned + flagged: hallucinated key stripped, name-as-assignee warned", () => {
  const steps = planner.buildSteps({
    toolCalls: [call("workspace.create_task", { title: "Follow up with Ada", assigned_to: "Ada", contact_id: "c-1" })],
    byName,
  });
  // contact_id isn't in the task schema → stripped (the strict endpoint would 400).
  expect(steps[0].payload).not.toHaveProperty("contact_id");
  expect(steps[0].payload.title).toBe("Follow up with Ada");
  // "Ada" isn't a user_id → flagged for the CEO before approval.
  expect(steps[0].preflight_note).toMatch(/assignee|user_id|valid id/i);
});

test("an event missing end_at is flagged but its participants are preserved", () => {
  const steps = planner.buildSteps({
    toolCalls: [
      call("workspace.create_event", { title: "Supplier call", event_type: "call", start_at: "2026-06-16T15:00:00+01:00", participants: [{ contact_id: UUID }] }),
    ],
    byName,
  });
  expect(steps[0].preflight_note).toMatch(/end_at/i);
  expect(steps[0].payload.participants).toEqual([{ contact_id: UUID }]);
});

test("a bad event_type enum is caught at build time", () => {
  const steps = planner.buildSteps({
    toolCalls: [
      call("workspace.create_event", { title: "X", event_type: "brunch", start_at: "2026-06-16T15:00:00+01:00", end_at: "2026-06-16T16:00:00+01:00" }),
    ],
    byName,
  });
  expect(steps[0].preflight_note).toMatch(/event_type/i);
});

test("an out-of-scope tool call is refused (structural guardrail holds)", () => {
  expect(() =>
    planner.buildSteps({ toolCalls: [call("praxis.create_invoice", { amount: 1000 })], byName }),
  ).toThrow(/outside|workspace scope/i);
});
