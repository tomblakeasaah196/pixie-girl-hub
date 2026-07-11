-- ============================================================
-- 000326_shared_recruitment_signatory
--
-- Recruitment offer-letter polish.
--
-- Two things: (1) let the person who countersigns offers (Faith / Faitlyn Alex)
-- capture her actual handwritten e-signature ONCE — stored as an inline data
-- URL on the recruitment context — so it's stamped onto every offer packet
-- automatically, side-by-side with the candidate's own signature. (2) nudge the
-- seeded default signatory name from a single first name to the full name the
-- CEO gave us, but only where the row is still on the literal default so we
-- don't overwrite a name the admin has already edited.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS and a conditional UPDATE.
-- ============================================================

ALTER TABLE shared.recruitment_context
  ADD COLUMN IF NOT EXISTS signatory_signature_data_url TEXT;

-- Only replace the literal seeded default. If HR has already changed it, leave
-- it alone — this migration is safe to re-run on every deploy.
UPDATE shared.recruitment_context
   SET signatory_name = 'Faitlyn Alex'
 WHERE signatory_name = 'Faith';
