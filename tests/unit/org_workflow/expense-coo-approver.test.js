"use strict";

// Proves the actual fix: a user who holds the `chief_operating_officer` role
// (and is NOT flagged is_ceo) can approve/reject an expense that sits on the
// executive stage — where before the CEO-only stage silently 403'd them.
// Drives the REAL workflow engine (engine.js → userCanActOnStage → role-name
// resolution), mocking only the DB client.

const COO_ROLE_ID = "role-coo-1";

function makeClient(capture) {
  const inst = {
    instance_id: "wfi-1",
    workflow_id: "wf-1",
    business: "pixiegirl",
    current_stage: 1,
    status: "pending",
    context: { total_ngn: 1_125_000 },
  };
  const definition = {
    trigger: { module: "expenses", action: "submit" },
    stages: [
      {
        order: 1,
        name: "Executive approval (CEO or COO)",
        approvers: [
          { type: "role", value: "ceo" },
          { type: "role", value: "chief_operating_officer" },
        ],
        timeout_hours: 48,
        on_timeout: "escalate",
        fallback_to_deputy: false,
      },
    ],
  };
  return {
    query: async (sql, params) => {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.includes("FROM shared.workflow_instances WHERE instance_id = $1 FOR UPDATE"))
        return { rows: [inst] };
      if (s.includes("FROM shared.workflow_definitions WHERE workflow_id = $1"))
        return { rows: [{ workflow_id: "wf-1", definition }] };
      // roleIdsForNames: resolve chief_operating_officer → its role_id
      if (s.includes("FROM shared.roles WHERE role_name = ANY"))
        return {
          rows: [{ role_id: COO_ROLE_ID, role_name: "chief_operating_officer" }],
        };
      if (s.includes("INSERT INTO shared.workflow_decisions")) {
        capture.decision = params;
        return { rows: [{ decision_id: "d1" }] };
      }
      if (s.includes("UPDATE shared.workflow_instances") && s.includes("status = 'rejected'"))
        return { rows: [{ instance_id: "wfi-1", status: "rejected" }] };
      throw new Error("UNHANDLED SQL: " + s);
    },
  };
}

jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn(),
  ex: (client) => (client ? client.query.bind(client) : null),
}));

const wf = require("../../../src/workflows/engine");

test("COO (not is_ceo) can reject an expense on the executive stage", async () => {
  const capture = {};
  const client = makeClient(capture);
  const COO = {
    user_id: "coo-user-1",
    is_ceo: false,
    role_ids: [COO_ROLE_ID],
  };
  const res = await wf.act({
    client,
    instance_id: "wfi-1",
    user: COO,
    action: "reject",
    notes: "already paid",
  });
  expect(res.status).toBe("rejected");
  // The decision was logged against the COO with the reject verb + reason.
  expect(capture.decision).toEqual([
    "wfi-1",
    1,
    "coo-user-1",
    "reject",
    "already paid",
  ]);
});

test("a plain staffer (no exec role, not is_ceo) is still blocked", async () => {
  const client = makeClient({});
  const STAFF = { user_id: "s-1", is_ceo: false, role_ids: ["role-staff"] };
  await expect(
    wf.act({
      client,
      instance_id: "wfi-1",
      user: STAFF,
      action: "reject",
      notes: "nope",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});
