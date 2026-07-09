-- ============================================================
-- MIGRATION 000309 — Internal messaging channels bypass brand RLS
-- Pixie Girl Hub · Messaging Smartcomm (V2.2 §6.17)
--
-- Source: production bug — a staff member on brand A never sees a DM
-- (or group message) sent by a colleague when the channel row's
-- `business` value is brand B. The recipient's inbox is empty, their
-- unread badge stays at 0, and the sender's tick sits at "sent" forever
-- because no one on the other end reads the message.
--
-- Root cause: migration 000200 auto-enables RLS on every `shared.*`
-- table that has a `business` column, with the policy
--
--   USING (current_business() IS NULL OR business = current_business())
--
-- `shared.message_channels` has such a column (000004). Internal chat
-- rows carry whichever brand was active when the channel was created —
-- but internal chat (direct DMs, staff groups) is NOT brand-owned data:
-- a colleague pairing spans both entities, and every staff member
-- should see the thread regardless of which brand they're currently
-- viewing.
--
-- Commit 77ea0f6 tried to solve this at the SQL WHERE clause layer of
-- `listChannelsForUser` (`c.business = brand OR c.channel_type !=
-- 'customer_thread'`), but RLS runs BEFORE the WHERE clause and had
-- already stripped the row from the result set — the app-layer OR
-- clause never had a chance to match. So the "cross-brand DM" fix
-- appeared to land but was still fully suppressed by the database
-- policy on read paths that use a request-bound (RLS-enforced)
-- connection.
--
-- Fix: replace the generic brand_isolation policy on
-- `shared.message_channels` with one that exempts internal channels
-- from the brand match. Customer threads still isolate by brand (they
-- ARE brand-owned — each customer belongs to one business's book).
--
-- Idempotent: DROP IF EXISTS then CREATE, so applying twice on the
-- same DB is a no-op.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS brand_isolation ON shared.message_channels;

CREATE POLICY brand_isolation ON shared.message_channels
  AS PERMISSIVE FOR ALL
  USING (
    shared.current_business() IS NULL
    OR channel_type IN ('direct', 'group')
    OR business = shared.current_business()
  )
  WITH CHECK (
    shared.current_business() IS NULL
    OR channel_type IN ('direct', 'group')
    OR business = shared.current_business()
  );

COMMENT ON POLICY brand_isolation ON shared.message_channels IS
  'V2.2 §6.17: customer threads isolate by brand; internal chat (direct DMs and staff groups) is visible to their members regardless of the viewer''s active brand — a colleague DM created on brand A must remain readable when either party switches to brand B.';

COMMIT;
