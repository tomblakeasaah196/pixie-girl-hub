"use strict";

/**
 * Stylist Studio lifecycle — DB integration (accountability-critical).
 *
 * Drives one wig through the whole in-house styling lifecycle against a real
 * schema, exactly as the service layer runs it in production:
 *
 *   create → assign stylist → start → log material → add reference →
 *   return for QC → QC rework → return again → QC pass → dispatch →
 *   hand to sales → record customer outcome
 *
 * and proves the two invariants the module exists to guarantee:
 *
 *   1. The status machine advances through every studio state in order.
 *   2. The wig-custody ledger stays honest — every OUT is matched by a
 *      RETURN/DISPATCHED so the stylist's net holding returns to zero
 *      ("never lose a wig"). A rework sends the wig OUT a second time, and
 *      that second trip is accounted for too.
 *
 * It also locks in the customer-satisfaction capture (customer_rating /
 * customer_feedback persist via recordOutcome).
 *
 * OPT-IN: needs a migrated + seeded DB (service_job document sequence + at
 * least one shared.users row to act as staff). Enable with RUN_DB_TESTS=1:
 *
 *   RUN_DB_TESTS=1 DB_HOST=localhost DB_NAME=pixie_hub_test ... \
 *     npx jest tests/integration/stylist-studio-lifecycle
 *
 * It seeds its own service type + job and tears them down in afterAll (the
 * job delete cascades its ledger, materials, references and time logs).
 */

const RUN = process.env.RUN_DB_TESTS === "1";
const db = require("../../src/config/database");
const svc = require("../../src/modules/service_jobs/service-jobs.service");

const suite = RUN ? describe : describe.skip;

const BRAND = "faitlynhair";
const REQ = "test-studio-lifecycle";

suite("Stylist Studio lifecycle (DB)", () => {
  /** @type {{user_id: string} | null} */
  let actor = null;
  let serviceTypeId = null;
  let jobId = null;

  beforeAll(async () => {
    await db.initDatabase();
    // Reuse any real staff row as the actor + assigned stylist — the custody
    // and audit rows carry a users FK, so a fabricated UUID would be rejected.
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
          service_key: `test_revamp_${Date.now()}`,
          display_name: "Test Revamp (lifecycle)",
          standard_cost_ngn: 15000,
        },
      });
      serviceTypeId = st.service_type_id;
    }
  });

  afterAll(async () => {
    if (jobId) {
      // The ledger keeps rows on job delete (job_id → SET NULL), so clear them
      // explicitly to avoid orphan custody rows accreting across runs.
      await db
        .query(`DELETE FROM ${BRAND}.wig_custody_ledger WHERE job_id = $1`, [
          jobId,
        ])
        .catch(() => {});
      await db
        .query(`DELETE FROM ${BRAND}.service_jobs WHERE job_id = $1`, [jobId])
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

  test("drives a wig through the full lifecycle with an honest custody ledger", async () => {
    if (!actor) {
      console.warn(
        "stylist-studio-lifecycle: no shared.users row to act as staff — skipping.",
      );
      return;
    }

    // ── Create ──────────────────────────────────────────────
    const created = await svc.createJob({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      input: {
        service_type_id: serviceTypeId,
        hair_description: "22in Body Wave 150% — lifecycle test unit",
      },
    });
    jobId = created.job_id;
    expect(created.status).toBe("pending");

    // Baseline the stylist's current holding — the DB is shared/seeded, so we
    // assert on the *change* this job causes, not an absolute count.
    const holdingOf = (acc) =>
      Number(
        acc.balances.find((b) => b.stylist_user_id === actor.user_id)
          ?.holding ?? 0,
      );
    const baseHolding = holdingOf(await svc.getAccountability({ brand: BRAND }));

    // ── Assign stylist (wig goes OUT: custody +1) ───────────
    const assigned = await svc.assignStylist({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
      assigned_staff_user_id: actor.user_id,
    });
    expect(assigned.status).toBe("assigned");
    expect(assigned.assigned_staff_user_id).toBe(actor.user_id);

    // The stylist is now holding one more wig than before.
    const midHolding = holdingOf(
      await svc.getAccountability({ brand: BRAND }),
    );
    expect(midHolding).toBe(baseHolding + 1);

    // ── Start work → in_progress ────────────────────────────
    const started = await svc.startWork({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
    });
    expect(started.status).toBe("in_progress");

    // ── Log a chemical material (checklist line) ────────────
    await svc.logMaterial({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
      input: {
        kind: "chemical",
        chemical_name: "Toner 6.1",
        usage_note: "cool the roots",
      },
    });
    // Read back after commit (logMaterial's own return reads the pool before
    // its transaction commits, so re-list to see the persisted row).
    const materials = await svc.listMaterials({ brand: BRAND, id: jobId });
    expect(materials.some((m) => m.chemical_name === "Toner 6.1")).toBe(true);

    // ── Add a style-brief reference ─────────────────────────
    const refs = await svc.addReference({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
      input: { ref_type: "text", body: "Match the customer's photo." },
    });
    expect(refs.length).toBeGreaterThanOrEqual(1);

    // ── Return for QC (wig comes back: custody RETURN) ──────
    const returned = await svc.returnForQc({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
    });
    expect(returned.status).toBe("returned_for_qc");

    // ── QC rework → wig goes back OUT (custody +1) ──────────
    const rework = await svc.recordQc({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
      input: { result: "rework", quality_notes: "redo the edges" },
    });
    expect(rework.status).toBe("rework");
    expect(rework.rework_count).toBe(1);

    // ── Return again, then QC pass ──────────────────────────
    await svc.returnForQc({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
    });
    const passed = await svc.recordQc({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
      input: { result: "pass", quality_rating: 5, quality_notes: "clean" },
    });
    expect(passed.status).toBe("qc_passed");
    expect(passed.quality_rating).toBe(5);

    // ── Dispatch (custody DISPATCHED) → hand to sales ───────
    const dispatched = await svc.dispatch({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
    });
    expect(dispatched.status).toBe("ready_for_dispatch");

    const handed = await svc.handToSales({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
    });
    expect(handed.status).toBe("handed_to_sales");

    // ── Ledger is balanced: 2 OUT, 2 RETURN, 1 DISPATCHED ───
    const ledger = await svc.listCustodyLedger({ brand: BRAND, job_id: jobId });
    const count = (event) => ledger.filter((l) => l.event === event).length;
    expect(count("out")).toBe(2);
    expect(count("return")).toBe(2);
    expect(count("dispatched")).toBe(1);

    // Net holding is back to the baseline — this wig caused no net change:
    // nothing lost, nothing still out.
    const endAcc = await svc.getAccountability({ brand: BRAND });
    expect(holdingOf(endAcc)).toBe(baseHolding);
    // A wig that has come back is never flagged overdue.
    expect(endAcc.overdue.some((o) => o.job_id === jobId)).toBe(false);
  });

  test("captures customer satisfaction (rating + feedback persist)", async () => {
    if (!actor || !jobId) {
      console.warn("stylist-studio-lifecycle: prerequisite job missing — skip.");
      return;
    }

    await svc.recordOutcome({
      brand: BRAND,
      user: actor,
      request_id: REQ,
      id: jobId,
      input: { customer_rating: 5, customer_feedback: "Loved the finish!" },
    });

    const job = await svc.getJob({ brand: BRAND, id: jobId });
    expect(job.customer_rating).toBe(5);
    expect(job.customer_feedback).toBe("Loved the finish!");
    // Recording the outcome must not disturb the terminal status.
    expect(job.status).toBe("handed_to_sales");
  });
});
