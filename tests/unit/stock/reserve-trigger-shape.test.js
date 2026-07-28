"use strict";

/**
 * Guards the SQL shape of fn_apply_stock_movement's 'reserve' branch.
 *
 * THE BUG THIS PREVENTS — every order line became a pre-order, for every
 * variant, at every location, on every channel, for the life of the database.
 *
 * The reserve branch used to apply a hold with:
 *
 *   INSERT INTO stock_levels (variant_id, location_id, on_hand, reserved, ...)
 *   VALUES (NEW.variant_id, NEW.location_id, 0, ABS(NEW.quantity), ...)
 *   ON CONFLICT (variant_id, location_id) DO UPDATE SET reserved = ...
 *
 * PostgreSQL evaluates CHECK constraints against the PROPOSED insert tuple
 * before it consults the unique index and switches to DO UPDATE. That tuple is
 * always (on_hand = 0, reserved = N), which always violates
 * `CHECK (reserved <= on_hand)` for N >= 1 — so the statement raised before the
 * conflict could ever be arbitrated, even when the row already existed with
 * ample stock. Reserving 1 unit of a variant at on_hand = 2, reserved = 0
 * failed with "Failing row contains (..., 0, 1, -1, ...)" — the on_hand = 0
 * proving the DO UPDATE path never ran.
 *
 * createOrder reserves each line in its own SAVEPOINT and books a pre-order
 * when the reserve throws, so this surfaced as a routine stock-out rather than
 * a fault. A stock_movements census showed zero 'reserve' rows ever recorded.
 *
 * These are text assertions on the migration templates because the behaviour
 * lives in PL/pgSQL — there is no JS seam to unit-test. They are deliberately
 * about SHAPE (UPDATE-first, never a bare INSERT of a zero-stock tuple into an
 * ON CONFLICT), which is what makes the constraint evaluate against real stock.
 */

const fs = require("fs");
const path = require("path");

const TEMPLATE_DIR = path.join(__dirname, "..", "..", "..", "migrations", "template");

/** Drop `--` comments so assertions read executable SQL, not prose about it.
 *  The comments legitimately quote the old broken pattern to explain it. */
const stripComments = (sql) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** Extract the fn_apply_stock_movement body from a template file. */
function reserveBranchOf(file) {
  const sql = fs.readFileSync(path.join(TEMPLATE_DIR, file), "utf8");
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"));
  const start = fn.indexOf("IF NEW.movement_type = 'reserve' THEN");
  const end = fn.indexOf("ELSIF NEW.movement_type = 'release_reserve'");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return stripComments(fn.slice(start, end));
}

const TEMPLATES = [
  "000034_business_triggers.sql.template",
  "000089_business_reserve_trigger_check_fix.sql.template",
];

describe.each(TEMPLATES)("%s — reserve branch", (file) => {
  test("updates the existing level row first", () => {
    const branch = reserveBranchOf(file);
    const update = branch.indexOf("UPDATE");
    const insert = branch.indexOf("INSERT");
    expect(update).toBeGreaterThan(-1);
    // UPDATE must come first so the CHECK sees the row's real on_hand.
    if (insert > -1) expect(update).toBeLessThan(insert);
    expect(branch).toMatch(/SET reserved = reserved \+ ABS\(NEW\.quantity\)/);
  });

  test("never uses ON CONFLICT to apply the reservation", () => {
    // The regression: ON CONFLICT cannot save a proposed tuple that already
    // fails a CHECK, because the CHECK is evaluated first.
    expect(reserveBranchOf(file)).not.toMatch(/ON CONFLICT/i);
  });

  test("only inserts a zero-stock row when no level row exists", () => {
    const branch = reserveBranchOf(file);
    if (!/INSERT/.test(branch)) return;
    // The bare insert is the genuine stock-out path and must be gated on
    // NOT FOUND, never used as the primary write.
    expect(branch).toMatch(/IF NOT FOUND THEN/);
    expect(branch.indexOf("IF NOT FOUND THEN")).toBeLessThan(
      branch.indexOf("INSERT"),
    );
  });

  test("scopes the update to one variant at one location", () => {
    expect(reserveBranchOf(file)).toMatch(
      /WHERE variant_id = NEW\.variant_id AND location_id = NEW\.location_id/,
    );
  });
});

describe("release_reserve stays UPDATE-only", () => {
  test("has no insert path that could propose a bad tuple", () => {
    const sql = fs.readFileSync(
      path.join(TEMPLATE_DIR, "000089_business_reserve_trigger_check_fix.sql.template"),
      "utf8",
    );
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"));
    const start = fn.indexOf("ELSIF NEW.movement_type = 'release_reserve'");
    const branch = fn.slice(start, fn.indexOf("ELSE", start));
    expect(branch).toMatch(/GREATEST\(0, reserved - ABS\(NEW\.quantity\)\)/);
    expect(branch).not.toMatch(/INSERT/i);
  });
});
