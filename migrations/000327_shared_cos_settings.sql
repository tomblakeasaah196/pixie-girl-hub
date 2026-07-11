-- ============================================================
-- MIGRATION 000327 — Chief of Staff: personalisation settings (PR6)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- The one table behind PR6's personality/polish layer:
--
--   shared.cos_settings — the CEO's per-user Chief of Staff preferences:
--     • naming/tone/pronoun/avatar   (§ naming propagation — CoS ONLY)
--     • work + quiet hours, timezone (drives the accountability scheduler)
--     • morning-brief / evening-review times
--     • celebrate_wins + adaptive_timing toggles (wow #8)
--
-- One row per user, PK = user_id (a lazy default row is created on first CoS
-- use, so the table can ship empty). Every column has a sensible DEFAULT, so a
-- missing row is equivalent to all-defaults everywhere it is read.
--
-- Naming is CoS-only: this table never touches Praxis. Notification TYPES for
-- the per-type/channel prefs UI (cos_briefing / cos_followup / cos_celebration)
-- need no seed — shared.notification_preferences defaults every unknown type to
-- on (isChannelEnabled returns true when no row exists), and the admin prefs UI
-- discovers types from its NOTIF_META map.
--
-- See docs/AI_CHIEF_OF_STAFF_IMPLEMENTATION.md §1.9 and PR6.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.cos_settings (
  user_id           UUID        PRIMARY KEY REFERENCES shared.users (user_id) ON DELETE CASCADE,
  assistant_name    TEXT        NOT NULL DEFAULT 'Chief of Staff',
  tone              TEXT        NOT NULL DEFAULT 'warm'
                    CHECK (tone IN ('warm','concise','formal')),
  avatar_url        TEXT,
  pronoun           TEXT        NOT NULL DEFAULT 'she'
                    CHECK (pronoun IN ('she','he','they','it')),
  work_start        TIME        NOT NULL DEFAULT '08:00',
  work_end          TIME        NOT NULL DEFAULT '18:00',
  timezone          TEXT        NOT NULL DEFAULT 'Africa/Lagos',
  morning_brief_at  TIME        NOT NULL DEFAULT '07:00',
  evening_review_at TIME        NOT NULL DEFAULT '18:00',
  quiet_start       TIME        NOT NULL DEFAULT '21:00',
  quiet_end         TIME        NOT NULL DEFAULT '06:00',
  celebrate_wins    BOOLEAN     NOT NULL DEFAULT true,
  adaptive_timing   BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cos_settings_updated_at
  BEFORE UPDATE ON shared.cos_settings
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ============================================================
-- Verify
--   SELECT to_regclass('shared.cos_settings');   -- not null
-- EXPECTED_SHARED: 196 → 197 (cos_settings is the only new table).
-- ============================================================
