/**
 * Retention strategy engine (Module 6.23) — the heart of "add a strategy
 * without code".
 *
 *   trigger(): an event (or the scanner) fires a trigger_type for a contact.
 *     Every active strategy on that trigger whose conditions + audience match
 *     enrols the customer (subject to per-customer caps), snapshotting their
 *     facts as the enrolment context.
 *   tick(): a per-minute cron claims due enrolments (FOR UPDATE SKIP LOCKED),
 *     rebuilds fresh facts, evaluates the next step's conditions, applies
 *     quiet-hours/frequency-cap gating to emails, runs the action, logs the
 *     step run, and schedules the next step (or completes the journey).
 *
 * Every step is isolated: a single failure logs and advances rather than
 * wedging the enrolment.
 */

"use strict";

const repo = require("./strategy.repo");
const facts = require("./strategy.facts");
const actions = require("./strategy.actions");
const suppression = require("./strategy.suppression");
const conditions = require("./strategy.conditions");
const businessConfig = require("../business_setup/business-config.repo");
const { query, transaction } = require("../../config/database");
const { BRANDS } = require("../../config/brands");
const { logger } = require("../../config/logger");

function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + (minutes || 0) * 60_000);
}

async function audienceMatches({ brand, segment_id, customerFacts }) {
  if (!segment_id) return true;
  try {
    const { rows } = await query(
      `SELECT filter FROM shared.contact_segments WHERE segment_id = $1 AND business = $2`,
      [segment_id, brand],
    );
    const filter = rows[0] && rows[0].filter;
    // Only enforce when the segment filter is expressed as a predicate tree;
    // otherwise we don't second-guess it (the trigger_conditions are the gate).
    if (filter && (filter.all || filter.any || filter.field)) {
      return conditions.evaluate(filter, customerFacts);
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Fire a trigger for a contact: enrol matching active strategies.
 * @returns {Promise<{enrolled:number}>}
 */
async function trigger({ brand, trigger_type, contact_id, source_table, source_id, event = {} }) {
  return transaction(async (client) => {
    const strategies = await repo.findActiveByTrigger({ client, brand, trigger_type });
    if (strategies.length === 0) return { enrolled: 0 };

    const customerFacts = await facts.build({ brand, contact_id, event, client });
    let enrolled = 0;

    for (const strat of strategies) {
      // Conditions gate.
      if (!conditions.evaluate(strat.trigger_conditions || {}, customerFacts)) continue;
      // Audience gate.
      if (!(await audienceMatches({ brand, segment_id: strat.audience_segment_id, customerFacts })))
        continue;
      // Per-customer caps.
      if (contact_id) {
        if (await repo.hasActiveEnrollment({ client, brand, strategy_id: strat.strategy_id, contact_id }))
          continue;
        if (strat.max_enrollments_per_customer) {
          const n = await repo.countEnrollmentsForCustomer({
            client,
            brand,
            strategy_id: strat.strategy_id,
            contact_id,
          });
          if (n >= strat.max_enrollments_per_customer) continue;
        }
        if (
          strat.reenroll_cooldown_days &&
          (await repo.hasRecentEnrollment({
            client,
            brand,
            strategy_id: strat.strategy_id,
            contact_id,
            days: strat.reenroll_cooldown_days,
          }))
        )
          continue;
      }

      const steps = await repo.listSteps({ client, brand, strategy_id: strat.strategy_id });
      if (steps.length === 0) continue; // nothing to run

      const firstWait = steps[0].wait_minutes || 0;
      await repo.insertEnrollment({
        client,
        brand,
        enrollment: {
          strategy_id: strat.strategy_id,
          contact_id,
          next_run_at: addMinutes(new Date(), firstWait).toISOString(),
          trigger_event_type: trigger_type,
          trigger_source_table: source_table,
          trigger_source_id: source_id,
          context: customerFacts,
        },
      });
      await repo.bumpEnrolled({ client, brand, strategy_id: strat.strategy_id });
      enrolled += 1;
    }
    return { enrolled };
  });
}

/** Run one due enrolment to its next step. */
async function runEnrollment({ brand, enrollment, cfg }) {
  const strategy = await repo.getStrategy({ brand, id: enrollment.strategy_id });
  if (!strategy || strategy.status !== "active") {
    await repo.completeEnrollment({
      brand,
      enrollment_id: enrollment.enrollment_id,
      status: "exited",
      exit_reason: "strategy inactive",
    });
    return;
  }

  const nextOrder = (enrollment.current_step_order || 0) + 1;
  const step = await repo.getStepByOrder({
    brand,
    strategy_id: strategy.strategy_id,
    step_order: nextOrder,
  });
  if (!step) {
    await repo.completeEnrollment({
      brand,
      enrollment_id: enrollment.enrollment_id,
      status: "completed",
    });
    return;
  }

  // Fresh facts each step so conditions reflect current state (e.g. the
  // customer may have ordered since enrolling — win-back should then stop).
  const customerFacts = await facts.build({
    brand,
    contact_id: enrollment.contact_id,
    event: (enrollment.context && enrollment.context.event) || {},
  });

  const scheduleNext = async () => {
    const following = await repo.getStepByOrder({
      brand,
      strategy_id: strategy.strategy_id,
      step_order: nextOrder + 1,
    });
    if (!following) {
      await repo.completeEnrollment({
        brand,
        enrollment_id: enrollment.enrollment_id,
        status: "completed",
      });
    } else {
      await repo.advanceEnrollment({
        brand,
        enrollment_id: enrollment.enrollment_id,
        current_step_order: nextOrder,
        next_run_at: addMinutes(new Date(), following.wait_minutes || 0).toISOString(),
      });
    }
  };

  // Step-level condition gate.
  if (!conditions.evaluate(step.step_conditions || {}, customerFacts)) {
    await repo.insertStepRun({
      brand,
      run: {
        enrollment_id: enrollment.enrollment_id,
        step_id: step.step_id,
        step_order: nextOrder,
        status: "suppressed",
        failure_reason: "step conditions not met",
      },
    });
    await scheduleNext();
    return;
  }

  // Quiet-hours / frequency-cap gating for email.
  if (step.action_type === "send_email") {
    const decision = await suppression.checkEmail({
      brand,
      contact_id: enrollment.contact_id,
      businessConfig: cfg,
    });
    if (decision.action === "defer") {
      await repo.deferEnrollment({
        brand,
        enrollment_id: enrollment.enrollment_id,
        next_run_at: decision.defer_until.toISOString(),
      });
      return; // re-attempt later; no run logged
    }
    if (decision.action === "suppress") {
      await repo.insertStepRun({
        brand,
        run: {
          enrollment_id: enrollment.enrollment_id,
          step_id: step.step_id,
          step_order: nextOrder,
          status: "suppressed",
          failure_reason: decision.reason,
        },
      });
      await scheduleNext();
      return;
    }
  }

  // Run the action.
  let result;
  try {
    result = await actions.runStep({ brand, step, enrollment, facts: customerFacts });
  } catch (err) {
    result = { status: "failed", failure_reason: String(err.message || err).slice(0, 400) };
  }
  await repo.insertStepRun({
    brand,
    run: {
      enrollment_id: enrollment.enrollment_id,
      step_id: step.step_id,
      step_order: nextOrder,
      status: result.status === "completed" ? "completed" : result.status,
      result_summary: result.result_summary,
      generated_records: result.generated_records,
      failure_reason: result.failure_reason,
    },
  });
  await scheduleNext();
}

/** Per-minute executor across all brands. */
async function tick({ limit = 50 } = {}) {
  let done = 0;
  for (const brand of BRANDS) {
    let cfg = null;
    try {
      cfg = await businessConfig.findByKey(brand);
    } catch {
      cfg = null;
    }
    let claimed = [];
    try {
      claimed = await transaction((client) => repo.claimDueEnrollments({ client, brand, limit }));
    } catch (err) {
      logger.error({ err: err.message, brand }, "strategy tick claim failed");
      continue;
    }
    for (const enrollment of claimed) {
      try {
        await runEnrollment({ brand, enrollment, cfg });
        done += 1;
      } catch (err) {
        logger.error(
          { err: err.message, brand, enrollment_id: enrollment.enrollment_id },
          "strategy enrollment run failed",
        );
        // Don't wedge: clear the due time so it isn't reclaimed every minute.
        await repo
          .deferEnrollment({
            brand,
            enrollment_id: enrollment.enrollment_id,
            next_run_at: addMinutes(new Date(), 60).toISOString(),
          })
          .catch(() => {});
      }
    }
  }
  if (done) logger.info({ done }, "retention strategy enrollments advanced");
  return { done };
}

module.exports = { trigger, tick, runEnrollment };
