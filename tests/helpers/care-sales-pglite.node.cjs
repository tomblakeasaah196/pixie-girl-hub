"use strict";

/**
 * Embedded-PostgreSQL (PGlite) coverage for PR 2 — typed Care & Accessories
 * sales. This is REAL SQL under PGlite: the same template migrations that
 * bootstrap/repair apply (000094 + 000095), the real stock SSOT trigger, the
 * real document-numbering function, and the real service modules with only
 * the connection pool + the payment gateway swapped for test doubles.
 *
 * It is a staging-strength check of the NEW/CHANGED queries (cart SQL,
 * resolver SQL, createOrder retail enforcement, checkout delivery gate), not
 * a substitute for the full deployed schema — the fixture carries every
 * column these queries touch, nothing more.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { PGlite } = require("@electric-sql/pglite");

process.env.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = "true";
process.env.ENABLE_AUDIT_LOG = "true";
// Env schema validation dummies — no real connection is ever opened; the pg
// pool is swapped for PGlite before any repo runs a query.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "fatal";
process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_NAME = process.env.DB_NAME || "pglite";
process.env.DB_USER = process.env.DB_USER || "pglite";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "pglite";
process.env.REDIS_HOST = process.env.REDIS_HOST || "localhost";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-".repeat(4);
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-".repeat(4);
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const T94 = fs.readFileSync(path.resolve(__dirname, "../../migrations/template/000094_business_care_accessories.sql.template"), "utf8");
const T95 = fs.readFileSync(path.resolve(__dirname, "../../migrations/template/000095_business_care_typed_sales.sql.template"), "utf8");

// ── Fixture DDL — real columns for every table the PR 2 SQL touches ──
const SHARED_DDL = `
-- PGlite has no citext extension; a text domain keeps the app's ::citext
-- casts valid (case-sensitivity is irrelevant to these tests).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'citext') THEN
    CREATE DOMAIN citext AS text;
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS shared;
CREATE OR REPLACE FUNCTION shared.fn_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE shared.business_config (
  config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_key text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT 'Brand',
  legal_name text NOT NULL DEFAULT 'Brand Ltd',
  trading_currency text NOT NULL DEFAULT 'NGN',
  settlement_currency text NOT NULL DEFAULT 'NGN',
  document_prefix text,
  storefront_domain text, storefront_enabled boolean NOT NULL DEFAULT true,
  vat_rate numeric NOT NULL DEFAULT 0, wht_rate numeric,
  accent_colour text, logo_path text, address text, phone text, email text,
  instagram_handle text,
  loyalty_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancellation_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_gateway_fees jsonb NOT NULL DEFAULT '{}'::jsonb,
  installment_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  allow_staff_recorded_manual_payments boolean NOT NULL DEFAULT true,
  cash_request_ceo_threshold_ngn numeric,
  email_signature_template text
);

CREATE TABLE shared.document_numbering (
  seq_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business text NOT NULL, document_type text NOT NULL,
  prefix text NOT NULL, next_number bigint NOT NULL DEFAULT 1,
  padding int NOT NULL DEFAULT 4,
  UNIQUE (business, document_type)
);

CREATE TABLE shared.audit_log (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business text, user_id uuid, user_name text, module text, action text,
  table_name text, record_id text, before_state jsonb, after_state jsonb,
  ip_address text, user_agent text, is_sensitive boolean, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shared.event_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business text NOT NULL, event_type text NOT NULL, payload jsonb,
  dedup_key text, status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_event_outbox_dedup ON shared.event_outbox (dedup_key) WHERE dedup_key IS NOT NULL;

CREATE TABLE shared.contacts (
  contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_type text[] NOT NULL DEFAULT '{}',
  display_name text NOT NULL, first_name text, last_name text,
  company_name text, gender text, date_of_birth date, tin text UNIQUE,
  cac_number text, primary_phone text, whatsapp_number text, email text,
  country_code text, storefront_password_hash text,
  storefront_email_verified boolean NOT NULL DEFAULT false,
  priority_level text NOT NULL DEFAULT 'regular',
  assigned_to uuid, visible_to text[] NOT NULL DEFAULT '{}',
  source text, notes text, signup_device_fingerprint text, signup_ip text,
  is_deleted boolean NOT NULL DEFAULT false, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE shared.contact_addresses (
  address_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES shared.contacts(contact_id) ON DELETE CASCADE,
  address_type text NOT NULL DEFAULT 'delivery',
  line1 text NOT NULL, line2 text, area text,
  city text NOT NULL DEFAULT 'Lagos', state text NOT NULL DEFAULT 'Lagos',
  country text NOT NULL DEFAULT 'Nigeria', country_code text NOT NULL DEFAULT 'NG',
  postal_code text, landmark text, recipient_name text, recipient_phone text,
  google_maps_url text, latitude numeric(10,7), longitude numeric(10,7),
  is_default boolean NOT NULL DEFAULT false, is_verified boolean NOT NULL DEFAULT false,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shared.carts (
  cart_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business text NOT NULL,
  contact_id uuid REFERENCES shared.contacts(contact_id),
  session_token text,
  display_currency text, fx_rate_used numeric(15,6),
  applied_coupon_id uuid, delivery_address_id uuid,
  abandoned_at timestamptz, recovery_email_sent_at timestamptz,
  recovered_at timestamptz,
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  converted_order_id uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_has_owner CHECK (contact_id IS NOT NULL OR session_token IS NOT NULL)
);

CREATE TABLE shared.cart_items (
  cart_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES shared.carts(cart_id) ON DELETE CASCADE,
  business text NOT NULL,
  product_id uuid, variant_id uuid,
  styled_variant_id uuid, bundle_id uuid,
  unstyled boolean NOT NULL DEFAULT false,
  quantity integer NOT NULL CHECK (quantity > 0),
  product_name_snapshot text NOT NULL, variant_label_snapshot text,
  thumbnail_url_snapshot text,
  unit_price_ngn numeric(14,2) NOT NULL, unit_display_price numeric(14,2),
  display_currency text, custom_spec jsonb,
  added_at timestamptz NOT NULL DEFAULT now()
);
`;

// Per-brand schema. Deliberately carries the REAL column set the PR 2 code
// reads/writes (000016/000017/000034/000046/000086/000088/000094 shapes).
const BRAND_DDL = (B) => `
CREATE SCHEMA ${B};

CREATE TABLE ${B}.product_categories (
  category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_category_id uuid, name text NOT NULL, slug text UNIQUE NOT NULL,
  description text, is_visible_storefront boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE ${B}.products (
  product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text UNIQUE NOT NULL, name text NOT NULL, slug text,
  category_id uuid REFERENCES ${B}.product_categories(category_id),
  product_type text NOT NULL DEFAULT 'physical',
  track_stock boolean NOT NULL DEFAULT true,
  is_custom boolean NOT NULL DEFAULT false,
  preorder_enabled boolean NOT NULL DEFAULT true,
  preorder_excluded boolean NOT NULL DEFAULT false,
  expected_ready_date date, production_lead_days integer,
  rewig_eligible boolean NOT NULL DEFAULT true,
  size_code text, base_family_id uuid,
  hair_length_inches smallint, texture_type text, lace_type text,
  density text, cap_size text, hair_origin text,
  required_deposit_pct numeric,
  payment_model text NOT NULL DEFAULT 'layaway',
  is_visible_storefront boolean NOT NULL DEFAULT true,
  visible_on_channels text[] NOT NULL DEFAULT '{storefront,pos}',
  taxable boolean NOT NULL DEFAULT true, vat_rate numeric,
  short_description text, long_description text,
  ingredients text, directions text, warnings text,
  search_keywords text[] NOT NULL DEFAULT '{}',
  brand_name text, meta_title text, meta_description text,
  catalogue_role text NOT NULL DEFAULT 'base',
  retail_status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  is_deleted boolean NOT NULL DEFAULT false,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ${B}.product_variants (
  variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ${B}.products(product_id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE, barcode text UNIQUE,
  variant_name text NOT NULL,
  variant_length_inches smallint, variant_colour text, variant_density text,
  variant_cap_size text,
  price_storefront_ngn numeric(14,2), price_pos_ngn numeric(14,2),
  price_wholesale_ngn numeric(14,2), price_partner_ngn numeric(14,2),
  compare_at_price_ngn numeric(14,2),
  price_storefront_usd numeric(14,2), price_pos_usd numeric(14,2),
  price_wholesale_usd numeric(14,2), price_partner_usd numeric(14,2),
  cost_price_ngn numeric(14,2), cost_last_refreshed_at timestamptz,
  min_price_ngn numeric(14,2), min_margin_pct numeric(5,2),
  weight_g integer,
  channel_external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel_sync_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_model_override text, required_deposit_pct_override numeric(5,2),
  reorder_point integer NOT NULL DEFAULT 0, reorder_quantity integer,
  display_order smallint NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Styled targets (000041 shape, minimal): 000094's hair-base triggers attach
-- here, and cart availability resolves styled lines through them.
CREATE TABLE ${B}.styled_products (
  styled_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_product_id uuid REFERENCES ${B}.products(product_id),
  base_variant_id uuid REFERENCES ${B}.product_variants(variant_id),
  name text, styled_code text, status text NOT NULL DEFAULT 'live',
  is_deleted boolean NOT NULL DEFAULT false, rewig_override text,
  primary_image_url text, retail_price_ngn numeric(14,2), retail_price_usd numeric(14,2)
);
CREATE TABLE ${B}.styled_product_variants (
  styled_variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  styled_id uuid REFERENCES ${B}.styled_products(styled_id),
  base_product_id uuid REFERENCES ${B}.products(product_id),
  base_variant_id uuid,
  is_active boolean NOT NULL DEFAULT true, is_deleted boolean NOT NULL DEFAULT false
);

CREATE TABLE ${B}.product_images (
  image_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ${B}.products(product_id) ON DELETE CASCADE,
  variant_id uuid REFERENCES ${B}.product_variants(variant_id) ON DELETE CASCADE,
  styled_id uuid,
  file_path text NOT NULL, webp_path text, cdn_url text,
  responsive_paths jsonb NOT NULL DEFAULT '{}'::jsonb,
  alt_text text, caption text,
  display_order smallint NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false
);

CREATE TABLE ${B}.stock_locations (
  location_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, location_type text NOT NULL DEFAULT 'warehouse',
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  available_for_storefront boolean NOT NULL DEFAULT true,
  available_for_pos boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ${B}.stock_levels (
  stock_level_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES ${B}.product_variants(variant_id),
  location_id uuid NOT NULL REFERENCES ${B}.stock_locations(location_id),
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  available integer GENERATED ALWAYS AS (on_hand - reserved) STORED,
  last_movement_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, location_id),
  CONSTRAINT stock_reserved_le_on_hand CHECK (reserved <= on_hand)
);

CREATE TABLE ${B}.stock_movements (
  movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_number text NOT NULL UNIQUE,
  variant_id uuid NOT NULL REFERENCES ${B}.product_variants(variant_id),
  location_id uuid NOT NULL REFERENCES ${B}.stock_locations(location_id),
  quantity integer NOT NULL CHECK (quantity <> 0),
  movement_type text NOT NULL CHECK (movement_type IN (
    'receive','sale','return','transfer_out','transfer_in',
    'adjustment_in','adjustment_out','reserve','release_reserve',
    'production_in','production_out','consignment_out','consignment_return',
    'damage','sample','theft_writeoff')),
  sales_channel text, reference_type text, reference_id uuid,
  unit_cost_ngn numeric(14,2), counterparty_type text, counterparty_id uuid,
  notes text, performed_by uuid, performed_at timestamptz NOT NULL DEFAULT now()
);

-- Real stock SSOT trigger (000034 as fixed by 000089).
CREATE OR REPLACE FUNCTION ${B}.fn_apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.movement_type = 'reserve' THEN
    UPDATE ${B}.stock_levels
       SET reserved = reserved + ABS(NEW.quantity),
           last_movement_at = NEW.performed_at, updated_at = now()
     WHERE variant_id = NEW.variant_id AND location_id = NEW.location_id;
    IF NOT FOUND THEN
      INSERT INTO ${B}.stock_levels (variant_id, location_id, on_hand, reserved, last_movement_at)
      VALUES (NEW.variant_id, NEW.location_id, 0, ABS(NEW.quantity), NEW.performed_at);
    END IF;
  ELSIF NEW.movement_type = 'release_reserve' THEN
    UPDATE ${B}.stock_levels
       SET reserved = GREATEST(0, reserved - ABS(NEW.quantity)),
           last_movement_at = NEW.performed_at, updated_at = now()
     WHERE variant_id = NEW.variant_id AND location_id = NEW.location_id;
  ELSE
    UPDATE ${B}.stock_levels
       SET on_hand = on_hand + NEW.quantity,
           last_movement_at = NEW.performed_at, updated_at = now()
     WHERE variant_id = NEW.variant_id AND location_id = NEW.location_id;
    IF NOT FOUND THEN
      INSERT INTO ${B}.stock_levels (variant_id, location_id, on_hand, last_movement_at)
      VALUES (NEW.variant_id, NEW.location_id, NEW.quantity, NEW.performed_at);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_${B}_apply_stock_movement
  AFTER INSERT ON ${B}.stock_movements
  FOR EACH ROW EXECUTE FUNCTION ${B}.fn_apply_stock_movement();

CREATE TABLE ${B}.catalogue_config (
  singleton boolean PRIMARY KEY DEFAULT true,
  preorder_enabled boolean NOT NULL DEFAULT true,
  preorder_min_weeks integer NOT NULL DEFAULT 4,
  preorder_max_weeks integer NOT NULL DEFAULT 8,
  rewig_enabled boolean NOT NULL DEFAULT false,
  rewig_mode text NOT NULL DEFAULT 'automatic',
  rewig_direction text,
  categories_enabled boolean NOT NULL DEFAULT false,
  usd_fx_rate numeric(15,6),
  allow_base_in_collections_bundles boolean NOT NULL DEFAULT false
);
INSERT INTO ${B}.catalogue_config (singleton) VALUES (true);

CREATE TABLE ${B}.delivery_zones (
  zone_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, description text,
  geometry_type text NOT NULL CHECK (geometry_type IN ('polygon','radius','country')),
  geometry jsonb NOT NULL DEFAULT '{}'::jsonb,
  fee_ngn numeric(14,2) NOT NULL DEFAULT 0,
  rate_card jsonb, courier_key text,
  is_free_delivery boolean NOT NULL DEFAULT false,
  country_code text, priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ${B}.sales_orders (
  order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  contact_id uuid, sales_channel text NOT NULL,
  order_type text NOT NULL DEFAULT 'dispatch',
  is_custom_order boolean NOT NULL DEFAULT false,
  sales_campaign_id uuid,
  utm_source text, utm_medium text, utm_campaign text,
  status text NOT NULL DEFAULT 'pending_payment',
  subtotal_ngn numeric(14,2), discount_amount_ngn numeric(14,2),
  tax_amount_ngn numeric(14,2), shipping_fee_ngn numeric(14,2),
  total_ngn numeric(14,2), amount_paid_ngn numeric(14,2) NOT NULL DEFAULT 0,
  balance_due_ngn numeric(14,2) GENERATED ALWAYS AS (COALESCE(total_ngn,0) - COALESCE(amount_paid_ngn,0)) STORED,
  coupon_code text, quotation_id uuid, client_idempotency_key text,
  payment_plan text, payment_model text,
  required_deposit_pct numeric(5,2), required_deposit_ngn numeric(14,2),
  stylist_referral_code text, closed_by_user_id uuid, referral_code_used text,
  specific_instructions text,
  is_preorder boolean NOT NULL DEFAULT false, preorder_ready_by date,
  preorder_min_weeks integer, preorder_max_weeks integer,
  public_tracking_token text,
  display_currency text, display_total numeric(14,2), fx_rate_used numeric(15,6),
  amendment_count smallint NOT NULL DEFAULT 0, last_amended_at timestamptz,
  customer_notes text, internal_notes text,
  delivery_address_id uuid, delivery_address_snapshot jsonb,
  cancellation_reason text, cancelled_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_${B}_orders_idempotency
  ON ${B}.sales_orders (client_idempotency_key) WHERE client_idempotency_key IS NOT NULL;

CREATE TABLE ${B}.sales_order_discounts (
  discount_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES ${B}.sales_orders(order_id) ON DELETE CASCADE,
  source text NOT NULL, source_reference text, sales_campaign_id uuid,
  applied_to_line_id uuid, amount_ngn numeric(14,2) NOT NULL DEFAULT 0,
  discount_type text, applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ${B}.sales_order_amendments (
  amendment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL, amendment_number integer,
  reason text, reason_category text,
  subtotal_before_ngn numeric(14,2), discount_before_ngn numeric(14,2),
  tax_before_ngn numeric(14,2), shipping_before_ngn numeric(14,2),
  total_before_ngn numeric(14,2),
  subtotal_after_ngn numeric(14,2), discount_after_ngn numeric(14,2),
  tax_after_ngn numeric(14,2), shipping_after_ngn numeric(14,2),
  total_after_ngn numeric(14,2),
  amount_paid_ngn numeric(14,2), balance_after_ngn numeric(14,2),
  lines_before jsonb, lines_after jsonb, line_changes jsonb,
  delivery_before jsonb, delivery_after jsonb, effects jsonb,
  order_status_before text, revenue_recognised boolean,
  journal_entry_id uuid, customer_notified boolean,
  amended_by uuid, amended_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ${B}.deliveries (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid, delivery_number text, status text NOT NULL DEFAULT 'scheduled',
  courier_id uuid, delivery_address_snapshot jsonb, courier_fee_ngn numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Amendment flow re-syncs proforma invoices if present; an empty table is
-- enough to exercise the "no invoice yet" early-return.
CREATE TABLE ${B}.invoices (
  invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE, order_id uuid, status text NOT NULL DEFAULT 'draft',
  subtotal_ngn numeric(14,2), discount_amount_ngn numeric(14,2),
  tax_amount_ngn numeric(14,2), wht_amount_ngn numeric(14,2),
  total_ngn numeric(14,2), amount_paid_ngn numeric(14,2) NOT NULL DEFAULT 0,
  display_currency text, display_total numeric(14,2),
  issued_at timestamptz, due_date date,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ${B}.invoice_lines (
  invoice_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES ${B}.invoices(invoice_id) ON DELETE CASCADE,
  sales_order_line_id uuid, product_id uuid, variant_id uuid,
  description text, sku_snapshot text, quantity integer NOT NULL,
  unit_price_ngn numeric(14,2), line_discount_ngn numeric(14,2),
  tax_rate numeric(8,4), tax_amount_ngn numeric(14,2),
  line_total_ngn numeric(14,2), display_order integer NOT NULL DEFAULT 0
);

CREATE TABLE ${B}.journal_entries (
  journal_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text, source_type text, source_id uuid,
  idempotency_key text, posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ${B}.sales_order_lines (
  line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES ${B}.sales_orders(order_id) ON DELETE CASCADE,
  product_id uuid, variant_id uuid,
  product_name_snapshot text, variant_label_snapshot text, sku_snapshot text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_ngn numeric(14,2), unit_cost_ngn numeric(14,2),
  line_discount_ngn numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(8,4), tax_amount_ngn numeric(14,2),
  line_total_ngn numeric(14,2), display_order integer NOT NULL DEFAULT 0,
  notes text, line_kind text NOT NULL DEFAULT 'product',
  service_offering_id uuid, styled_id uuid,
  is_preorder boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION ${B}.fn_next_document_number(p_document_type text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_row shared.document_numbering%ROWTYPE; v_result text;
BEGIN
  SELECT * INTO v_row FROM shared.document_numbering
   WHERE business = '${B}' AND document_type = p_document_type FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No document_numbering row for (${B}, %)', p_document_type;
  END IF;
  v_result := v_row.prefix || '-' || LPAD(v_row.next_number::text, v_row.padding, '0');
  UPDATE shared.document_numbering SET next_number = next_number + 1
   WHERE seq_id = v_row.seq_id;
  RETURN v_result;
END $$;
`;

let db;

async function boot() {
  db = new PGlite();
  await db.exec(SHARED_DDL);
  for (const brand of ["pixiegirl", "faitlynhair"]) {
    await db.exec(BRAND_DDL(brand));
    await db.exec(T94.replace(/\{\{BUSINESS\}\}/g, brand));
    await db.exec(T95.replace(/\{\{BUSINESS\}\}/g, brand));
    await db.query(
      `INSERT INTO shared.document_numbering (business, document_type, prefix, padding, next_number)
       VALUES ($1,'sales_order',$2,4,1), ($1,'stock_movement',$3,4,1)`,
      [brand, `${brand === "pixiegirl" ? "PXG" : "FLH"}-SO`, `${brand === "pixiegirl" ? "PXG" : "FLH"}-MOV`],
    );
  }
  await db.query(
    `INSERT INTO shared.business_config (business_key, display_name, legal_name, vat_rate, installment_settings, loyalty_settings)
     VALUES ('pixiegirl','Pixie Girl','Pixie Girl Ltd', 0,
             $1::jsonb, $2::jsonb),
            ('faitlynhair','Faitlyn Hair','Faitlyn Hair Ltd', 0,
             $1::jsonb, $2::jsonb)`,
    [
      JSON.stringify({ channels: { storefront: true, quick_sale: true, pos: true, phone: true }, min_first_payment_pct: 30, custom_order_deposit_pct: 50, plan_display_name: "Flexi Pay" }),
      JSON.stringify({ naira_per_point: 10 }),
    ],
  );
  // Swap the pg pool for PGlite BEFORE any service module loads, so every
  // repo binds the patched query/transaction. PGlite is single-connection:
  // a pool-level query issued from INSIDE a transaction would queue behind
  // that transaction forever, so while one is open the pool path is rerouted
  // onto the live transaction (same-statement semantics as pg for our uses).
  const dbmod = require("../../src/config/database");
  let activeTx = null;
  dbmod.query = (sql, params) =>
    activeTx ? activeTx.query(sql, params) : db.query(sql, params);
  dbmod.ex = (client) =>
    client ? client.query.bind(client) : (sql, params) => dbmod.query(sql, params);
  dbmod.transaction = async (fn) =>
    db.transaction(async (tx) => {
      const prev = activeTx;
      activeTx = tx;
      try {
        const client = { query: (sql, params) => tx.query(sql, params) };
        return await fn(client);
      } finally {
        activeTx = prev;
      }
    });
  // Payment gateway double: PR 2 never exercises live providers.
  const payPath = require.resolve("../../src/modules/sales/payment-link.service");
  require.cache[payPath] = {
    id: payPath, filename: payPath, loaded: true,
    exports: {
      createPaymentLink: async () => ({ checkout_url: "https://pay.test/mock", provider: "nomba", link_id: "lnk-test" }),
    },
  };
}

before(async () => { await boot(); }, 120_000);
after(async () => { if (db) await db.close(); });

// ── Seed helpers ───────────────────────────────────────────
const PXG = "pixiegirl";
const IDS = {
  careProduct: "aaaaaaaa-0000-4000-8000-000000000001",
  v50: "aaaaaaaa-0000-4000-8000-000000000050",
  v100: "aaaaaaaa-0000-4000-8000-000000000100",
  draftCare: "aaaaaaaa-0000-4000-8000-000000000002",
  vDraft: "aaaaaaaa-0000-4000-8000-000000000051",
  wigBase: "bbbbbbbb-0000-4000-8000-000000000001",
  vWig: "bbbbbbbb-0000-4000-8000-000000000050",
  loc: "cccccccc-0000-4000-8000-000000000001",
  locNonSellable: "cccccccc-0000-4000-8000-000000000002",
  category: "dddddddd-0000-4000-8000-000000000001",
};

async function seed() {
  await db.query(`INSERT INTO pixiegirl.stock_locations (location_id, name, is_default, available_for_storefront)
    VALUES ($1,'Main', true, true), ($2,'Transit', false, false)`, [IDS.loc, IDS.locNonSellable]);
  // The 000094 template already seeds the PXG Care & Accessories root — adopt
  // it (a second insert would violate the slug uniqueness).
  const cat = await db.query(`SELECT category_id FROM pixiegirl.product_categories WHERE slug = 'care-and-accessories'`);
  IDS.category = cat.rows[0].category_id;
  await db.query(`INSERT INTO pixiegirl.products
    (product_id, product_code, name, slug, category_id, catalogue_role, retail_status,
     taxable, vat_rate, product_type, track_stock, is_custom, preorder_enabled, preorder_excluded,
     rewig_eligible, payment_model, is_visible_storefront, visible_on_channels, short_description)
    VALUES ($1,'PXG-CARE-OIL','Pixie Hair Oil','pixie-hair-oil',$2,'retail','live',
            true, 0.075, 'physical', true, false, false, true,
            false, 'full_payment_only', false, '{}', 'Shine serum'),
           ($3,'PXG-CARE-DRAFT','Draft Comb','draft-comb',$2,'retail','draft',
            false, NULL, 'physical', true, false, false, true,
            false, 'full_payment_only', false, '{}', NULL),
           ($4,'PXG-WIG-1','Classic Base','classic-base',NULL,'base','draft',
            true, NULL, 'physical', true, false, true, false,
            true, 'layaway', false, '{pos}', NULL)`,
    [IDS.careProduct, IDS.category, IDS.draftCare, IDS.wigBase]);
  await db.query(`INSERT INTO pixiegirl.product_variants
    (variant_id, product_id, sku, variant_name, price_storefront_ngn, price_pos_ngn,
     price_storefront_usd, price_pos_usd, is_default, display_order, cost_price_ngn)
    VALUES ($1,$2,'PXG-OIL-50','50 ml',4500,4200,3.5,3.2,true,0,1500),
           ($3,$2,'PXG-OIL-100','100 ml',8000,7600,6.0,5.7,false,1,2600),
           ($4,$5,'PXG-COMB-D','Standard',NULL,NULL,NULL,NULL,true,0,NULL),
           ($6,$7,'PXG-WIG-DEF','Default',120000,115000,NULL,NULL,true,0,60000)`,
    [IDS.v50, IDS.careProduct, IDS.v100, IDS.vDraft, IDS.draftCare, IDS.vWig, IDS.wigBase]);
  await db.query(`INSERT INTO pixiegirl.product_images (product_id, file_path, cdn_url, is_primary)
    VALUES ($1,'care/oil.jpg','https://cdn.test/oil.jpg', true)`, [IDS.careProduct]);
  // Stock: 3 × 50 ml and 1 × 100 ml at the SELLABLE location; 99 × 50 ml in
  // transit (must never count as sellable).
  await db.query(`INSERT INTO pixiegirl.stock_levels (variant_id, location_id, on_hand)
    VALUES ($1,$2,3), ($3,$2,1), ($1,$4,99), ($5,$2,2)`,
    [IDS.v50, IDS.loc, IDS.v100, IDS.locNonSellable, IDS.vWig]);
  await db.query(`INSERT INTO pixiegirl.delivery_zones (name, geometry_type, country_code, fee_ngn, rate_card, courier_key)
    VALUES ('Nigeria Flat','country','NG',2500, $1::jsonb, 'standard')`,
    [JSON.stringify({ tiers: [{ label: "1–2", min_qty: 1, max_qty: 2, fee_ngn: 2500 }, { label: "3–4", min_qty: 3, max_qty: 4, fee_ngn: 4000 }] })]);
  // FLH: a wig only — the CHECK in 000094 forbids retail rows entirely.
  await db.query(`INSERT INTO faitlynhair.products (product_code, name, catalogue_role) VALUES ('FLH-WIG-1','FLH Wig','base')`);
}

// ── The suites ─────────────────────────────────────────────
test("setup: seed PXG/FLH fixtures through the real migrations", async () => {
  await seed();
  const care = await db.query(`SELECT retail_status FROM pixiegirl.products WHERE product_id = $1`, [IDS.careProduct]);
  assert.equal(care.rows[0].retail_status, "live");
});

test("typed resolver: sellable 50/100 ml resolve separately; draft, FLH and forged ids refuse", async () => {
  const resolver = require("../../src/modules/catalogue/retail-resolver");
  const r50 = await resolver.resolveSellableVariant({ brand: PXG, variant_id: IDS.v50 });
  assert.equal(r50.sku, "PXG-OIL-50");
  assert.equal(r50.unit_price_ngn, 4500);
  assert.equal(r50.available, 3, "transit stock must not count as sellable");
  const r100 = await resolver.resolveSellableVariant({ brand: PXG, variant_id: IDS.v100 });
  assert.equal(r100.sku, "PXG-OIL-100");
  assert.notEqual(r100.variant_id, r50.variant_id);
  // Draft product refuses.
  await assert.rejects(resolver.resolveSellableVariant({ brand: PXG, variant_id: IDS.vDraft }), /not found|No product/i);
  // FLH brand refuses even a PXG variant id (forged link/API).
  await assert.rejects(resolver.resolveSellableVariant({ brand: "faitlynhair", variant_id: IDS.v50 }));
  // SKU/product mismatch refuses.
  await assert.rejects(resolver.resolveSellableVariant({ brand: PXG, variant_id: IDS.v50, product_id: IDS.draftCare }));
  // A base wig variant is not a retail SKU.
  await assert.rejects(resolver.resolveSellableVariant({ brand: PXG, variant_id: IDS.vWig }));
});

test("storefront cart: retail adds keep the exact SKU + live price; forged/off-gate/unpriced refuse", async () => {
  const cartService = require("../../src/modules/storefront/cart.service");
  const cart = await cartService.getOrCreateCart({ business: PXG, session_token: "guest-1" });
  const added = await cartService.addStorefrontItem({
    business: PXG, cart_id: cart.cart_id,
    item: { variant_id: IDS.v50, quantity: 1 }, display_currency: "NGN",
  });
  assert.equal(added.product_name_snapshot, "Pixie Hair Oil");
  assert.equal(added.variant_label_snapshot, "50 ml");
  assert.equal(Number(added.unit_price_ngn), 4500);
  // The 100 ml is a DISTINCT line (exact SKU preserved, no merge/expand).
  await cartService.addStorefrontItem({
    business: PXG, cart_id: cart.cart_id,
    item: { variant_id: IDS.v100, quantity: 1 }, display_currency: "NGN",
  });
  const full = await cartService.getCart({ business: PXG, session_token: "guest-1" });
  assert.equal(full.items.length, 2);
  // Over-stock add refuses (only 3 sellable 50 ml).
  await assert.rejects(cartService.addStorefrontItem({
    business: PXG, cart_id: cart.cart_id, item: { variant_id: IDS.v50, quantity: 4 },
  }), (err) => err.code === "OUT_OF_STOCK");
  // Draft care refuses; FLH brand refuses; legacy wig variant still works.
  await assert.rejects(cartService.addStorefrontItem({
    business: PXG, cart_id: cart.cart_id, item: { variant_id: IDS.vDraft },
  }));
  await assert.rejects(cartService.addStorefrontItem({
    business: "faitlynhair", cart_id: cart.cart_id, item: { variant_id: IDS.v50 },
  }));
});

test("storefront quote: live re-pricing replaces stale snapshots and shows the MAY disclosure", async () => {
  const cartService = require("../../src/modules/storefront/cart.service");
  const storefront = require("../../src/modules/storefront/storefront.service");
  const cart = await cartService.getOrCreateCart({ business: PXG, session_token: "guest-quote" });
  await cartService.addStorefrontItem({
    business: PXG, cart_id: cart.cart_id, item: { variant_id: IDS.v50, quantity: 1 },
  });
  // The price moves AFTER the add — the quote must show the LIVE number.
  await db.query(`UPDATE pixiegirl.product_variants SET price_storefront_ngn = 5000 WHERE variant_id = $1`, [IDS.v50]);
  const q = await storefront.quoteCart({
    brand: PXG, cart_id: cart.cart_id,
    address: { country_code: "NG", zone_code: "NG" }, display_currency: "NGN",
  });
  assert.equal(q.lines[0].unit_price_ngn, "5000.00", "stale add-time price must not survive the quote");
  assert.equal(q.has_care_items, true);
  assert.equal(q.care_delivery_notice, "EXTRA DELIVERY FEES MAY APPLY");
  assert.equal(q.delivery_available, false, "retail web delivery money path is gated off");
  assert.equal(q.delivery_ngn, "0.00", "no delivery figure may be charged or implied");
  await db.query(`UPDATE pixiegirl.product_variants SET price_storefront_ngn = 4500 WHERE variant_id = $1`, [IDS.v50]);
});

test("wig-only cart delivery quotes exactly as before (no retail interference)", async () => {
  const cartService = require("../../src/modules/storefront/cart.service");
  const storefront = require("../../src/modules/storefront/storefront.service");
  const cart = await cartService.getOrCreateCart({ business: PXG, session_token: "guest-wig" });
  // Legacy repaired base-variant path (real columns now).
  await cartService.addStorefrontItem({
    business: PXG, cart_id: cart.cart_id, item: { variant_id: IDS.vWig, quantity: 2 },
  });
  const q = await storefront.quoteCart({
    brand: PXG, cart_id: cart.cart_id,
    address: { country_code: "NG", zone_code: "NG" }, display_currency: "NGN",
  });
  assert.equal(q.has_care_items, false);
  assert.equal(q.delivery_available, true);
  assert.equal(q.delivery_ngn, "2500.00", "2 wigs stay in tier 1–2");
});

test("createOrder: retail-only pays in full, reserves real stock, keeps exact SKU + product tax", async () => {
  const salesService = require("../../src/modules/sales/sales.service");
  const order = await salesService.createOrder({
    brand: PXG, user: { user_id: null }, request_id: "t-retail-full",
    input: {
      contact_id: null, sales_channel: "quick_sale", order_type: "collection",
      payment_plan: "full",
      lines: [{ variant_id: IDS.v100, quantity: 1 }],
    },
  });
  assert.equal(order.payment_plan, "full");
  assert.equal(order.payment_model, "full_payment_only");
  assert.equal(order.is_preorder, false);
  const line = order.lines[0];
  assert.equal(line.sku_snapshot, "PXG-OIL-100");
  assert.equal(line.variant_label_snapshot, "100 ml");
  assert.equal(line.line_kind, "product");
  assert.equal(line.unit_price_ngn, "8000.00");
  assert.equal(line.tax_rate, "0.0750", "product-level VAT applies");
  assert.equal(order.total_ngn, "8600.00");
  // Real reservation on the ledger.
  const lvl = await db.query(`SELECT reserved, on_hand FROM pixiegirl.stock_levels WHERE variant_id = $1 AND location_id = $2`, [IDS.v100, IDS.loc]);
  assert.equal(lvl.rows[0].reserved, 1);
  const mv = await db.query(`SELECT movement_type FROM pixiegirl.stock_movements WHERE reference_id = $1`, [order.order_id]);
  assert.deepEqual(mv.rows.map((r) => r.movement_type), ["reserve"]);
  // Instalment on a care-only basket refuses.
  await assert.rejects(salesService.createOrder({
    brand: PXG, user: { user_id: null }, request_id: "t-retail-inst",
    input: { contact_id: null, sales_channel: "quick_sale", payment_plan: "instalment", lines: [{ variant_id: IDS.v50, quantity: 1 }] },
  }), /paid in full|RETAIL_FULL_PAYMENT_REQUIRED/i);
});

test("createOrder: mixed wig + retail keeps the order-wide instalment plan", async () => {
  const salesService = require("../../src/modules/sales/sales.service");
  const order = await salesService.createOrder({
    brand: PXG, user: { user_id: null }, request_id: "t-mixed",
    input: {
      contact_id: null, sales_channel: "quick_sale", order_type: "dispatch",
      payment_plan: "instalment",
      lines: [{ variant_id: IDS.vWig, quantity: 1 }, { variant_id: IDS.v50, quantity: 1 }],
    },
  });
  assert.equal(order.payment_plan, "instalment");
  assert.equal(order.payment_model, "layaway");
  // 120,000 wig + 4,500 oil (+7.5% on the oil only) → 30% order-wide deposit.
  const expectedTotal = 120000 + 4500 + Math.round(4500 * 0.075 * 100) / 100;
  assert.equal(Number(order.total_ngn), expectedTotal);
  assert.equal(Number(order.required_deposit_ngn), Math.round(expectedTotal * 0.3 * 100) / 100);
  assert.equal(order.is_preorder, false);
  const kinds = order.lines.map((l) => l.line_kind).sort();
  assert.deepEqual(kinds, ["product", "product"]);
});

test("createOrder: sold-out retail is OUT_OF_STOCK — never a pre-order, never a rewig", async () => {
  const salesService = require("../../src/modules/sales/sales.service");
  // 100 ml has exactly 1 unit, reserved by the previous order.
  await assert.rejects(salesService.createOrder({
    brand: PXG, user: { user_id: null }, request_id: "t-retail-oos",
    input: { contact_id: null, sales_channel: "quick_sale", payment_plan: "full", lines: [{ variant_id: IDS.v100, quantity: 1 }] },
  }), (err) => err.code === "OUT_OF_STOCK");
  // No preorder order may have been raised.
  const pre = await db.query(`SELECT count(*)::int AS n FROM pixiegirl.sales_orders WHERE is_preorder = true`);
  assert.equal(pre.rows[0].n, 0);
});

test("storefront checkout: retail pickup completes; retail delivery refuses with the exact disclosure", async () => {
  const cartService = require("../../src/modules/storefront/cart.service");
  const storefront = require("../../src/modules/storefront/storefront.service");
  // Delivery with retail → refused (unapproved fee money path stopped).
  const cartD = await cartService.getOrCreateCart({ business: PXG, session_token: "guest-del" });
  await cartService.addStorefrontItem({ business: PXG, cart_id: cartD.cart_id, item: { variant_id: IDS.v50, quantity: 1 } });
  await assert.rejects(storefront.checkout({
    brand: PXG, cart_id: cartD.cart_id,
    input: {
      fulfilment_type: "delivery",
      contact: { first_name: "Ada", phone: "+2348011111111", address: { line1: "1 Test St", city: "Lagos", country_code: "NG", zone_code: "NG" } },
    },
  }), (err) => {
    assert.match(err.code || "", /RETAIL_DELIVERY_ARRANGED/);
    assert.match(err.options?.user_message || err.user_message || "", /EXTRA DELIVERY FEES MAY APPLY/);
    assert.match(err.options?.user_message || err.user_message || "", /pickup|contact/i);
    return true;
  });
  // Pickup with retail-only → full payment, order created, cart converted.
  const cartP = await cartService.getOrCreateCart({ business: PXG, session_token: "guest-pick" });
  await cartService.addStorefrontItem({ business: PXG, cart_id: cartP.cart_id, item: { variant_id: IDS.v50, quantity: 1 } });
  const result = await storefront.checkout({
    brand: PXG, cart_id: cartP.cart_id,
    input: { fulfilment_type: "pickup", contact: { first_name: "Ada", phone: "+2348011111111" } },
  });
  assert.ok(result.order_id);
  assert.equal(result.has_care_items, true);
  assert.equal(result.care_delivery_notice, "EXTRA DELIVERY FEES MAY APPLY");
  assert.equal(result.payment_url, "https://pay.test/mock");
  const ord = await db.query(`SELECT order_type, payment_plan, shipping_fee_ngn FROM pixiegirl.sales_orders WHERE order_id = $1`, [result.order_id]);
  assert.equal(ord.rows[0].order_type, "collection");
  assert.equal(ord.rows[0].payment_plan, "full");
  assert.equal(Number(ord.rows[0].shipping_fee_ngn), 0, "pickup carries no delivery charge");
  const cartRow = await db.query(`SELECT status, converted_order_id FROM shared.carts WHERE cart_id = $1`, [cartP.cart_id]);
  assert.equal(cartRow.rows[0].status, "converted");
});

test("storefront checkout: wig-only delivery still charges the zone tier (unchanged)", async () => {
  const cartService = require("../../src/modules/storefront/cart.service");
  const storefront = require("../../src/modules/storefront/storefront.service");
  const cart = await cartService.getOrCreateCart({ business: PXG, session_token: "guest-wigdel" });
  await cartService.addStorefrontItem({ business: PXG, cart_id: cart.cart_id, item: { variant_id: IDS.vWig, quantity: 1 } });
  const result = await storefront.checkout({
    brand: PXG, cart_id: cart.cart_id,
    input: {
      fulfilment_type: "delivery",
      contact: { first_name: "Bee", phone: "+2348022222222", address: { line1: "2 Wig Rd", city: "Lagos", country_code: "NG", zone_code: "NG" } },
    },
  });
  const ord = await db.query(`SELECT shipping_fee_ngn, order_type FROM pixiegirl.sales_orders WHERE order_id = $1`, [result.order_id]);
  assert.equal(Number(ord.rows[0].shipping_fee_ngn), 2500);
  assert.equal(ord.rows[0].order_type, "dispatch");
});

test("unpublish after add-to-cart blocks quote lines and checkout (kill-switch behaviour)", async () => {
  const cartService = require("../../src/modules/storefront/cart.service");
  const storefront = require("../../src/modules/storefront/storefront.service");
  const salesService = require("../../src/modules/sales/sales.service");
  // Earlier suites really reserved v100 down to zero — top it back up so this
  // suite isolates the PUBLICATION gate, not the stock gate.
  await db.query(`UPDATE pixiegirl.stock_levels SET on_hand = on_hand + 5 WHERE variant_id = $1 AND location_id = $2`, [IDS.v100, IDS.loc]);
  const cart = await cartService.getOrCreateCart({ business: PXG, session_token: "guest-unpub" });
  await cartService.addStorefrontItem({ business: PXG, cart_id: cart.cart_id, item: { variant_id: IDS.v100, quantity: 1 } });
  await db.query(`UPDATE pixiegirl.products SET retail_status = 'draft' WHERE product_id = $1`, [IDS.careProduct]);
  const q = await storefront.quoteCart({ brand: PXG, cart_id: cart.cart_id, display_currency: "NGN" });
  assert.equal(q.lines[0].unavailable, true, "unpublished retail line must be flagged");
  await assert.rejects(storefront.checkout({
    brand: PXG, cart_id: cart.cart_id,
    input: { fulfilment_type: "pickup", contact: { first_name: "Cee", phone: "+2348033333333" } },
  }), /no longer available|CART_ITEM_UNRESOLVED/i);
  // A forged direct createOrder for the unpublished SKU refuses too.
  await assert.rejects(salesService.createOrder({
    brand: PXG, user: { user_id: null }, request_id: "t-unpub-direct",
    input: { contact_id: null, sales_channel: "quick_sale", payment_plan: "full", lines: [{ variant_id: IDS.v100, quantity: 1 }] },
  }), /not currently sellable|REFERENCE_INVALID/i);
  await db.query(`UPDATE pixiegirl.products SET retail_status = 'live' WHERE product_id = $1`, [IDS.careProduct]);
});

test("public catalogue: list + slug detail expose only live, priced SKUs", async () => {
  const storefront = require("../../src/modules/storefront/storefront.service");
  const list = await storefront.listCareProducts({ brand: PXG, page: 1, page_size: 24 });
  const skus = list.data.map((r) => r.sku).sort();
  assert.deepEqual(skus, ["PXG-OIL-100", "PXG-OIL-50"], "draft comb and wig base must not list");
  const oil = list.data.find((r) => r.sku === "PXG-OIL-50");
  assert.equal(oil.name, "Pixie Hair Oil");
  assert.equal(oil.kind, "retail");
  // Search by SKU and by option label.
  const bySku = await storefront.listCareProducts({ brand: PXG, q: "PXG-OIL-100" });
  assert.deepEqual(bySku.data.map((r) => r.sku), ["PXG-OIL-100"]);
  const byLabel = await storefront.listCareProducts({ brand: PXG, q: "50 ml" });
  assert.deepEqual(byLabel.data.map((r) => r.sku), ["PXG-OIL-50"]);
  // Slug detail carries options + descriptions, never costs.
  const detail = await storefront.getCareProduct({ brand: PXG, slug: "pixie-hair-oil" });
  assert.equal(detail.options.length, 2);
  assert.equal(detail.slug, "pixie-hair-oil");
  assert.ok(!JSON.stringify(detail).includes("cost_price"), "no cost data may leak");
  await assert.rejects(storefront.getCareProduct({ brand: PXG, slug: "draft-comb" }));
  await assert.rejects(storefront.getCareProduct({ brand: "faitlynhair", slug: "pixie-hair-oil" }));
  assert.equal(storefront.careEnabled({ brand: PXG }), true);
  assert.equal(storefront.careEnabled({ brand: "faitlynhair" }), false);
});

test("amendment: retail shortfalls refuse loudly — never a pre-order or a rewig", async () => {
  const salesService = require("../../src/modules/sales/sales.service");
  const amendment = require("../../src/modules/sales/amendment.service");
  // Earlier suites really reserved v50 down; top it back up so this suite
  // isolates the AMENDMENT gate, not leftover stock pressure.
  await db.query(`UPDATE pixiegirl.stock_levels SET on_hand = on_hand + 10 WHERE variant_id = $1 AND location_id = $2`, [IDS.v50, IDS.loc]);
  // Fresh retail-only order with one 50 ml.
  const order = await salesService.createOrder({
    brand: PXG, user: { user_id: null }, request_id: "t-amend-base",
    input: { contact_id: null, sales_channel: "quick_sale", order_type: "collection", payment_plan: "full", lines: [{ variant_id: IDS.v50, quantity: 1 }] },
  });
  const keep = order.lines[0];
  // Adding more 50 ml than the shelf holds must refuse the whole amendment.
  const avail = await db.query(`SELECT available FROM pixiegirl.stock_levels WHERE variant_id = $1 AND location_id = $2`, [IDS.v50, IDS.loc]);
  const tooMany = Number(avail.rows[0].available) + 1;
  await assert.rejects(amendment.amendOrder({
    brand: PXG, user: { user_id: null }, request_id: "t-amend-oos", id: order.order_id,
    input: { lines: [{ line_id: keep.line_id, quantity: 1 }, { variant_id: IDS.v50, quantity: tooMany }], reason: "stock test", acknowledge_warnings: true },
  }), (err) => err.code === "OUT_OF_STOCK");
  // A within-stock amendment succeeds and reserves the exact SKU.
  const before = await db.query(`SELECT reserved FROM pixiegirl.stock_levels WHERE variant_id = $1 AND location_id = $2`, [IDS.v50, IDS.loc]);
  const result = await amendment.amendOrder({
    brand: PXG, user: { user_id: null }, request_id: "t-amend-ok", id: order.order_id,
    input: { lines: [{ line_id: keep.line_id, quantity: 2 }], reason: "customer added a bottle", acknowledge_warnings: true },
  });
  assert.ok(!result.requires_confirmation, "no surprise warnings expected");
  const after = await db.query(`SELECT reserved FROM pixiegirl.stock_levels WHERE variant_id = $1 AND location_id = $2`, [IDS.v50, IDS.loc]);
  assert.equal(Number(after.rows[0].reserved), Number(before.rows[0].reserved) + 1);
  const amended = await db.query(`SELECT quantity, sku_snapshot, is_preorder FROM pixiegirl.sales_order_lines WHERE order_id = $1`, [order.order_id]);
  assert.equal(amended.rows.length, 1);
  assert.equal(amended.rows[0].quantity, 2);
  assert.equal(amended.rows[0].sku_snapshot, "PXG-OIL-50", "amendment keeps the exact SKU");
  assert.equal(amended.rows[0].is_preorder, false, "retail never pre-orders through an amendment");
});

test("FLH cannot hold retail data and its storefront reads stay wig-only", async () => {
  await assert.rejects(db.query(`INSERT INTO faitlynhair.products
    (product_code, name, catalogue_role, retail_status, product_type, track_stock, is_custom,
     preorder_enabled, preorder_excluded, rewig_eligible, payment_model,
     is_visible_storefront, visible_on_channels, taxable)
    VALUES ('FLH-OIL','Forged Oil','retail','live','physical',true,false,
            false,true,false,'full_payment_only',false,'{}',false)`),
    /chk_care_accessories_role/);
  const storefront = require("../../src/modules/storefront/storefront.service");
  await assert.rejects(storefront.listCareProducts({ brand: "faitlynhair" }));
});
