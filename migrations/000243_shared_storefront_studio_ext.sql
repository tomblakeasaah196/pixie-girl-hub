-- ============================================================
-- 000243_shared_storefront_studio_ext
-- Pixie Girl Hub · JBS Praxis
--
-- Storefront Studio extensions (V2.2 §6.28). The base Studio surfaces — theme
-- tokens, pages/templates, navigation, revisions — already exist in
-- 000010_shared_storefront. This migration adds two structured surfaces the
-- Studio manages for the Storefront Website:
--
--   storefront_popups            — newsletter AND other popups (exit-intent,
--                                  promo, age-gate) with configurable triggers,
--                                  audience and frequency rules. Draft/publish
--                                  per brand, mirroring storefront_themes.
--   storefront_section_templates — the reusable section/template library the
--                                  page composer offers ("be a studio designer").
--                                  Global library (not per-brand); pages clone
--                                  default_slots into their own slots.
--
-- SEO/socials live on storefront_pages (meta_*, og_image_url) + navigation
-- (socials); logos/favicons/OG default live on business_config + theme tokens.
-- Those need no new tables — the Studio just exposes them.
--
-- Stripe needs NO migration: shared.payment_gateways.provider already includes
-- 'stripe' (000116) and 000115 added the 'stripe_card' sales method. Only the
-- service + webhook handler are outstanding (guide §6.4, Phase 2).
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS; DROP TRIGGER then CREATE.
-- ============================================================

-- ── Popups (newsletter + others), draft/published per brand ──────────────
CREATE TABLE IF NOT EXISTS shared.storefront_popups (
  popup_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business      TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','published','archived')),
  popup_key     TEXT        NOT NULL,                  -- 'newsletter','exit_intent','promo','age_gate'
  trigger_type  TEXT        NOT NULL
                CHECK (trigger_type IN ('time_delay','scroll_depth','exit_intent','page_load','add_to_cart')),
  trigger_value INTEGER,                               -- seconds | percent | NULL (depends on trigger_type)
  audience      TEXT        NOT NULL DEFAULT 'all'
                CHECK (audience IN ('all','new','returning','guest','member')),
  content       JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- heading, body, image_url, cta, coupon_code, fields[]
  display_rules JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- frequency cap, pages[], schedule window
  display_order SMALLINT    NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_by    UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  published_at  TIMESTAMPTZ,
  published_by  UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_storefront_popups_updated_at ON shared.storefront_popups;
CREATE TRIGGER trg_storefront_popups_updated_at
  BEFORE UPDATE ON shared.storefront_popups
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- At most one published, and one draft, per (business, popup_key) — mirrors the
-- one-draft/one-published pattern used for themes/pages in 000010.
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_popups_published
  ON shared.storefront_popups (business, popup_key) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_popups_draft
  ON shared.storefront_popups (business, popup_key) WHERE status = 'draft';
-- The website reads the active published set for a brand.
CREATE INDEX IF NOT EXISTS idx_storefront_popups_live
  ON shared.storefront_popups (business, display_order)
  WHERE status = 'published' AND is_active = true;

-- ── Reusable section/template library (global; pages clone from it) ───────
CREATE TABLE IF NOT EXISTS shared.storefront_section_templates (
  template_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key      TEXT        NOT NULL UNIQUE,       -- 'hero_split_v1','shade_grid_v1','testimonial_carousel_v1'
  category          TEXT        NOT NULL,              -- 'hero','grid','editorial','social_proof','cta','faq'
  display_name      TEXT        NOT NULL,
  description       TEXT,
  preview_image_url TEXT,
  default_slots     JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- starter content the editor clones
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  display_order     SMALLINT    NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_storefront_section_templates_updated_at ON shared.storefront_section_templates;
CREATE TRIGGER trg_storefront_section_templates_updated_at
  BEFORE UPDATE ON shared.storefront_section_templates
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_storefront_section_templates_active
  ON shared.storefront_section_templates (category, display_order) WHERE is_active = true;
