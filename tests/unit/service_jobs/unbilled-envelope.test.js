"use strict";

/**
 * Regression guard: GET /service-jobs/unbilled must serve a DOUBLE envelope.
 *
 * The service returns `{ data, counts }`. The admin api client
 * (apps/admin/src/lib/api.ts) unwraps any `{ data: ... }` payload down to its
 * `data` field unless a sibling `meta` marks it as a paginated list — `counts`
 * is not `meta`. Served bare, `counts` was stripped in transit, UnbilledPanel
 * destructured it off a plain array, and `counts.owed` threw: the whole Unbilled
 * Jobs tab collapsed into the error boundary ("This screen ran into a problem").
 *
 * So the controller wraps once more. The client unwraps exactly one layer and
 * the panel receives `{ data, counts }` intact. This test asserts the wrap AND
 * simulates the client's unwrap rule, so the shape the browser actually sees is
 * what's pinned — not just the JSON the controller emits.
 */

jest.mock("../../../src/modules/service_jobs/service-jobs.service", () => ({
  listUnbilledJobs: jest.fn(),
}));

const service = require("../../../src/modules/service_jobs/service-jobs.service");
const controller = require("../../../src/modules/service_jobs/service-jobs.controller");

/** The api client's unwrap rule, mirrored from apps/admin/src/lib/api.ts. */
function clientUnwrap(payload) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return "meta" in payload ? payload : payload.data;
  }
  return payload;
}

const COUNTS = {
  unclassified: 3,
  customer_our_hair: 2,
  customer_own_hair: 1,
  internal: 4,
  owed: 6,
};
const JOBS = [{ job_id: "job-1", job_number: "FLH-JOB-0160" }];

function run(query = {}) {
  const res = { json: jest.fn() };
  return controller
    .listUnbilled({ brand: "faitlynhair", query }, res)
    .then(() => res.json.mock.calls[0][0]);
}

beforeEach(() => {
  jest.clearAllMocks();
  service.listUnbilledJobs.mockResolvedValue({ data: JOBS, counts: COUNTS });
});

describe("listUnbilled response envelope", () => {
  test("wraps the service payload so the client unwrap leaves counts intact", async () => {
    const body = await run();

    expect(body).toEqual({ data: { data: JOBS, counts: COUNTS } });

    const seenByPanel = clientUnwrap(body);
    expect(seenByPanel.counts).toEqual(COUNTS);
    expect(seenByPanel.data).toEqual(JOBS);
  });

  test("a bare envelope would lose counts — the bug this guards", async () => {
    // Exactly what the controller used to send.
    const stripped = clientUnwrap({ data: JOBS, counts: COUNTS });
    expect(stripped).toEqual(JOBS);
    expect(stripped.counts).toBeUndefined();
  });

  test("passes the brand and kind filter through to the service", async () => {
    await run({ kind: "unclassified" });
    expect(service.listUnbilledJobs).toHaveBeenCalledWith({
      brand: "faitlynhair",
      kind: "unclassified",
    });
  });
});
