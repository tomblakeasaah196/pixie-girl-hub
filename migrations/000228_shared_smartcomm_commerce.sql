-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 000228 — Smartcomm: in-chat commerce (product_share, send_invoice)   ║
-- ║                                                                      ║
-- ║ Extends the message_type CHECK to accept two commerce kinds:         ║
-- ║                                                                      ║
-- ║   • product_share  — a carousel of products/services that the rep    ║
-- ║                      sent into the thread. Cards live in             ║
-- ║                      messages.metadata.products[] (JSONB, already on ║
-- ║                      the table); each card carries kind/id/name/     ║
-- ║                      price/image and an optional capture_url so the  ║
-- ║                      customer can tap-to-order via the existing JWT  ║
-- ║                      order-capture flow shipped in PR-4.             ║
-- ║                                                                      ║
-- ║   • send_invoice   — a card that links a posted invoice into the     ║
-- ║                      thread (invoice_number + amount_due + due_date  ║
-- ║                      + PDF url) so the customer can pay without      ║
-- ║                      hunting in email. The invoice itself lives in   ║
-- ║                      <brand>.invoices; the chat row just references  ║
-- ║                      it through metadata.invoice_id.                 ║
-- ║                                                                      ║
-- ║ Also refreshes the inbox preview trigger to render the new kinds     ║
-- ║ (otherwise channels would say "" for the last-message line).         ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

ALTER TABLE shared.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE shared.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN (
    'text','image','document','voice_note','video','sticker','system',
    'product_share','send_invoice'
  ));

-- Refresh the preview trigger added in 000213 to handle the new kinds.
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

COMMIT;
