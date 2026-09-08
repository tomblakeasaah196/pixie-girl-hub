"use strict";

/**
 * The readiness predicate that gates every "your order is ready" effect.
 *
 * The rule it encodes, and the two edge cases that are easy to get wrong:
 *
 *   ready ⇔ the order has at least one studio job AND none are outstanding
 *
 *   • total === 0 is NOT ready. A plain wig sale opens no studio job, and an
 *     order with nothing to style must never be held forever waiting for work
 *     that will never exist — those orders keep their own fulfilment path.
 *   • a cancelled or rejected job is NOT outstanding. One written-off wig would
 *     otherwise strand the parcel permanently.
 */

const mockQuery = jest.fn();
jest.mock("../../../src/config/database", () => ({
  ex: () => mockQuery,
  query: (...a) => mockQuery(...a),
}));

const readiness = require("../../../src/modules/sales/order-readiness");

/** Pose the DB as returning these counts for the order. */
const posed = (total, outstanding, done) =>
  mockQuery.mockResolvedValue({ rows: [{ total, outstanding, done }] });

beforeEach(() => jest.clearAllMocks());

describe("order-readiness.studioProgress", () => {
  it("is not ready while any hair is outstanding", async () => {
    posed(3, 1, 2);
    const p = await readiness.studioProgress({
      brand: "faitlynhair",
      order_id: "o-1",
    });
    expect(p).toEqual({ total: 3, outstanding: 1, done: 2, ready: false });
  });

  it("is ready once the last hair lands", async () => {
    posed(3, 0, 3);
    const p = await readiness.studioProgress({
      brand: "faitlynhair",
      order_id: "o-1",
    });
    expect(p.ready).toBe(true);
  });

  it("is ready when the only unfinished hair was cancelled (0 outstanding)", async () => {
    posed(2, 0, 1);
    const p = await readiness.studioProgress({
      brand: "faitlynhair",
      order_id: "o-1",
    });
    expect(p.ready).toBe(true);
    expect(p.done).toBe(1);
  });

  it("an order with no studio jobs is NOT 'ready' — this gate doesn't govern it", async () => {
    posed(0, 0, 0);
    const p = await readiness.studioProgress({
      brand: "pixiegirl",
      order_id: "o-plain",
    });
    expect(p.ready).toBe(false);
    expect(p.total).toBe(0);
  });

  it("short-circuits without a query when there is no order", async () => {
    const p = await readiness.studioProgress({
      brand: "faitlynhair",
      order_id: null,
    });
    expect(p).toEqual({ total: 0, outstanding: 0, done: 0, ready: false });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the query to the order and the brand's own schema", async () => {
    posed(1, 0, 1);
    await readiness.studioProgress({ brand: "faitlynhair", order_id: "o-9" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("faitlynhair.service_jobs");
    expect(sql).toContain("sales_order_id = $1");
    expect(params[0]).toBe("o-9");
    // The done/settled sets are bound, never interpolated into the SQL text.
    expect(params[1]).toEqual(readiness.JOB_SETTLED);
    expect(params[2]).toEqual(readiness.JOB_DONE);
  });
});

describe("order-readiness.allStudioJobsDone", () => {
  it("collapses progress to the single boolean the gates ask for", async () => {
    posed(2, 1, 1);
    await expect(
      readiness.allStudioJobsDone({ brand: "faitlynhair", order_id: "o-1" }),
    ).resolves.toBe(false);

    posed(2, 0, 2);
    await expect(
      readiness.allStudioJobsDone({ brand: "faitlynhair", order_id: "o-1" }),
    ).resolves.toBe(true);
  });
});

describe("order-readiness — the status sets", () => {
  it("treats every Studio hand-off state as done, so a job can't stall the order", () => {
    // These are the states migration 000068 gives a wig that has left the
    // stylist. Missing one would hold an order whose work is finished.
    expect(readiness.JOB_DONE).toEqual(
      expect.arrayContaining([
        "qc_passed",
        "ready_for_dispatch",
        "handed_to_sales",
        "completed",
      ]),
    );
  });

  it("never counts a void job as done — it is excluded, not completed", () => {
    for (const s of readiness.JOB_VOID) {
      expect(readiness.JOB_DONE).not.toContain(s);
      expect(readiness.JOB_SETTLED).toContain(s);
    }
  });

  it("builds SQL tuples from the same sets the JS predicate uses", () => {
    expect(readiness.JOB_DONE_SQL).toBe(
      `(${readiness.JOB_DONE.map((s) => `'${s}'`).join(",")})`,
    );
    expect(readiness.JOB_SETTLED_SQL).toBe(
      `(${readiness.JOB_SETTLED.map((s) => `'${s}'`).join(",")})`,
    );
  });
});

describe("order-readiness.progressLabel", () => {
  it("phrases partial progress", () => {
    expect(readiness.progressLabel({ total: 3, done: 2 })).toBe(
      "2 of 3 items ready",
    );
  });
  it("says nothing for an order with no studio work", () => {
    expect(readiness.progressLabel({ total: 0, done: 0 })).toBeNull();
  });
});
