"use strict";

/**
 * withSavepoint — the only correct way to write a "best-effort, log and carry
 * on" step inside transaction().
 *
 * A bare try/catch does not work. Once any statement errors, Postgres aborts
 * the whole transaction: every later statement on that connection fails with
 * 25P02 (`current transaction is aborted, commands ignored until end of
 * transaction block`), and if nothing else writes before COMMIT, Postgres
 * quietly downgrades the COMMIT to a ROLLBACK so the request returns 200 with
 * nothing saved. The savepoint confines the failure to its own step.
 *
 * These tests pin the SQL that guarantees it, because the guarantee is entirely
 * in the SAVEPOINT / ROLLBACK TO / RELEASE sequence.
 */

jest.mock("pg", () => ({
  Pool: jest.fn(),
  types: { setTypeParser: jest.fn(), builtins: { DATE: 1082 } },
}));
jest.mock("pgvector/pg", () => ({ registerType: jest.fn() }));

const { withSavepoint } = require("../../../src/config/database");

/** A stub pg client that records every statement it is handed. */
function fakeClient() {
  const sql = [];
  return {
    sql,
    query: jest.fn(async (text) => {
      sql.push(text);
      return { rows: [] };
    }),
  };
}

describe("withSavepoint", () => {
  it("brackets a successful step with SAVEPOINT … RELEASE and returns its value", async () => {
    const client = fakeClient();

    const result = await withSavepoint(client, async () => "held");

    expect(result).toBe("held");
    expect(client.sql).toHaveLength(2);
    expect(client.sql[0]).toMatch(/^SAVEPOINT pgh_sp_\d+$/);
    expect(client.sql[1]).toMatch(/^RELEASE SAVEPOINT pgh_sp_\d+$/);
    // Same savepoint opened and released.
    expect(client.sql[1]).toContain(client.sql[0].split(" ")[1]);
  });

  it("rolls back to the savepoint on failure and rethrows the original error", async () => {
    const client = fakeClient();
    // What the stock SSOT actually raises when a wig is not on hand.
    const raise = Object.assign(
      new Error(
        'new row for relation "stock_levels" violates check constraint "stock_reserved_le_on_hand"',
      ),
      { code: "23514", constraint: "stock_reserved_le_on_hand" },
    );

    await expect(
      withSavepoint(client, async () => {
        throw raise;
      }),
    ).rejects.toBe(raise);

    expect(client.sql[0]).toMatch(/^SAVEPOINT pgh_sp_\d+$/);
    expect(client.sql[1]).toMatch(/^ROLLBACK TO SAVEPOINT pgh_sp_\d+$/);
    expect(client.sql[2]).toMatch(/^RELEASE SAVEPOINT pgh_sp_\d+$/);
  });

  it("leaves the transaction usable — the next statement is NOT a 25P02", async () => {
    // The whole point: after a caught failure the caller keeps writing on the
    // same client. This is the sequence the real Postgres accepts.
    const client = fakeClient();

    try {
      await withSavepoint(client, async () => {
        await client.query("INSERT INTO stock_movements …");
        throw new Error("reserve raised");
      });
    } catch {
      /* best-effort caller swallows, as the service does */
    }
    await client.query("INSERT INTO wig_custody_ledger …");

    expect(client.sql).toEqual([
      expect.stringMatching(/^SAVEPOINT pgh_sp_\d+$/),
      "INSERT INTO stock_movements …",
      expect.stringMatching(/^ROLLBACK TO SAVEPOINT pgh_sp_\d+$/),
      expect.stringMatching(/^RELEASE SAVEPOINT pgh_sp_\d+$/),
      "INSERT INTO wig_custody_ledger …",
    ]);
  });

  it("nests without name collisions", async () => {
    const client = fakeClient();

    await withSavepoint(client, () =>
      withSavepoint(client, async () => "inner"),
    );

    const outer = client.sql[0].split(" ")[1];
    const inner = client.sql[1].split(" ")[1];
    expect(inner).not.toBe(outer);
    // Inner releases before outer.
    expect(client.sql[2]).toBe(`RELEASE SAVEPOINT ${inner}`);
    expect(client.sql[3]).toBe(`RELEASE SAVEPOINT ${outer}`);
  });

  it("generates savepoint names itself — never from caller input", async () => {
    const client = fakeClient();
    await withSavepoint(client, async () => null);
    // No interpolation surface: the name is a counter-derived identifier.
    expect(client.sql[0]).toMatch(/^SAVEPOINT pgh_sp_\d+$/);
  });

  it("runs the step directly when there is no transaction to protect", async () => {
    const result = await withSavepoint(null, async () => "ran");
    expect(result).toBe("ran");
  });

  it("still surfaces the original error when the rollback itself fails", async () => {
    // A dead connection: the unwind can't be issued. The caller must see the
    // real cause, not the rollback's error.
    const boom = new Error("reserve raised");
    const client = {
      query: jest.fn(async (text) => {
        if (text.startsWith("SAVEPOINT")) return { rows: [] };
        throw new Error("connection terminated");
      }),
    };

    await expect(
      withSavepoint(client, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
