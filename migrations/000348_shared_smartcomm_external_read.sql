-- ============================================================
-- MIGRATION 000348 — Smartcomm: thread handled on the platform itself
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- When a staff member answers an Instagram DM from the Instagram app
-- (not from the Hub), Meta reports it to our webhook as a message echo
-- (is_echo). The Hub now records that reply on the customer thread AND
-- must clear the thread's unread badge for the whole team — the
-- conversation was handled, just not here.
--
-- Per-staffer read cursors (channel_members.last_read_at) can't express
-- that: they only exist for staff who have opened the thread in the Hub,
-- and an app-side reply is nobody's in-Hub read. So the channel itself
-- carries a single "handled externally up to" watermark:
--
--   external_read_at — messages created at or before this instant are
--   treated as read by EVERY staff viewer. Customer messages arriving
--   AFTER it count as unread again, so an opened-but-unanswered thread
--   keeps its badge (exactly the desired behaviour — Meta sends no
--   webhook for a staffer merely reading in the app; the echo of an
--   actual reply is the only "handled" signal that exists).
--
-- Consumed by smartcomm.repo.listChannelsForUser + unreadCountForUser
-- (GREATEST(cm.last_read_at, c.external_read_at)).
--
-- Idempotent: guarded with IF NOT EXISTS throughout.
-- ============================================================

ALTER TABLE shared.message_channels
  ADD COLUMN IF NOT EXISTS external_read_at TIMESTAMPTZ;

COMMENT ON COLUMN shared.message_channels.external_read_at IS
  'Thread answered on the external platform (e.g. Instagram app) up to this instant — messages at/before it count as read for every staff viewer. Advanced by the message-echo ingest; never moves backwards.';

-- ============================================================
-- Verify
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'shared' AND table_name = 'message_channels'
--   AND column_name = 'external_read_at';
-- ============================================================
