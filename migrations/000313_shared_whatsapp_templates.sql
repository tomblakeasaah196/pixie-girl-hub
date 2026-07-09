-- ============================================================
-- MIGRATION 000313 — WhatsApp approved templates + category rates
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Meta only lets a business send outside the 24-hour customer-care
-- window with a PRE-APPROVED message template. Until now the Hub had
-- no place to author, submit, or review those templates — the inbox
-- just told the rep "send an approved template" with nowhere to
-- manage them.
--
-- This migration adds two tables, both per-brand and living in the
-- shared schema alongside shared.messaging_accounts (the WhatsApp /
-- IG / FB / email key vault):
--
--   shared.whatsapp_templates       — a local mirror of each brand's
--                                     Meta message templates. Rows are
--                                     authored in the Hub (LOCAL_DRAFT),
--                                     submitted to Meta (PENDING), and
--                                     kept in sync with Meta's review
--                                     verdict (APPROVED / REJECTED / …).
--
--   shared.whatsapp_template_rates  — the per-brand NGN cost of one
--                                     template send, by billing
--                                     category. Marketing costs more
--                                     than Utility; the UI shows the
--                                     price next to every template so
--                                     the operator knows what a send
--                                     will cost before they hit send.
--
-- Gated by the existing `messaging_accounts` permission key — these
-- live under the same Messaging settings surface, so no new module is
-- introduced (keeps the RBAC catalogue SSOT unchanged).
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. whatsapp_templates — per-brand mirror of Meta templates        ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.whatsapp_templates (
  template_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business         TEXT        NOT NULL,
  -- Meta's own template id (a.k.a. hsm_id). NULL until the draft is
  -- submitted to Meta or discovered via sync.
  meta_template_id TEXT,
  -- Template name: lowercase snake_case, Meta's addressing key. Unique
  -- per (brand, name, language) — Meta allows one template per name per
  -- language.
  name             TEXT        NOT NULL,
  language         TEXT        NOT NULL DEFAULT 'en_US',
  -- Meta billing/approval category. Drives the send cost.
  category         TEXT        NOT NULL DEFAULT 'UTILITY'
                   CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  -- Lifecycle. LOCAL_DRAFT is a Hub-only state before submission; the
  -- rest mirror Meta's template status enum.
  status           TEXT        NOT NULL DEFAULT 'LOCAL_DRAFT'
                   CHECK (status IN ('LOCAL_DRAFT','PENDING','APPROVED',
                                     'REJECTED','PAUSED','DISABLED','IN_APPEAL')),
  -- Meta components array: HEADER / BODY / FOOTER / BUTTONS objects.
  components       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Convenience mirror of the BODY component text so lists/search don't
  -- have to dig into the JSON.
  body_text        TEXT,
  -- {{1}}, {{2}} … positional variables detected in the body, so the
  -- send-time UI can prompt for them.
  variables        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Meta's quality signal (GREEN / YELLOW / RED) and rejection reason.
  quality_score    TEXT,
  rejected_reason  TEXT,
  last_synced_at   TIMESTAMPTZ,
  created_by       UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, name, language)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_business
  ON shared.whatsapp_templates (business, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_meta
  ON shared.whatsapp_templates (meta_template_id);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. whatsapp_template_rates — per-brand cost per category          ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.whatsapp_template_rates (
  rate_id     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  business    TEXT          NOT NULL,
  category    TEXT          NOT NULL
              CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION','SERVICE')),
  -- Cost of one template send in the smallest editable unit. NGN with
  -- 2dp, matching the money convention elsewhere in the Hub.
  amount_ngn  NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency    TEXT          NOT NULL DEFAULT 'NGN',
  note        TEXT,
  updated_by  UUID          REFERENCES shared.users (user_id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (business, category)
);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 3. Seed default rates for both brands                             ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Ballpark Meta Nigeria pricing (₦, editable in the UI): Marketing is
-- the premium tier, Utility the cheapest paid tier, Authentication in
-- between, and SERVICE (free-form inside the 24h window) is free. These
-- are starting points — the CEO tunes them per brand under
-- Settings → WhatsApp Templates.

INSERT INTO shared.whatsapp_template_rates (business, category, amount_ngn, note)
VALUES
  ('pixiegirl',   'MARKETING',      88.00, 'Promotional templates — premium tier'),
  ('pixiegirl',   'UTILITY',        11.00, 'Order/shipping/payment updates'),
  ('pixiegirl',   'AUTHENTICATION', 48.00, 'OTP / login codes'),
  ('pixiegirl',   'SERVICE',         0.00, 'Free-form replies inside the 24h window'),
  ('faitlynhair', 'MARKETING',      88.00, 'Promotional templates — premium tier'),
  ('faitlynhair', 'UTILITY',        11.00, 'Order/shipping/payment updates'),
  ('faitlynhair', 'AUTHENTICATION', 48.00, 'OTP / login codes'),
  ('faitlynhair', 'SERVICE',         0.00, 'Free-form replies inside the 24h window')
ON CONFLICT (business, category) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 4. Allow 'template' as a smartcomm message_type                   ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- When a rep sends an approved template into a customer thread (the
-- only way to reach them once the 24h window closes), the outbound
-- message is recorded with message_type 'template'. Extend the CHECK
-- (last set in 000228) and teach the channel-preview trigger about it.

ALTER TABLE shared.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE shared.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN (
    'text','image','document','voice_note','video','sticker','system',
    'product_share','send_invoice','template'
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
--      AND table_name IN ('whatsapp_templates','whatsapp_template_rates');
--   SELECT business, category, amount_ngn
--     FROM shared.whatsapp_template_rates ORDER BY business, category;
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'messages_message_type_check';
-- ============================================================
