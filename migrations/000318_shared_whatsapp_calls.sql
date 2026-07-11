-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 000318 — WhatsApp Business Calling (inbound voice, V2.2 §6.17)     ║
-- ╠════════════════════════════════════════════════════════════════════╣
-- ║ Meta's Cloud API Calling feature: customers tap the call button in ║
-- ║ the brand's WhatsApp chat and the call is answered by staff in the ║
-- ║ Hub browser over WebRTC. Calls live in `shared` next to the rest   ║
-- ║ of the messaging domain (message_channels / messages / contacts)   ║
-- ║ and carry a `business` column for brand isolation, exactly like    ║
-- ║ message_channels does.                                             ║
-- ║                                                                    ║
-- ║ 1. shared.whatsapp_calls        — one row per call (state machine) ║
-- ║ 2. shared.whatsapp_call_events  — raw webhook/action audit trail   ║
-- ║ 3. messages_message_type_check  — allow the 'call' timeline card   ║
-- ║ 4. fn_smartcomm_touch_channel   — inbox preview for call cards     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── 1. whatsapp_calls ────────────────────────────────────────
-- Status machine (inbound):
--   ringing → in_progress → completed          (answered, then hung up)
--   ringing → missed                           (nobody answered in time)
--   ringing → rejected                         (staff declined)
--   ringing/in_progress → failed               (provider/media error)
CREATE TABLE shared.whatsapp_calls (
  call_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  -- Meta's call id ("wacid...."): the idempotency anchor for webhooks.
  wa_call_id            TEXT        NOT NULL UNIQUE,
  contact_id            UUID        REFERENCES shared.contacts (contact_id) ON DELETE SET NULL,
  channel_id            UUID        REFERENCES shared.message_channels (channel_id) ON DELETE SET NULL,
  -- The 'call' card recorded on the customer thread (timeline entry).
  message_id            UUID        REFERENCES shared.messages (message_id) ON DELETE SET NULL,
  direction             TEXT        NOT NULL DEFAULT 'inbound'
                        CHECK (direction IN ('inbound','outbound')),
  status                TEXT        NOT NULL DEFAULT 'ringing'
                        CHECK (status IN ('ringing','in_progress','completed','missed','rejected','failed')),
  from_number           TEXT,
  to_number             TEXT,
  caller_name           TEXT,
  -- SDP offer from Meta's connect webhook. Held server-side and handed
  -- to exactly one claiming agent's browser; cleared once the call ends.
  sdp_offer             TEXT,
  answered_by           UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  answered_at           TIMESTAMPTZ,
  -- Rang past the conversation owner out to every online agent.
  escalated_at          TIMESTAMPTZ,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at              TIMESTAMPTZ,
  duration_seconds      INTEGER,
  -- Meta's terminate status (COMPLETED/FAILED/…) or a local reason
  -- (rejected_by_agent, stale_no_terminate, accept_failed).
  end_reason            TEXT,
  -- Post-call disposition, recorded by the answering agent (mandatory in
  -- the UI). NULL until recorded.
  outcome               TEXT        CHECK (outcome IN
                        ('deal_closed','order_placed','follow_up','enquiry','complaint','wrong_number','other')),
  outcome_notes         TEXT,
  outcome_recorded_by   UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  outcome_recorded_at   TIMESTAMPTZ,
  -- Missed-call follow-ups (§ option 4a): auto WhatsApp reply + CRM task.
  auto_reply_sent       BOOLEAN     NOT NULL DEFAULT false,
  missed_task_id        UUID,       -- soft ref → shared.tasks (task may be deleted independently)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_whatsapp_calls_updated_at
  BEFORE UPDATE ON shared.whatsapp_calls
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

CREATE INDEX idx_whatsapp_calls_business_time ON shared.whatsapp_calls (business, started_at DESC);
CREATE INDEX idx_whatsapp_calls_contact       ON shared.whatsapp_calls (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_whatsapp_calls_ringing       ON shared.whatsapp_calls (started_at) WHERE status = 'ringing';
CREATE INDEX idx_whatsapp_calls_outcome_due   ON shared.whatsapp_calls (answered_by)
  WHERE status = 'completed' AND outcome IS NULL;

-- ── 2. whatsapp_call_events ──────────────────────────────────
-- Raw trail of everything that happened to a call: Meta webhook events
-- (connect/terminate/status) and our own actions (claimed, accepted,
-- rejected, hangup, escalated, auto_reply, task_created). Idempotency:
-- one row per (call, event) — webhook redelivery is a no-op.
CREATE TABLE shared.whatsapp_call_events (
  event_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id               UUID        NOT NULL REFERENCES shared.whatsapp_calls (call_id) ON DELETE CASCADE,
  event                 TEXT        NOT NULL,
  actor_user_id         UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  payload               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_whatsapp_call_events_dedup
  ON shared.whatsapp_call_events (call_id, event);
CREATE INDEX idx_whatsapp_call_events_call ON shared.whatsapp_call_events (call_id, created_at);

-- ── 3. Allow 'call' as a smartcomm message_type ──────────────
-- Every finished call (answered or missed) is recorded as a 'call' card
-- on the customer's thread, so the conversation shows the full story:
-- messages AND calls, in order. Extend the CHECK last set in 000313.
ALTER TABLE shared.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE shared.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN (
    'text','image','document','voice_note','video','sticker','system',
    'product_share','send_invoice','template','call'
  ));

-- ── 4. Teach the channel-preview trigger about call cards ────
CREATE OR REPLACE FUNCTION shared.fn_smartcomm_touch_channel()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  preview TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.content IS DISTINCT FROM NEW.content) THEN
    preview := CASE NEW.message_type
      WHEN 'image' THEN '📷 Photo'
      WHEN 'voice_note' THEN '🎤 Voice note'
      WHEN 'document' THEN '📄 Document'
      WHEN 'video' THEN '🎬 Video'
      WHEN 'sticker' THEN '🌟 Sticker'
      WHEN 'product_share' THEN '🛍️ Catalogue shared'
      WHEN 'send_invoice' THEN '📜 Invoice sent'
      WHEN 'template' THEN COALESCE(NULLIF(LEFT(COALESCE(NEW.content, ''), 140), ''), '📋 Template sent')
      WHEN 'call' THEN COALESCE(NULLIF(LEFT(COALESCE(NEW.content, ''), 140), ''), '📞 WhatsApp call')
      WHEN 'system' THEN COALESCE(NEW.content, '')
      ELSE LEFT(COALESCE(NEW.content, ''), 140)
    END;
    UPDATE shared.message_channels
       SET last_message_at      = NEW.created_at,
           last_message_preview = preview,
           last_message_kind    = NEW.message_type,
           updated_at           = now()
     WHERE channel_id = NEW.channel_id
       AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- Verify
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'shared'
--      AND table_name IN ('whatsapp_calls','whatsapp_call_events');
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'messages_message_type_check';
-- ============================================================
