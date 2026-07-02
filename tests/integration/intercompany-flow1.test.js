"use strict";

/**
 * Intercompany Flow-1 — DB integration (books-integrity critical).
 *
 * Flow 1 (V2.2 §5.1): "Faitlyn styles Pixie's hair." FLH raises a styling
 * invoice to PXG per service job; the job must never cross entities without its
 * matched inter-company invoice. This proves, against a real schema:
 *
 *   1. The AI-Insights watchdog flags an intercompany styling job that has no
 *      matched IC transaction (`no_intercompany_match`), and the flag clears
 *      once the job is linked.
 *   2. `linkIntercompany` binds the job to a recorded styling IC transaction —
 *      validating flow type + seller brand — surfaces the FLH-INV reference on
 *      the job, and back-references the job on the IC transaction (link is
 *      explicit on both sides).
 *   3. A non-styling (wholesale) transaction is rejected.
 *
 * OPT-IN: needs a migrated + seeded DB (a shared.users row to act as staff).
 * Enable with RUN_DB_TESTS=1:
 *
 *   RUN_DB_TESTS=1 DB_HOST=localhost DB_NAME=pixie_hub_test ... \
 *     npx jest tests/integration/intercompany-flow1
 *
 * Seeds its own service type + job + IC transaction and tears them down.
 */

const RUN = process.env.RUN_DB_TESTS === "1";
const db = require("../../src/config/database");
const svc = require("../../src/modules/service_jobs/service-jobs.service");
const insightsRepo = require("../../src/modules/ai_insights/insights.repo");
const insightsService = require("../../src/modules/ai_insights/insights.service");

const suite = RUN ? describe : describe.skip;

const BRAND = "faitlynhair"; // FLH is the seller (does the styling)
const BUYER = "pixiegirl"; // PXG owns the wig
const REQ = "test-ic-flow1";

async function insertIcTxn({ flow_type, poster }) {
  const { rows } = await db.query(
    `INSERT INTO shared.intercompany_transactions
       (ic_number, flow_type, seller_brand, buyer_brand, amount, amount_ngn,
        min_margin_floor_pct, seller_doc_type, seller_doc_id, seller_doc_number,
        description, posted_by)
     VALUES ($1,$2,$3,$4,$5,$5,$6,'invoice',gen_random_uuid(),$7,$8,$9)
     RETURNING ic_transaction_id, ic_number, status`,
    [
      `IC-TEST-${Date.now().toString(36).toUpperCase()}-${flow_type[0]}`,
      flow_type,
      BRAND,
      BUYER,
      "25000.00",
      "0.00",
      "FLH-INV-TEST",
      `Flow-1 styling test (${flow_type})`,
      poster,
    ],
  );
  return rows[0];
}

suite("Intercompany Flow-1 (DB)", () => {
  let actor = null;
  let serviceTypeId = null;
  let jobId = null;
  const icIds = [];

  beforeAll(async () => {
    await db.initDatabase();
    const { rows } = await db.query(
      `SELECT user_id FROM shared.users ORDER BY created_at LIMIT 1`,
    );
    actor = rows[0] ? { user_id: rows[0].user_id } : null;
    if (actor) {
      const st = await svc.createServiceType({
        brand: BRAND,
        user: actor,
        request_id: REQ,
        input: {
          service_key: `test_ic_style_${Date.now()}`,
          display_name: "Test IC Styling (flow-1)",
          standard_cost_ngn: 25000,
        },
      });
      serviceTypeId = st.service_type_id;
    }
  });

  afterAll(async () => {
    if (jobId) {
      await db
        .query(
          `DELETE FROM shared.ai_insight_service_match WHERE service_job_id = $1`,
          [jobId],
        )
        .catch(() => {});
      await db
        .query(`DELETE FROM ${BRAND}.service_jobs WHERE job_id = $1`, [jobId])
        .catch(() => {});
    }
    for (const id of icIds) {
      await db
        .query(
          `DELETE FROM shared.intercompany_transactions WHERE ic_transaction_id = $1`,
          [id],
        )
        .catch(() => {});
    }
    if (serviceTypeId) {
      await db
        .query(`DELETE FROM ${BRAND}.service_types WHERE service_type_id = $1`, [
          serviceTypeId,
        ])
        .catch(() => {});
    }
    await db.closeDatabase();
  });

  test("watchdog flags an unlinked cross-entity styling job, and linking clears it", async () => {
    if (!actor) {
      console.warn("intercompany-flow1: no shared.users row — skipping.");
      return;
    }

    // A styling job for another entity's wig, not yet linked to an IC invoice.
    const job = await svc.createJob({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      input: {
        service_type_id: serviceTypeId,
        hair_description: "PXG wig — Flow-1 styling test",
        is_intercompany: true,
      },
    });
    jobId = job.job_id;
    // Age it past the watchdog's grace window so it qualifies for a flag.
    await db.query(
      `UPDATE ${BRAND}.service_jobs
          SET created_at = now() - interval '3 days' WHERE job_id = $1`,
      [jobId],
    );

    // ── 1. Source query flags the unlinked job ──────────────
    const before = await insightsRepo.intercompanyJobsMissingMatch({
      brand: BRAND,
    });
    expect(before.some((r) => r.job_id === jobId)).toBe(true);

    // ── 2. The detector sweep raises the schema's no_intercompany_match ──
    await insightsService.runDetectorSweep();
    const { rows: raised } = await db.query(
      `SELECT alert_type, status FROM shared.ai_insight_service_match
        WHERE service_job_id = $1 AND alert_type = 'no_intercompany_match'`,
      [jobId],
    );
    expect(raised.length).toBeGreaterThanOrEqual(1);
    expect(raised[0].status).toBe("open");

    // ── 3. Link the recorded FLH styling invoice (IC txn) ───
    const stylingTxn = await insertIcTxn({
      flow_type: "styling",
      poster: actor.user_id,
    });
    icIds.push(stylingTxn.ic_transaction_id);

    const linked = await svc.linkIntercompany({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
      ic_transaction_id: stylingTxn.ic_transaction_id,
    });
    expect(linked.intercompany_transaction_id).toBe(
      stylingTxn.ic_transaction_id,
    );
    expect(linked.is_intercompany).toBe(true);
    // FLH-INV reference is surfaced on the job (explicit on the job side).
    expect(linked.intercompany_seller_doc).toBe("FLH-INV-TEST");
    expect(linked.intercompany_seller_brand).toBe(BRAND);

    // Back-reference is explicit on the intercompany side too.
    const { rows: icRows } = await db.query(
      `SELECT reference_type, reference_id FROM shared.intercompany_transactions
        WHERE ic_transaction_id = $1`,
      [stylingTxn.ic_transaction_id],
    );
    expect(icRows[0].reference_type).toBe("service_job");
    expect(icRows[0].reference_id).toBe(jobId);

    // ── 4. Watchdog no longer flags the now-linked job ──────
    const after = await insightsRepo.intercompanyJobsMissingMatch({
      brand: BRAND,
    });
    expect(after.some((r) => r.job_id === jobId)).toBe(false);
  });

  test("rejects a non-styling (wholesale) transaction", async () => {
    if (!actor || !jobId) {
      console.warn("intercompany-flow1: prerequisite job missing — skip.");
      return;
    }
    const wholesale = await insertIcTxn({
      flow_type: "wholesale",
      poster: actor.user_id,
    });
    icIds.push(wholesale.ic_transaction_id);

    await expect(
      svc.linkIntercompany({
        brand: BRAND,
        user: actor,
        request_id: REQ,
        id: jobId,
        ic_transaction_id: wholesale.ic_transaction_id,
      }),
    ).rejects.toThrow(/styling/i);
  });
});
