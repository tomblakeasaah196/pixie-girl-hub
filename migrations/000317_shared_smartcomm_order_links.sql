-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 000317 — Smartcomm order links (universal order/checkout link)     ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Owner decisions (2026-07-10):
--   • ONE universal order link powers both "Capture an order" (staff-
--     picked cart) and the Share-catalogue tap-to-order ("shop" mode —
--     customer picks items + quantities from the curated selection).
--   • Links are single-use: they die after a successful order, and
--     re-opening a used link shows the order status instead of an error.
--     A stateless JWT can't do that, so links become persisted rows.
--   • Staff see customer activity live: opened / cart changes / ordered
--     land in the thread and the customer sidebar.
--   • Service offerings are orderable via links: service lines become
--     booking REQUESTS (customer picks a requested date/time; the
--     business confirms) — service_jobs stay untouched because
--     shared.service_offerings has no mapping to brand service_types.

-- ── smartcomm_order_links ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared.smartcomm_order_links (
  link_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business         TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  -- Originating chat thread — activity events post back here.
  channel_id       UUID        REFERENCES shared.message_channels (channel_id) ON DELETE SET NULL,
  -- Nullable: links may be minted for threads with no linked customer;
  -- checkout collects the contact inline and back-fills this.
  contact_id       UUID        REFERENCES shared.contacts (contact_id) ON DELETE SET NULL,
  created_by       UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  -- 'capture': staff-picked cart, pre-checked at open.
  -- 'shop':    curated mini-shop, customer picks what they want.
  mode             TEXT        NOT NULL DEFAULT 'capture'
                   CHECK (mode IN ('capture','shop')),
  sales_channel    TEXT        NOT NULL DEFAULT 'whatsapp',
  -- Snapshot of the items offered on the link (kind/id/qty/price/note).
  items            JSONB       NOT NULL,
  notes            TEXT,
  status           TEXT        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','ordered','expired','revoked')),
  -- Set when the customer completes checkout through this link.
  order_id         UUID,
  order_number     TEXT,
  ordered_at       TIMESTAMPTZ,
  -- Customer activity (live cart panel + thread events).
  opened_at        TIMESTAMPTZ,
  opened_count     INTEGER     NOT NULL DEFAULT 0,
  cart             JSONB,
  cart_updated_at  TIMESTAMPTZ,
  -- Throttle for "customer selected items" thread messages.
  last_activity_message_at TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smartcomm_order_links_channel
  ON shared.smartcomm_order_links (channel_id, created_at DESC)
  WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_smartcomm_order_links_contact
  ON shared.smartcomm_order_links (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_smartcomm_order_links_active
  ON shared.smartcomm_order_links (status, expires_at)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_smartcomm_order_links_updated_at
  ON shared.smartcomm_order_links;
CREATE TRIGGER trg_smartcomm_order_links_updated_at
  BEFORE UPDATE ON shared.smartcomm_order_links
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── service_booking_requests ──────────────────────────────────────────
-- A service bought through an order link. `requested_for` is the
-- customer's preferred date/time — a request, not a confirmed slot
-- (there is no availability engine yet). Staff confirm from the thread
-- and convert to a service_job / invoice via the existing flows.
CREATE TABLE IF NOT EXISTS shared.service_booking_requests (
  booking_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business         TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  link_id          UUID        REFERENCES shared.smartcomm_order_links (link_id) ON DELETE SET NULL,
  channel_id       UUID        REFERENCES shared.message_channels (channel_id) ON DELETE SET NULL,
  contact_id       UUID        REFERENCES shared.contacts (contact_id) ON DELETE SET NULL,
  service_id       UUID        NOT NULL REFERENCES shared.service_offerings (service_id) ON DELETE CASCADE,
  -- Related product order when the checkout mixed products + services.
  order_id         UUID,
  qty              INTEGER     NOT NULL DEFAULT 1 CHECK (qty > 0),
  price_ngn        NUMERIC(14,2),
  requested_for    TIMESTAMPTZ,
  note             TEXT,
  status           TEXT        NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested','confirmed','converted','cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_booking_requests_business
  ON shared.service_booking_requests (business, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_booking_requests_contact
  ON shared.service_booking_requests (contact_id)
  WHERE contact_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_service_booking_requests_updated_at
  ON shared.service_booking_requests;
CREATE TRIGGER trg_service_booking_requests_updated_at
  BEFORE UPDATE ON shared.service_booking_requests
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
