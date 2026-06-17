-- ============================================================
-- MIGRATION — Add email_from_address to shared.business_config
-- ============================================================

ALTER TABLE shared.business_config
  ADD COLUMN IF NOT EXISTS email_from_address TEXT;

-- Seed sensible defaults for existing brands
UPDATE shared.business_config
SET email_from_address = CASE business_key
  WHEN 'pixiegirl'   THEN 'noreply@pixiegirlglobal.com'
  WHEN 'faitlynhair' THEN 'noreply@thefaitlynbrand.com'
  ELSE NULL
END
WHERE email_from_address IS NULL;