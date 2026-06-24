-- ============================================================
-- MIGRATION 000238 — Fulfilment timeframe settings
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- The post-payment order-confirmation email (services/order-confirmation-email.js,
-- fired off the `order.paid` outbox event) tells the buyer WHEN to expect their
-- order: a delivery ETA when they chose delivery, or a collection window when
-- they chose store pickup.
--
-- Those timeframes must be editable per brand from Settings rather than baked
-- into code, so this adds one Settings-driven JSONB blob on business_config.
-- The defaults below are sensible launch values; the CEO can tune them in
-- Business Setup without a deploy.
--
--   fulfilment_settings.delivery.{lagos,nigeria,international,default}
--       — human ETA phrases, chosen by the order's delivery zone.
--   fulfilment_settings.delivery.intro
--       — one warm line shown above the ETA.
--   fulfilment_settings.pickup.{ready_in,hours,instructions}
--       — when the order is ready, the collection hours, and what to bring.
-- ============================================================

ALTER TABLE shared.business_config
  ADD COLUMN IF NOT EXISTS fulfilment_settings JSONB NOT NULL DEFAULT '{
    "delivery": {
      "intro": "Your order is now being carefully prepared and packed for dispatch.",
      "lagos": "1–2 business days",
      "nigeria": "3–5 business days",
      "international": "7–14 business days",
      "default": "3–5 business days"
    },
    "pickup": {
      "ready_in": "within 24 hours",
      "hours": "Monday–Saturday, 9:00am – 6:00pm",
      "instructions": "Please bring your order number and a valid means of identification when you come to collect."
    }
  }'::jsonb;

COMMENT ON COLUMN shared.business_config.fulfilment_settings IS
  'Settings-driven fulfilment timeframes used by the order-confirmation email. '
  'delivery.{lagos,nigeria,international,default} are ETA phrases keyed off the '
  'order delivery zone; pickup.{ready_in,hours,instructions} describe in-store '
  'collection. Editable per brand in Business Setup.';

-- Belt-and-braces: backfill any existing rows that predate the column default
-- (ADD COLUMN ... DEFAULT already backfills, but keep idempotent for replays).
UPDATE shared.business_config
   SET fulfilment_settings = '{
    "delivery": {
      "intro": "Your order is now being carefully prepared and packed for dispatch.",
      "lagos": "1–2 business days",
      "nigeria": "3–5 business days",
      "international": "7–14 business days",
      "default": "3–5 business days"
    },
    "pickup": {
      "ready_in": "within 24 hours",
      "hours": "Monday–Saturday, 9:00am – 6:00pm",
      "instructions": "Please bring your order number and a valid means of identification when you come to collect."
    }
  }'::jsonb
 WHERE fulfilment_settings IS NULL
    OR fulfilment_settings = '{}'::jsonb;
