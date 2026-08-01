/**
 * Crowns 👑 — streak engine (the retention upgrade). Two streak types run in
 * parallel per brand: a monthly purchase streak and a weekly check-in streak.
 * A streak is a run of consecutive periods each containing ≥1 qualifying
 * action. Freezes bridge a single missed period; the scanner nudges before a
 * deadline (email + in-app for sales) and breaks the streak once it lapses.
 *
 * As seeded the streak mints no Crowns (owner turned that off) — it is a pure
 * retention signal. Flip crown_streak_config.awards_crowns_on_extend /
 * milestone_bonuses on to make it pay out; this module is written for that too.
 */

"use strict";

const repo = require("./crown.repo");
const events = require("./retention.events");

const DAY_MS = 86400000;

function daysSinceEpoch(d) {
  return Math.floor(d.getTime() / DAY_MS);
}

/** Integer index of the period containing `ts` (consecutive → differ by 1). */
function periodKey(ts, unit, length) {
  const d = new Date(ts);
  if (unit === "month") {
    return Math.floor((d.getUTCFullYear() * 12 + d.getUTCMonth()) / length);
  }
  if (unit === "week") {
    return Math.floor(daysSinceEpoch(d) / (7 * length));
  }
  return Math.floor(daysSinceEpoch(d) / length);
}

/** Start of the period AFTER the one containing `ts`. */
function periodEndTime(ts, unit, length) {
  const d = new Date(ts);
  if (unit === "month") {
    const total = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const next = (Math.floor(total / length) + 1) * length;
    return new Date(Date.UTC(Math.floor(next / 12), next % 12, 1));
  }
  const span = (unit === "week" ? 7 : 1) * length;
  const next = (Math.floor(daysSinceEpoch(d) / span) + 1) * span;
  return new Date(next * DAY_MS);
}

/** Deadline = end of the current period + the configured grace days. */
function deadlineFrom(ts, config) {
  const end = periodEndTime(ts, config.period_unit, config.period_length);
  return new Date(end.getTime() + (config.grace_days || 0) * DAY_MS);
}

function rowToStreak(s) {
  return {
    contact_id: s.contact_id,
    streak_type: s.streak_type,
    current_length: s.current_length,
    longest_length: s.longest_length,
    status: s.status,
    period_anchor_at: s.period_anchor_at,
    last_qualified_at: s.last_qualified_at,
    current_period_qualified: s.current_period_qualified,
    deadline_at: s.deadline_at,
    freezes_available: s.freezes_available,
    freezes_used: s.freezes_used,
    last_nudge_at: s.last_nudge_at,
    started_at: s.started_at,
    broken_at: s.broken_at,
  };
}

/**
 * Record a qualifying action against every streak whose config matches
 * (`purchase` → monthly, `check_in` → weekly), advancing or restarting each.
 */
async function recordQualifyingAction({
  client,
  brand,
  contact_id,
  qualifying_action,
  occurred_at = new Date(),
}) {
  if (!contact_id) return [];
  const configs = (await repo.listStreakConfig({ client, brand })).filter(
    (c) => c.qualifying_action === qualifying_action,
  );
  const out = [];
  for (const config of configs) {
    out.push(await advance({ client, brand, contact_id, config, at: new Date(occurred_at) }));
  }
  return out;
}

async function advance({ client, brand, contact_id, config, at }) {
  const existing = await repo.getStreak({
    client,
    brand,
    contact_id,
    streak_type: config.streak_type,
  });

  // Fresh start (no streak, previously broken, or never qualified).
  if (!existing || existing.status === "broken" || !existing.last_qualified_at) {
    await maybeAwardExtend({ client, brand, contact_id, config, length: 1 });
    return repo.upsertStreak({
      client,
      brand,
      streak: {
        contact_id,
        streak_type: config.streak_type,
        current_length: 1,
        longest_length: Math.max(1, existing ? existing.longest_length : 0),
        status: "active",
        period_anchor_at: at,
        last_qualified_at: at,
        current_period_qualified: true,
        deadline_at: deadlineFrom(at, config),
        freezes_available: config.freeze_allowance,
        freezes_used: 0,
        last_nudge_at: null,
        started_at: existing ? existing.started_at : at,
        broken_at: null,
      },
    });
  }

  const key = periodKey(at, config.period_unit, config.period_length);
  const lastKey = periodKey(
    existing.last_qualified_at,
    config.period_unit,
    config.period_length,
  );
  const gap = key - lastKey;

  let length = existing.current_length;
  let freezes = existing.freezes_available;
  let freezesUsed = existing.freezes_used;

  if (gap <= 0) {
    // Same period — already counted; refresh the deadline only.
  } else if (gap === 1) {
    length += 1;
  } else if (gap === 2 && freezes > 0) {
    // One missed period, bridged by a freeze.
    freezes -= 1;
    freezesUsed += 1;
    length += 1;
  } else {
    // Lapsed — restart the run.
    length = 1;
    freezes = config.freeze_allowance;
    freezesUsed = 0;
  }

  if (gap !== 0) {
    await maybeAwardExtend({ client, brand, contact_id, config, length });
  }

  return repo.upsertStreak({
    client,
    brand,
    streak: {
      contact_id,
      streak_type: config.streak_type,
      current_length: length,
      longest_length: Math.max(length, existing.longest_length || 0),
      status: "active",
      period_anchor_at: at,
      last_qualified_at: at,
      current_period_qualified: true,
      deadline_at: deadlineFrom(at, config),
      freezes_available: freezes,
      freezes_used: freezesUsed,
      last_nudge_at: null,
      started_at: length === 1 ? at : existing.started_at,
      broken_at: null,
    },
  });
}

/**
 * Optional Crown payout for maintaining a streak — OFF as seeded
 * (awards_crowns_on_extend = 0, milestone_bonuses = []). Kept wired so the
 * owner can enable it from config without a deploy.
 */
async function maybeAwardExtend({ client, brand, contact_id, config, length }) {
  const flat = Number(config.awards_crowns_on_extend || 0);
  const milestones = Array.isArray(config.milestone_bonuses)
    ? config.milestone_bonuses
    : [];
  const milestone = milestones.find((m) => Number(m.length) === length);
  const crowns = flat + (milestone ? Number(milestone.crowns || 0) : 0);
  if (crowns <= 0) return null;

  const service = require("./crown.service");
  return service.awardByRule({
    client,
    brand,
    contact_id,
    rule: {
      rule_id: null,
      action_type: "manual",
      is_active: true,
      crowns_mode: "flat",
      crown_value: crowns,
    },
    reference_type: "crown_streak",
    reference_id: null,
    description: `${config.display_name} — ${length} in a row`,
  });
}

/**
 * Scanner (run by the scheduler, per brand). Nudges streaks entering the
 * warning window and, once a deadline passes, spends a freeze if one is left
 * or breaks the streak. Returns counters for logging.
 */
async function scan({ brand, now = new Date() }) {
  const configs = await repo.listStreakConfig({ brand });
  const res = { nudged: 0, frozen: 0, broken: 0 };

  for (const config of configs) {
    const horizon = new Date(now.getTime() + (config.nudge_lead_days || 0) * DAY_MS);
    const due = await repo.listStreaksDue({
      brand,
      streak_type: config.streak_type,
      before: horizon,
    });

    for (const s of due) {
      if (!s.deadline_at) continue;
      const deadline = new Date(s.deadline_at);

      if (deadline < now) {
        if (s.freezes_available > 0) {
          await repo.upsertStreak({
            brand,
            streak: {
              ...rowToStreak(s),
              status: "active",
              deadline_at: deadlineFrom(deadline, config),
              freezes_available: s.freezes_available - 1,
              freezes_used: s.freezes_used + 1,
            },
          });
          res.frozen += 1;
          events.emit("crown.streak_frozen", {
            brand,
            contact_id: s.contact_id,
            streak_type: s.streak_type,
          });
        } else {
          await repo.upsertStreak({
            brand,
            streak: { ...rowToStreak(s), status: "broken", broken_at: now },
          });
          res.broken += 1;
          events.emit("crown.streak_broken", {
            brand,
            contact_id: s.contact_id,
            streak_type: s.streak_type,
            length: s.current_length,
          });
        }
        continue;
      }

      // Within the warning window — nudge once per period.
      const nudgedThisPeriod =
        s.last_nudge_at &&
        s.period_anchor_at &&
        new Date(s.last_nudge_at) >= new Date(s.period_anchor_at);
      if (s.status !== "at_risk" && !nudgedThisPeriod) {
        await repo.upsertStreak({
          brand,
          streak: { ...rowToStreak(s), status: "at_risk", last_nudge_at: now },
        });
        res.nudged += 1;
        events.emit("crown.streak_at_risk", {
          brand,
          contact_id: s.contact_id,
          streak_type: s.streak_type,
          deadline_at: s.deadline_at,
        });
      }
    }
  }
  return res;
}

/** A customer's weekly check-in (the engagement streak's qualifying action). */
async function checkIn({ brand, contact_id }) {
  const streaks = await recordQualifyingAction({
    brand,
    contact_id,
    qualifying_action: "check_in",
  });
  return streaks.filter(Boolean);
}

module.exports = {
  recordQualifyingAction,
  checkIn,
  scan,
  // exported for tests
  periodKey,
  deadlineFrom,
};
