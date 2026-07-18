-- ============================================================
-- MIGRATION 000361 — allow senderless platform-echo messages
-- ============================================================
-- Instagram app-reply echoes are recorded as BUSINESS-side bubbles with
-- no sender: there is no Hub user to credit (the reply was typed in the
-- Instagram app itself), and crediting the customer contact would flip
-- the bubble's meaning to "the customer said this".
--
-- The original message_sender_check (000004) only allowed a senderless
-- row for message_type = 'system', so EVERY echo insert failed with a
-- check-constraint violation — the silent killer behind "replies sent
-- from the Instagram app never appear in the Hub": the webhooks arrived,
-- the ingest parsed them, and the final INSERT was rejected on every
-- outbox retry (118 failed batches found on prod by
-- `npm run diag:instagram-echoes`).
--
-- Fix: also allow a senderless row when the message carries a platform
-- origin stamp (metadata.via — e.g. 'instagram_app'). That key is set
-- exclusively server-side by recordAgentReplyFromPlatform; the composer's
-- metadata whitelist (sanitiseMessageMetadata) cannot forge it over HTTP.

ALTER TABLE shared.messages
  DROP CONSTRAINT IF EXISTS message_sender_check;

ALTER TABLE shared.messages
  ADD CONSTRAINT message_sender_check CHECK (
    (sender_user_id IS NOT NULL AND sender_contact_id IS NULL) OR
    (sender_user_id IS NULL AND sender_contact_id IS NOT NULL) OR
    (sender_user_id IS NULL AND sender_contact_id IS NULL AND
      (message_type = 'system' OR metadata->>'via' IS NOT NULL))
  );
