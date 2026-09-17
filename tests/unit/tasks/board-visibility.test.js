"use strict";

/**
 * Regression — "I created two tasks and they never showed up on the board."
 *
 * The chain, end to end:
 *
 *   WRITE  The Workspace "New Task" form (TaskFormModal.tsx) has no assignee
 *          field, so the POST body carries no `assigned_to` and
 *          repo.createTask binds NULL. Every task created in the UI is born
 *          unassigned. (shared.tasks.assigned_to is nullable with no default
 *          and no trigger — see migrations/000005_shared_scheduling.sql.)
 *
 *   READ   The board is fetched with ?assigned_to=me. That used to be resolved
 *          to the caller's user_id and turned into `t.assigned_to = $2`.
 *          NULL = '<uuid>' is NULL, not true — so the row the write side just
 *          stored could never satisfy the filter the read side applied. The
 *          task was in the database and invisible on its creator's own board.
 *
 *   FIX    "me" now means MY BOARD: assigned to me OR raised by me — the same
 *          definition of "mine" listTasks already used for 'own' scope
 *          (tasks.repo `visible_to`). Existing unassigned tasks come back with
 *          no data migration.
 *
 * These tests drive the real controller → service → repo code and capture the
 * exact SQL it emits; the last two execute that SQL against a real SQL engine
 * so "the row is excluded / included" is demonstrated, not restated.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(() => jest.fn()),
  transaction: jest.fn((fn) => fn({})),
}));
jest.mock("../../../src/shared/tasks/tasks.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const db = require("../../../src/config/database");
const repo = require("../../../src/shared/tasks/tasks.repo");
const service = require("../../../src/shared/tasks/tasks.service");
const { execFileSync } = require("child_process");

const ME = "11111111-1111-1111-1111-111111111111";
const BRAND = "faitlynhair";

/** Runs SQL captured from the mocked query fn against a real SQL engine. */
function runAgainstEngine(sql, params) {
  const out = execFileSync(
    "python3",
    [`${__dirname}/board-visibility-harness.py`],
    { input: JSON.stringify({ sql, params, me: ME, brand: BRAND }) },
    { encoding: "utf8" },
  );
  return JSON.parse(out);
}

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ rows: [] });
});

/** The exact payload TaskFormModal.tsx posts for a plain new task. */
const UI_CREATE_PAYLOAD = {
  title: "Restock edge control",
  description: "Six units for the flagship",
  status: "to_do",
  priority: "normal",
  is_personal: false,
  reminder_minutes: null,
  remind_at: null,
};

describe("write side — what the New Task form stores", () => {
  test("a task created from the form binds assigned_to = NULL", async () => {
    const insert = jest.fn().mockResolvedValue({ rows: [{ task_id: "t1" }] });
    db.ex.mockReturnValue(insert);

    await repo.createTask({
      client: {},
      task: { ...UI_CREATE_PAYLOAD, business: BRAND, created_by: ME },
    });

    const params = insert.mock.calls[0][1];
    // INSERT column order in tasks.repo.js: business, title, description,
    // status, priority, assigned_to, due_at, …, created_by, …
    expect(params[5]).toBeNull(); // assigned_to
    expect(params[10]).toBe(ME); // created_by — recorded, not anonymous
  });
});

describe("read side — the query the board sends", () => {
  test("the old equality filter drops the unassigned tasks it just wrote", async () => {
    // This is exactly what ?assigned_to=me used to produce.
    await repo.boardTasks({ brand: BRAND, assigned_to: ME });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/t\.assigned_to = \$2/);

    const result = runAgainstEngine(sql, params);
    expect(result.unassigned_rows_in_table).toBe(2);
    expect(result.board_returned).toEqual(["assigned-to-me"]);
    expect(result.board_returned).not.toContain("unassigned-1");
  });

  test("getBoard({ mine }) swaps the equality filter for assignee-or-creator", async () => {
    await service.getBoard({ brand: BRAND, scope: "all", user: { user_id: ME }, mine: true });
    const [sql] = db.query.mock.calls[0];

    // No bare ANDed equality filter on the assignee…
    expect(sql).not.toMatch(/AND\s+t\.assigned_to =/);
    // …the "mine" predicate instead.
    expect(sql).toMatch(/\(t\.assigned_to = \$2 OR t\.created_by = \$2\)/);
  });

  test("the fixed board query returns the unassigned tasks", async () => {
    await service.getBoard({ brand: BRAND, scope: "all", user: { user_id: ME }, mine: true });
    const [sql, params] = db.query.mock.calls[0];

    const result = runAgainstEngine(sql, params);
    expect(result.board_returned.sort()).toEqual([
      "assigned-to-me",
      "unassigned-1",
      "unassigned-2",
    ]);
  });

  test("listTasks({ mine }) applies the same predicate", async () => {
    db.query.mockResolvedValue({ rows: [{ total: 0 }] });
    await service.listTasks({ brand: BRAND, scope: "all", user: { user_id: ME }, mine: true });
    const [sql] = db.query.mock.calls[0];

    expect(sql).not.toMatch(/AND\s+t\.assigned_to =/);
    expect(sql).toMatch(/\(t\.assigned_to = \$2 OR t\.created_by = \$2\)/);
  });

  test("an explicit assignee id is still a pure assignee filter", async () => {
    const OTHER = "22222222-2222-2222-2222-222222222222";
    await repo.boardTasks({ brand: BRAND, assigned_to: OTHER });
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/t\.assigned_to = \$2/);
  });
});
