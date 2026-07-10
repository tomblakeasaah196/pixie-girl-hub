-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 000323 — Instagram story message types                                ║
-- ║                                                                        ║
-- ║ The Instagram webhook ingester records story mentions and story        ║
-- ║ replies with message_type 'ig_story_mention' / 'ig_story_reply'        ║
-- ║ (smartcomm.subscribers.parseMetaInstagram), and the service's          ║
-- ║ metadata whitelist + admin inbox already understand them — but the     ║
-- ║ messages_message_type_check CHECK never listed them, so every story    ║
-- ║ mention/reply failed the insert (23514), poisoned the outbox batch     ║
-- ║ and retried forever without ever reaching the inbox.                   ║
-- ║                                                                        ║
-- ║ Adds both types to the CHECK and teaches the channel-preview trigger   ║
-- ║ to render them. Supersets 000319 (whatsapp_calls): 'call' and its      ║
-- ║ preview line are preserved — this migration runs after it.             ║
-- ╚══════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE shared.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN (
    'text','image','document','voice_note','video','sticker','system',
    'product_share','send_invoice','template','call',
    'ig_story_mention','ig_story_reply'
  ));

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
      WHEN 'ig_story_mention' THEN '📣 Mentioned you in a story'
      WHEN 'ig_story_reply' THEN '💬 Replied to your story'
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
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'messages_message_type_check';
--   -- must list call + ig_story_mention + ig_story_reply
