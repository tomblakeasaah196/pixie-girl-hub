-- ============================================================
-- MIGRATION 000223 — Add social-media handles to shared.contacts
-- so the directory can capture an Instagram / TikTok / Facebook
-- handle alongside phone, WhatsApp, and email. Used by Smartcomm
-- (DM threading) and by the contact card.
-- ============================================================

ALTER TABLE shared.contacts
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_handle    TEXT,
  ADD COLUMN IF NOT EXISTS facebook_handle  TEXT;

-- Case-insensitive lookup index (handles are user-facing identifiers,
-- so the index is partial to skip NULLs which dominate the table).
CREATE INDEX IF NOT EXISTS idx_contacts_instagram_handle
  ON shared.contacts (LOWER(instagram_handle))
  WHERE instagram_handle IS NOT NULL;
