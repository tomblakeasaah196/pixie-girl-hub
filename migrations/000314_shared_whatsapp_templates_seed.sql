-- ============================================================
-- MIGRATION 000314 — Seed starter WhatsApp message templates
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Gives both brands a ready-made library of the templates a hair /
-- beauty store actually uses to reach customers outside the 24-hour
-- window: order + delivery updates (UTILITY) and re-engagement
-- promos (MARKETING).
--
-- Every row is seeded as LOCAL_DRAFT — a template can only be *sent*
-- once Meta approves it, and approval happens on Meta's side. So these
-- land in Settings → WhatsApp Templates as polished drafts the CEO
-- reviews and hits "Submit to Meta" on (or edits first). Once Meta
-- marks one APPROVED, it appears in the composer's template picker.
--
-- Idempotent: ON CONFLICT (business, name, language) DO NOTHING, so a
-- re-run (or a brand that already authored one of these names) is a
-- no-op and never clobbers an operator's edits.
--
-- Body copy uses Meta's positional {{1}} {{2}} placeholders, filled in
-- at send time. The `variables` column mirrors which indices each body
-- uses so the send-time UI knows what to prompt for.
-- ============================================================

WITH brands (business, brand_name, shop_url) AS (
  VALUES
    ('pixiegirl',   'Pixie Girl',   'https://pixiegirlglobal.com'),
    ('faitlynhair', 'Faitlyn Hair', 'https://thefaitlynbrand.com')
),
tpl (name, category, header, body, button_label, variables) AS (
  VALUES
    -- ── UTILITY: transactional order/delivery updates ──────────
    (
      'order_confirmation', 'UTILITY', '',
      'Hi {{1}}, thank you for your order {{2}}! We''ve received it — your total is {{3}}. We''ll let you know the moment it ships. 🌹',
      '', '[1,2,3]'
    ),
    (
      'order_shipped', 'UTILITY', 'Your order is on its way 🚚',
      'Hi {{1}}, great news — your order {{2}} has shipped and should reach you within {{3}}. Thank you for shopping with us!',
      '', '[1,2,3]'
    ),
    (
      'out_for_delivery', 'UTILITY', '',
      'Hi {{1}}, your order {{2}} is out for delivery today. Please keep your line open so our courier can reach you. 📦',
      '', '[1,2]'
    ),
    (
      'payment_reminder', 'UTILITY', '',
      'Hi {{1}}, a friendly reminder that {{2}} is still outstanding on your order {{3}}. You can pay any amount, anytime, from your secure link. Thank you!',
      '', '[1,2,3]'
    ),
    (
      'payment_received', 'UTILITY', '',
      'Hi {{1}}, we''ve received your payment of {{2}} for order {{3}} — thank you! Your remaining balance is {{4}}.',
      '', '[1,2,3,4]'
    ),
    -- ── MARKETING: re-engagement & promotions ──────────────────
    (
      'welcome_offer', 'MARKETING', '',
      'Hi {{1}} 🌹 Welcome to the family! Enjoy {{2}} off your first order with code {{3}}. Reply here anytime — we''d love to help you find your perfect look.',
      'Shop now', '[1,2,3]'
    ),
    (
      'back_in_stock', 'MARKETING', '',
      'Good news {{1}} — {{2}} is back in stock! Grab yours before it sells out again. 💕',
      'Shop now', '[1,2]'
    ),
    (
      'we_miss_you', 'MARKETING', '',
      'Hi {{1}}, we miss you! Here''s {{2}} off to welcome you back — use code {{3}} before {{4}}. ✨',
      'Shop now', '[1,2,3,4]'
    )
)
INSERT INTO shared.whatsapp_templates
  (business, name, language, category, status, components, body_text, variables)
SELECT
  b.business,
  t.name,
  'en_US',
  t.category,
  'LOCAL_DRAFT',
  -- Assemble Meta's components array from the parts: optional text
  -- header, required body, a brand-name footer, and an optional URL
  -- button pointing at the brand's storefront.
  (CASE WHEN t.header <> ''
        THEN jsonb_build_array(jsonb_build_object(
               'type', 'HEADER', 'format', 'TEXT', 'text', t.header))
        ELSE '[]'::jsonb END)
  || jsonb_build_array(jsonb_build_object('type', 'BODY', 'text', t.body))
  || jsonb_build_array(jsonb_build_object('type', 'FOOTER', 'text', b.brand_name))
  || (CASE WHEN t.button_label <> ''
        THEN jsonb_build_array(jsonb_build_object(
               'type', 'BUTTONS',
               'buttons', jsonb_build_array(jsonb_build_object(
                 'type', 'URL', 'text', t.button_label, 'url', b.shop_url))))
        ELSE '[]'::jsonb END),
  t.body,
  t.variables::jsonb
FROM brands b
CROSS JOIN tpl t
ON CONFLICT (business, name, language) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT business, name, category, status
--     FROM shared.whatsapp_templates
--    ORDER BY business, category, name;
--   -- expect 8 rows per brand (5 UTILITY, 3 MARKETING) = 16 total
-- ============================================================
