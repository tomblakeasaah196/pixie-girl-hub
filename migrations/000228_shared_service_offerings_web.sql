-- ============================================================
-- 000228 — Service Offerings go to the website (PR-B).
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Services (shared.service_offerings) only had name/price/duration/one image.
-- To sell them online (owner: bookable) they gain marketing + SEO copy, a
-- thumbnail, storefront visibility, "from" pricing, and the booking economics
-- (deposit, buffer, location, cancellation). Customer-facing extras
-- (what's-included, FAQs, aftercare) ride as JSONB so they stay flexible.
-- ============================================================

ALTER TABLE shared.service_offerings
  -- Marketing copy
  ADD COLUMN IF NOT EXISTS short_description   TEXT,
  ADD COLUMN IF NOT EXISTS long_description    TEXT,
  -- Storefront visibility + imagery (image_url is the primary; thumbnail is
  -- the compressed card image).
  ADD COLUMN IF NOT EXISTS is_visible_storefront BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thumbnail_url       TEXT,
  ADD COLUMN IF NOT EXISTS is_featured         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at        TIMESTAMPTZ,
  -- Lightweight grouping/filtering that replaces the free-text `category` on
  -- the site (Categories are being retired from products).
  ADD COLUMN IF NOT EXISTS tags                TEXT[],
  -- SEO
  ADD COLUMN IF NOT EXISTS meta_title          TEXT,
  ADD COLUMN IF NOT EXISTS meta_description    TEXT,
  -- Pricing presentation: installs vary, so allow a "from" price + a was/now.
  ADD COLUMN IF NOT EXISTS compare_at_price_ngn NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS price_is_from       BOOLEAN NOT NULL DEFAULT false,
  -- How it sells online: bookable (default), buy-now, or enquiry/lead.
  ADD COLUMN IF NOT EXISTS sale_mode           TEXT NOT NULL DEFAULT 'book'
    CHECK (sale_mode IN ('book','buy','enquire')),
  -- Booking economics
  ADD COLUMN IF NOT EXISTS deposit_required    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_pct         NUMERIC(5,2)
    CHECK (deposit_pct IS NULL OR (deposit_pct >= 0 AND deposit_pct <= 100)),
  ADD COLUMN IF NOT EXISTS buffer_minutes      INTEGER
    CHECK (buffer_minutes IS NULL OR buffer_minutes >= 0),
  ADD COLUMN IF NOT EXISTS location_type       TEXT
    CHECK (location_type IS NULL OR location_type IN ('in_studio','home','virtual')),
  ADD COLUMN IF NOT EXISTS cancellation_policy TEXT,
  -- Customer-facing extras (flexible)
  ADD COLUMN IF NOT EXISTS whats_included      JSONB,
  ADD COLUMN IF NOT EXISTS faqs                JSONB,
  ADD COLUMN IF NOT EXISTS aftercare_notes     TEXT;

CREATE INDEX IF NOT EXISTS idx_service_offerings_storefront
  ON shared.service_offerings (business, sort_order)
  WHERE is_visible_storefront = true AND is_active = true;

-- ── Public booking requests ──────────────────────────────
-- A "Book" on the website captures a booking REQUEST (no live calendar yet):
-- the service, the customer, a preferred date/time and notes. Ops convert it
-- into a real appointment/job. Linked to a contact when we can resolve one.
CREATE TABLE IF NOT EXISTS shared.service_booking_requests (
  request_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business          TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  service_id        UUID        NOT NULL REFERENCES shared.service_offerings (service_id) ON DELETE CASCADE,
  contact_id        UUID        REFERENCES shared.contacts (contact_id) ON DELETE SET NULL,
  full_name         TEXT        NOT NULL,
  phone             TEXT,
  email             CITEXT,
  preferred_date    DATE,
  preferred_time    TEXT,
  notes             TEXT,
  status            TEXT        NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','scheduled','cancelled','completed')),
  source            TEXT        NOT NULL DEFAULT 'storefront',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_booking_requests_biz
  ON shared.service_booking_requests (business, status, created_at DESC);
CREATE TRIGGER trg_service_booking_requests_updated_at
  BEFORE UPDATE ON shared.service_booking_requests
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
