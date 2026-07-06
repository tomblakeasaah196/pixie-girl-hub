-- ============================================================
-- MIGRATION 000290 — Instagram 24-hour service window
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Adds the sibling of wa_window_expires_at for Instagram
-- Messenger, and extends the inbound trigger from 000213 so both
-- WhatsApp AND Instagram customer threads have their service
-- window kept fresh. Meta enforces the same 24-hour rule on
-- Instagram Direct: free-form replies allowed inside the window,
-- HUMAN_AGENT-tagged messages only outside.
--
-- Nothing to backfill — ig_window_expires_at defaults to NULL
-- (meaning "no inbound yet"), and the trigger stamps it forward
-- on every new customer message.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. Extend message_channels                                        ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.message_channels
  ADD COLUMN IF NOT EXISTS ig_window_expires_at TIMESTAMPTZ;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. Refresh trigger — one function, both platforms                 ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Replaces the WA-only function from 000213 with a version that
-- stamps whichever *_window_expires_at matches the channel's
-- external_platform. Old triggers pointing at
-- fn_smartcomm_refresh_wa_window keep working because we replace
-- the function body — no drop/recreate on the trigger.

CREATE OR REPLACE FUNCTION shared.fn_smartcomm_refresh_wa_window()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sender_contact_id IS NOT NULL THEN
    UPDATE shared.message_channels
       SET wa_window_expires_at = CASE
             WHEN external_platform = 'whatsapp'
             THEN NEW.created_at + interval '24 hours'
             ELSE wa_window_expires_at
           END,
           ig_window_expires_at = CASE
             WHEN external_platform = 'instagram'
             THEN NEW.created_at + interval '24 hours'
             ELSE ig_window_expires_at
           END
     WHERE channel_id = NEW.channel_id
       AND channel_type = 'customer_thread';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- Verify
--   SELECT column_name
--     FROM information_schema.columns
--    WHERE table_schema = 'shared'
--      AND table_name = 'message_channels'
--      AND column_name = 'ig_window_expires_at';
-- ============================================================
