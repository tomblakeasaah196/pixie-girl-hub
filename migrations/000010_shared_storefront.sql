-- ============================================================
-- MIGRATION 000010 — Shared storefront, carts, order tracking
-- Pixie Girl Hub · JBS Praxis · V2.0
--
-- Storefront Studio (Module 6.28) — theme tokens + content slots
-- inside fixed Next.js templates. Per-brand drafts + revisions.
--
-- Carts live here because a customer is one identity across all
-- brands; the cart is keyed by (contact_id, business) so a single
-- shopper can hold a PXG cart and a FLH cart at the same time.
--
-- Order tracking (Module 6.23) — public token + sanitised timeline
-- visible without login. Real-time updates flow over Socket.io
-- on the room keyed by public_token.
--
-- Tables:
--   storefront_themes
--   storefront_pages
--   storefront_navigation
--   storefront_revisions
--   product_reviews              (cross-brand: same review module for both)
--   carts, cart_items
--   tracking_links
--   order_timeline_events
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ STOREFRONT STUDIO (Module 6.28)                                    ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── storefront_themes ────────────────────────────────────
-- One ACTIVE row per brand, plus optional draft rows. The active row
-- holds the currently-live theme; the draft (if any) is what the
-- editor is currently composing.
CREATE TABLE shared.storefront_themes (
  theme_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  status                TEXT        NOT NULL CHECK (status IN ('draft','published','archived')),
  -- Theme tokens (JSONB so new fields don't need migrations)
  -- {
  --   "colours": {"primary":"#0A1128","accent":"#00B8D9", ...},
  --   "typography": {"heading_font":"Playfair","body_font":"Inter",
  --                  "scale": {...}},
  --   "logo_url": "...",
  --   "favicon_url": "...",
  --   "buttons": {"radius":"6px","style":"solid", ...},
  --   "spacing_scale": {...}
  -- }
  tokens                JSONB       NOT NULL DEFAULT '{}'::jsonb,
  version               INTEGER     NOT NULL DEFAULT 1,
  -- Author/audit
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  published_by          UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  published_at          TIMESTAMPTZ,
  -- Soft link back to the previous published theme (for rollback)
  supersedes_id         UUID        REFERENCES shared.storefront_themes (theme_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_storefront_themes_updated_at
  BEFORE UPDATE ON shared.storefront_themes
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
-- One published theme per brand at any time
CREATE UNIQUE INDEX idx_storefront_themes_published_unique
  ON shared.storefront_themes (business) WHERE status = 'published';
-- At most one draft per brand
CREATE UNIQUE INDEX idx_storefront_themes_draft_unique
  ON shared.storefront_themes (business) WHERE status = 'draft';

-- ── storefront_pages ─────────────────────────────────────
-- One row per page (home, about, contact, lookbook, returns, etc.)
-- per brand, per status. template_key identifies the developer-
-- controlled Next.js template; slots holds the JSONB content
-- payload that fills the editable slots in that template.
CREATE TABLE shared.storefront_pages (
  page_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  page_key              TEXT        NOT NULL,                   -- 'home','about','contact','lookbook','returns'
  template_key          TEXT        NOT NULL,                   -- 'home_hero_v1','about_simple','contact_card'
  status                TEXT        NOT NULL CHECK (status IN ('draft','published','archived')),
  -- URL path on the storefront (e.g. '/' for home, '/about', '/contact')
  url_path              TEXT        NOT NULL,
  -- Page-level SEO
  meta_title            TEXT,
  meta_description      TEXT,
  og_image_url          TEXT,
  -- Editable slot content. The shape is template-specific; the
  -- template knows which slot keys it expects.
  --   { "hero": {...}, "featured_collections": [...], "banner_strip": {...} }
  slots                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Author/audit
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  published_by          UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  published_at          TIMESTAMPTZ,
  supersedes_id         UUID        REFERENCES shared.storefront_pages (page_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_storefront_pages_updated_at
  BEFORE UPDATE ON shared.storefront_pages
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE UNIQUE INDEX idx_storefront_pages_published_unique
  ON shared.storefront_pages (business, page_key) WHERE status = 'published';
CREATE UNIQUE INDEX idx_storefront_pages_draft_unique
  ON shared.storefront_pages (business, page_key) WHERE status = 'draft';
CREATE INDEX idx_storefront_pages_path
  ON shared.storefront_pages (business, url_path) WHERE status = 'published';

-- ── storefront_navigation ────────────────────────────────
-- Header and footer menu structure. A single brand has one published
-- nav set; draft edits land in a second row with status='draft'.
CREATE TABLE shared.storefront_navigation (
  nav_id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  status                TEXT        NOT NULL CHECK (status IN ('draft','published','archived')),
  -- Hierarchical menu: [
  --   {"label":"Wigs","url":"/wigs","children":[{"label":"HD Lace","url":"/wigs/hd-lace"}]},
  --   ...
  -- ]
  header_items          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  footer_columns        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  socials               JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- {"instagram":"...","tiktok":"..."}
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  published_by          UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  published_at          TIMESTAMPTZ,
  supersedes_id         UUID        REFERENCES shared.storefront_navigation (nav_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_storefront_nav_updated_at
  BEFORE UPDATE ON shared.storefront_navigation
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE UNIQUE INDEX idx_storefront_nav_published_unique
  ON shared.storefront_navigation (business) WHERE status = 'published';
CREATE UNIQUE INDEX idx_storefront_nav_draft_unique
  ON shared.storefront_navigation (business) WHERE status = 'draft';

-- ── storefront_revisions ─────────────────────────────────
-- Append-only history of every publish event across themes/pages/nav.
-- Allows one-click rollback and per-publish audit.
CREATE TABLE shared.storefront_revisions (
  revision_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  entity_type           TEXT        NOT NULL CHECK (entity_type IN ('theme','page','navigation')),
  entity_id             UUID        NOT NULL,                   -- soft FK (CASCADE handled in service layer)
  -- Snapshot of the full record at publish time (tokens / slots / etc.)
  snapshot              JSONB       NOT NULL,
  published_by          UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  published_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_summary        TEXT
);
CREATE INDEX idx_storefront_revisions_entity
  ON shared.storefront_revisions (business, entity_type, entity_id, published_at DESC);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ PRODUCT REVIEWS (cross-brand because the module is shared)         ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── product_reviews ──────────────────────────────────────
-- product_id is a soft reference into the per-brand products table
-- (cannot be a FK because the target table lives in business schema).
-- The business column disambiguates which schema to look in.
CREATE TABLE shared.product_reviews (
  review_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  product_id            UUID        NOT NULL,                   -- soft FK → {business}.products
  variant_id            UUID,                                    -- soft FK → {business}.product_variants
  -- Author (verified-purchase reviews gate on a real sales_order)
  contact_id            UUID        NOT NULL REFERENCES shared.contacts (contact_id),
  sales_order_id        UUID,                                    -- soft FK → {business}.sales_orders
  is_verified_purchase  BOOLEAN     NOT NULL DEFAULT false,
  -- Review content
  rating                SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title                 TEXT,
  body                  TEXT,
  -- Customer-submitted photos (up to N — enforced in service)
  photo_urls            TEXT[]      NOT NULL DEFAULT '{}',
  -- Moderation
  status                TEXT        NOT NULL DEFAULT 'pending_moderation'
                        CHECK (status IN ('pending_moderation','approved','rejected','flagged')),
  moderation_notes      TEXT,
  moderated_by          UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  moderated_at          TIMESTAMPTZ,
  -- Helpfulness (for sorting on storefront)
  helpful_count         INTEGER     NOT NULL DEFAULT 0,
  unhelpful_count       INTEGER     NOT NULL DEFAULT 0,
  -- Anti-fraud
  submitter_ip          INET,
  submitter_device_fp   TEXT,
  is_deleted            BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_product_reviews_updated_at
  BEFORE UPDATE ON shared.product_reviews
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_product_reviews_product   ON shared.product_reviews (business, product_id, status, created_at DESC);
CREATE INDEX idx_product_reviews_contact   ON shared.product_reviews (contact_id);
CREATE INDEX idx_product_reviews_pending   ON shared.product_reviews (created_at DESC) WHERE status = 'pending_moderation';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CARTS (persistent, cross-brand)                                    ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── carts ────────────────────────────────────────────────
-- Guest carts: contact_id IS NULL, session_token identifies the cart.
-- Customer carts: contact_id NOT NULL.
-- A guest cart is merged into the customer cart at login/signup.
CREATE TABLE shared.carts (
  cart_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  contact_id            UUID        REFERENCES shared.contacts (contact_id) ON DELETE SET NULL,
  session_token         TEXT,                                    -- guest cart cookie value
  -- Display currency at the time the cart was last interacted with
  display_currency      TEXT        REFERENCES shared.currencies (currency_code),
  fx_rate_used          NUMERIC(15,6),
  -- Applied coupon (if any) — re-validated on checkout
  applied_coupon_id     UUID        REFERENCES shared.coupons (coupon_id) ON DELETE SET NULL,
  -- Customer self-service: shipping address picked
  delivery_address_id   UUID        REFERENCES shared.contact_addresses (address_id) ON DELETE SET NULL,
  -- Cart-recovery email tracking (Module 6.23)
  abandoned_at          TIMESTAMPTZ,                             -- set when last_interaction > 1h ago via cron
  recovery_email_sent_at TIMESTAMPTZ,
  recovered_at          TIMESTAMPTZ,
  last_interaction_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','abandoned','converted','expired')),
  converted_order_id    UUID,                                    -- soft FK → {business}.sales_orders
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cart_has_owner CHECK (contact_id IS NOT NULL OR session_token IS NOT NULL)
);
CREATE INDEX idx_carts_contact   ON shared.carts (contact_id, business, status) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_carts_session   ON shared.carts (session_token) WHERE session_token IS NOT NULL;
CREATE INDEX idx_carts_abandoned ON shared.carts (last_interaction_at)
  WHERE status = 'active' AND abandoned_at IS NULL;

-- One open cart per (contact, brand) for logged-in customers
CREATE UNIQUE INDEX idx_carts_one_active_per_contact
  ON shared.carts (contact_id, business)
  WHERE contact_id IS NOT NULL AND status = 'active';

-- ── cart_items ───────────────────────────────────────────
CREATE TABLE shared.cart_items (
  cart_item_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id               UUID        NOT NULL REFERENCES shared.carts (cart_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  -- Soft FKs to brand-schema products/variants (validated in service)
  product_id            UUID        NOT NULL,
  variant_id            UUID,
  quantity              INTEGER     NOT NULL CHECK (quantity > 0),
  -- Snapshot of name + image + display price at time of add
  product_name_snapshot TEXT        NOT NULL,
  variant_label_snapshot TEXT,
  thumbnail_url_snapshot TEXT,
  -- Pricing at add-to-cart time (snapshot; re-priced at checkout)
  unit_price_ngn        NUMERIC(14,2) NOT NULL,
  unit_display_price    NUMERIC(14,2),
  display_currency      TEXT        REFERENCES shared.currencies (currency_code),
  -- For custom orders that require styling, capture spec here so the
  -- production module can pick it up on order confirmation.
  custom_spec           JSONB,
  added_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cart_items_cart ON shared.cart_items (cart_id);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ ORDER TRACKING (Module 6.23 — public customer pages)               ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── tracking_links ───────────────────────────────────────
-- One per customer-visible order. The public_token is the unguessable
-- key exposed in customer URLs (/track/{token}). Token is rotateable
-- (revoke + reissue) without losing the underlying order.
CREATE TABLE shared.tracking_links (
  tracking_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token          TEXT        NOT NULL UNIQUE,             -- 32+ char unguessable
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  -- Soft FK → {business}.sales_orders
  sales_order_id        UUID        NOT NULL,
  customer_contact_id   UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE RESTRICT,
  -- Whether the customer has actually opened the link at least once
  first_viewed_at       TIMESTAMPTZ,
  view_count            INTEGER     NOT NULL DEFAULT 0,
  -- Revocation
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  revoked_at            TIMESTAMPTZ,
  revoked_reason        TEXT,
  expires_at            TIMESTAMPTZ,                             -- NULL = no expiry
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tracking_links_token  ON shared.tracking_links (public_token) WHERE is_active = true;
CREATE INDEX idx_tracking_links_order  ON shared.tracking_links (business, sales_order_id);
CREATE INDEX idx_tracking_links_contact ON shared.tracking_links (customer_contact_id);

-- ── timeline_event_codes ─────────────────────────────────
-- Canonical dictionary for event_code values used in
-- order_timeline_events. Seeded with the standard codes per V2 spec
-- but admin-extensible. Without this, "Weaving in Progress" vs
-- "Wig Weaving" would silently fracture the customer timeline.
-- Added as Amendment-8 (CHANGELOG 2026-05-27) to fix the implicit
-- taxonomy risk noted in the audit.
CREATE TABLE shared.timeline_event_codes (
  code                  TEXT        PRIMARY KEY,
  default_label         TEXT        NOT NULL,
  -- Which order types use this code
  applies_to_order_types TEXT[]     NOT NULL DEFAULT '{physical}',
  -- Stage grouping for the customer-facing tracker UI
  stage_group           TEXT        NOT NULL
                        CHECK (stage_group IN ('ordered','production','shipped','delivered','service','terminal')),
  -- Whether this stage is shown to customers by default (admin can override per event)
  default_customer_visible BOOLEAN  NOT NULL DEFAULT true,
  display_order         SMALLINT    NOT NULL DEFAULT 0,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  is_system_code        BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_timeline_event_codes_active
  ON shared.timeline_event_codes (stage_group, display_order)
  WHERE is_active = true;

-- ── order_timeline_events ────────────────────────────────
-- APPEND-ONLY event log per order. Customer-facing payload is the
-- sanitised projection of this; internal admin sees everything.
CREATE TABLE shared.order_timeline_events (
  event_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  -- Soft FK — sales_order_id lives in business schema
  sales_order_id        UUID        NOT NULL,
  -- Event code from a fixed extensible vocabulary in
  -- shared.timeline_event_codes. Examples for physical orders:
  --   order_placed | payment_received | weaving_started | quality_check
  --   left_china | arrived_lagos | with_stylist | styling_complete
  --   packed_for_dispatch | out_for_delivery | delivered | cancelled
  --   delayed | refunded
  -- FLH service orders use a different set:
  --   booked | consultation | in_progress | completed | cancelled
  event_code            TEXT        NOT NULL REFERENCES shared.timeline_event_codes (code) ON DELETE RESTRICT,
  label                 TEXT        NOT NULL,                    -- 'Left China — DHL'
  -- Source module that emitted the event (audit context)
  source_module         TEXT        NOT NULL,                    -- 'sales','production','logistics','stylist','manual'
  -- Customer-visible payload (sanitised — no costs / suppliers / stylist names)
  customer_payload      JSONB,
  -- Internal payload (full details — courier ref, stylist id, etc.)
  internal_payload      JSONB,
  -- Whether to surface this event on the public tracking page
  is_customer_visible   BOOLEAN     NOT NULL DEFAULT true,
  -- Recorded user (NULL for system-generated events)
  recorded_by           UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_timeline_order
  ON shared.order_timeline_events (business, sales_order_id, occurred_at);
CREATE INDEX idx_order_timeline_customer_visible
  ON shared.order_timeline_events (business, sales_order_id, occurred_at)
  WHERE is_customer_visible = true;
CREATE INDEX idx_order_timeline_code ON shared.order_timeline_events (event_code, occurred_at DESC);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CUSTOMER WISHLISTS — V2.2 §6.4 page 575 (Amendment A-5)            ║
-- ║ "Customer Accounts with order history, wishlist, loyalty, ..."     ║
-- ║ Shared so a contact can wishlist items from either brand. The      ║
-- ║ variant_id is a soft FK (per-brand) — the storefront resolver      ║
-- ║ knows which brand schema to query from the `business` column.      ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE shared.customer_wishlists (
  wishlist_item_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  -- Soft FK to per-brand product_variants (variant_id resolved via business)
  variant_id            UUID        NOT NULL,
  -- Snapshot at the time of adding (for display when variant later disappears)
  product_name_snapshot TEXT,
  variant_label_snapshot TEXT,
  price_at_add_ngn      NUMERIC(14,2),
  -- Notes & priority (admin extensibility)
  notes                 TEXT,
  priority              SMALLINT    NOT NULL DEFAULT 0,
  -- Lifecycle
  added_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_back_in_stock_at TIMESTAMPTZ,
  removed_at            TIMESTAMPTZ,
  removed_reason        TEXT CHECK (removed_reason IN ('purchased','customer_removed','variant_archived','expired',NULL)),
  UNIQUE (contact_id, business, variant_id)
);
CREATE INDEX idx_customer_wishlists_contact
  ON shared.customer_wishlists (contact_id, business, added_at DESC)
  WHERE removed_at IS NULL;
CREATE INDEX idx_customer_wishlists_variant
  ON shared.customer_wishlists (business, variant_id)
  WHERE removed_at IS NULL;

-- Storefront role grants (read public catalogue tables + write own carts)
GRANT SELECT ON
  shared.storefront_themes,
  shared.storefront_pages,
  shared.storefront_navigation,
  shared.product_reviews,
  shared.tracking_links,
  shared.order_timeline_events
TO hub_storefront;
GRANT SELECT, INSERT, UPDATE, DELETE ON shared.carts, shared.cart_items TO hub_storefront;
GRANT SELECT, INSERT, UPDATE, DELETE ON shared.customer_wishlists TO hub_storefront;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA shared TO hub_storefront;

-- ============================================================
-- Verify
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'shared'
-- AND table_name IN ('storefront_themes','storefront_pages',
--                     'storefront_navigation','storefront_revisions',
--                     'product_reviews','carts','cart_items',
--                     'tracking_links','order_timeline_events');
-- Expected: 9 rows
-- ============================================================
