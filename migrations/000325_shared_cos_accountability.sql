-- ============================================================
-- MIGRATION 000325 — Chief of Staff: proactive accountability (PR4)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- The CoS stops waiting. It detects risk (no progress / slippage / due /
-- overdue), pings the CEO with Done / In-Progress / Delayed buttons, asks
-- "why?", and offers/executes a re-plan. This migration adds the two
-- accountability tables + the notification action-buttons column.
--
--   1. cos_followups   — one open follow-up per (subject, trigger); the
--                        respond → reason → act state machine lives here
--   2. cos_nudges      — adaptive-timing + dedupe log (briefings, follow-ups,
--                        celebrations); engaged_at feeds PR6 adaptive timing
--   3. shared.notifications += actions JSONB   — the [{label,value,endpoint}]
--                        array behind the Done / In-Progress / Delayed buttons
--
-- Backward compatible: notifications.actions defaults to '[]', so every
-- existing notification is unchanged and non-CoS callers ignore it.
--
-- See docs/AI_CHIEF_OF_STAFF_IMPLEMENTATION.md §1.7 and PR4.
-- ============================================================

-- ── 1. cos_followups (the follow-up state machine) ──────────
CREATE TABLE IF NOT EXISTS shared.cos_followups (
  followup_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business          TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  subject_type      TEXT        NOT NULL CHECK (subject_type IN ('goal','milestone','task')),
  subject_id        UUID        NOT NULL,
  "trigger"         TEXT        NOT NULL
                    CHECK ("trigger" IN ('due_tomorrow','due_today','overdue',
                                         'no_progress','slippage','weekly_review')),
  state             TEXT        NOT NULL DEFAULT 'open'
                    CHECK (state IN ('open','asked','answered','resolved','snoozed','dismissed')),
  question          TEXT,
  answer            TEXT        CHECK (answer IN ('done','in_progress','delayed') OR answer IS NULL),
  reason            TEXT,
  suggested_actions JSONB       NOT NULL DEFAULT '[]',   -- [{label, kind, payload}]
  notification_id   UUID        REFERENCES shared.notifications (notification_id) ON DELETE SET NULL,
  snooze_until      TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cos_followups_updated_at
  BEFORE UPDATE ON shared.cos_followups
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- At most ONE live follow-up per (subject, trigger) — the scheduler checks this
-- before creating, and the DB guarantees it under a race. 'snoozed' is NOT here:
-- a snoozed follow-up is re-openable, so it must not block a fresh nudge.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cos_followups_open
  ON shared.cos_followups (subject_type, subject_id, "trigger")
  WHERE state IN ('open','asked');
CREATE INDEX IF NOT EXISTS idx_cos_followups_user_state
  ON shared.cos_followups (user_id, state);
CREATE INDEX IF NOT EXISTS idx_cos_followups_subject
  ON shared.cos_followups (subject_type, subject_id);
-- The scheduler re-arms snoozed follow-ups whose snooze_until has passed.
CREATE INDEX IF NOT EXISTS idx_cos_followups_snoozed
  ON shared.cos_followups (snooze_until)
  WHERE state = 'snoozed' AND snooze_until IS NOT NULL;

-- ── 2. cos_nudges (adaptive-timing + dedupe log) ────────────
CREATE TABLE IF NOT EXISTS shared.cos_nudges (
  nudge_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  business       TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  type           TEXT        NOT NULL,   -- 'morning_briefing','evening_review','weekly_review','followup','celebration'
  channel        TEXT        NOT NULL,   -- 'in_app','push','email'
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  engaged_at     TIMESTAMPTZ,            -- set when the user acts (adaptive-timing signal, PR6)
  reference_type TEXT,
  reference_id   UUID
);
CREATE INDEX IF NOT EXISTS idx_cos_nudges_user_type_sent
  ON shared.cos_nudges (user_id, type, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_cos_nudges_reference
  ON shared.cos_nudges (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ── 3. shared.notifications += actions ──────────────────────
-- Array of {label, value, endpoint} rendered as inline buttons in the
-- notifications drawer/page. Empty by default ⇒ a plain notification.
ALTER TABLE shared.notifications
  ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]';

-- ============================================================
-- Verify
--   SELECT to_regclass('shared.cos_followups');   -- not null
--   SELECT to_regclass('shared.cos_nudges');       -- not null
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='shared' AND table_name='notifications'
--      AND column_name='actions';                  -- expect 1 row
-- ============================================================
