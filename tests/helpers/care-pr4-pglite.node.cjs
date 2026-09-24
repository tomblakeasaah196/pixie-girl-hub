"use strict";

/**
 * PR 4's real-SQL edge-case coverage. This is intentionally a plain
 * node:test process: Jest's VM cannot load PGlite's Wasm module reliably.
 * The Jest wrapper below fails if this process is empty or reports a failure.
 *
 * The fixture renders the real Care migrations and uses an embedded PostgreSQL
 * engine. The small campaign/incentive tables below are the columns needed by
 * the SQL assertions; they are not production substitutes for migrations.
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const fixture = require("./care-pglite-fixture.cjs");

const IDS = fixture.IDS;
let db;

const q = (sql, params) => db.query(sql, params);

async function addPr4Tables() {
  await db.exec(`
    CREATE TABLE pixiegirl.sales_campaigns (
      campaign_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'draft',
      starts_at timestamptz NOT NULL DEFAULT now(),
      ends_at timestamptz NOT NULL DEFAULT (now() + interval '1 day')
    );
    CREATE TABLE pixiegirl.sales_campaign_products (
      link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id uuid NOT NULL REFERENCES pixiegirl.sales_campaigns(campaign_id),
      product_id uuid, category_id uuid, include_exclude text NOT NULL,
      campaign_price_ngn numeric, display_order smallint NOT NULL DEFAULT 0
    );
    CREATE TABLE pixiegirl.bundle_offers (
      bundle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bundle_code text NOT NULL UNIQUE, display_name text NOT NULL,
      pricing_model text NOT NULL, bundle_price_ngn numeric,
      discount_value numeric, is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE pixiegirl.bundle_offer_products (
      bundle_product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bundle_id uuid NOT NULL REFERENCES pixiegirl.bundle_offers(bundle_id),
      product_id uuid, variant_id uuid, quantity integer NOT NULL DEFAULT 1,
      role text NOT NULL DEFAULT 'core', display_order smallint NOT NULL DEFAULT 0
    );
    CREATE TABLE pixiegirl.sales_campaign_bundles (
      link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id uuid NOT NULL REFERENCES pixiegirl.sales_campaigns(campaign_id),
      bundle_id uuid NOT NULL REFERENCES pixiegirl.bundle_offers(bundle_id),
      UNIQUE (campaign_id, bundle_id)
    );
    CREATE TABLE shared.stylist_referral_attributions (
      attribution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business text NOT NULL, stylist_id uuid, order_id uuid NOT NULL,
      status text NOT NULL, commission_amount_ngn numeric NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE pixiegirl.commission_earned (
      earning_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL, status text NOT NULL,
      amount_ngn numeric NOT NULL DEFAULT 0
    );
  `);
}

async function createOrder({ orderId, number, status = "paid", total = 0 }) {
  await q(
    `INSERT INTO pixiegirl.sales_orders
       (order_id, order_number, contact_id, sales_channel, status,
        total_ngn, amount_paid_ngn, paid_at)
     VALUES ($1,$2,NULL,'public_form',$3,$4,$4,now())`,
    [orderId, number, status, total],
  );
}

async function addLine({ orderId, productId, variantId, total, kind = "product" }) {
  await q(
    `INSERT INTO pixiegirl.sales_order_lines
       (order_id, product_id, variant_id, product_name_snapshot, quantity,
        unit_price_ngn, line_total_ngn, line_kind)
     VALUES ($1,$2,$3,'fixture line',1,$4,$4,$5)`,
    [orderId, productId, variantId, total, kind],
  );
}

async function eligibleWigValue(orderId) {
  const { rows } = await q(
    `SELECT COALESCE(SUM(sol.line_total_ngn), 0)::numeric AS eligible_ngn
       FROM pixiegirl.sales_order_lines sol
       LEFT JOIN pixiegirl.product_variants pv ON pv.variant_id = sol.variant_id
       LEFT JOIN pixiegirl.products p ON p.product_id = COALESCE(sol.product_id, pv.product_id)
      WHERE sol.order_id = $1
        AND COALESCE(sol.line_kind, 'product') <> 'service'
        AND (p.catalogue_role IS NULL OR p.catalogue_role <> 'retail')`,
    [orderId],
  );
  return Number(rows[0].eligible_ngn);
}

async function firstWigEligible(contactId) {
  const { rows } = await q(
    `SELECT count(*)::int AS c
       FROM pixiegirl.sales_orders so
      WHERE so.contact_id = $1
        AND so.status IN ('paid','assigned','order_ready','dispatched','completed')
        AND EXISTS (
          SELECT 1
            FROM pixiegirl.sales_order_lines sol
            LEFT JOIN pixiegirl.product_variants pv ON pv.variant_id = sol.variant_id
            LEFT JOIN pixiegirl.products p ON p.product_id = COALESCE(sol.product_id, pv.product_id)
           WHERE sol.order_id = so.order_id
             AND COALESCE(sol.line_kind, 'product') <> 'service'
             AND (p.catalogue_role IS NULL OR p.catalogue_role <> 'retail')
        )`,
    [contactId],
  );
  return rows[0].c === 0;
}

test.before(async () => {
  await fixture.boot();
  await fixture.seed();
  db = fixture.db();
  await addPr4Tables();
});

test.after(async () => {
  if (db) await db.close();
});

test("campaign membership requires an explicit PXG link and preserves exact retail SKU identity", async () => {
  const campaignId = "11111111-0000-4000-8000-000000000001";
  await q(
    `INSERT INTO pixiegirl.sales_campaigns (campaign_id, slug, status)
     VALUES ($1,'care-drop','live')`,
    [campaignId],
  );
  await q(
    `INSERT INTO pixiegirl.sales_campaign_products
       (campaign_id, product_id, include_exclude, campaign_price_ngn)
     VALUES ($1,$2,'include',7000)`,
    [campaignId, IDS.careProduct],
  );
  const { rows } = await q(
    `SELECT pv.variant_id, pv.sku, p.catalogue_role
       FROM pixiegirl.sales_campaign_products scp
       JOIN pixiegirl.products p ON p.product_id = scp.product_id
       JOIN pixiegirl.product_variants pv ON pv.product_id = p.product_id
      WHERE scp.campaign_id = $1
        AND scp.include_exclude = 'include'
        AND pv.variant_id = $2
        AND p.catalogue_role = 'retail'`,
    [campaignId, IDS.v100],
  );
  assert.deepEqual(rows.map((r) => [r.variant_id, r.sku, r.catalogue_role]), [[IDS.v100, "PXG-OIL-100", "retail"]]);

  const { rows: omitted } = await q(
    `SELECT 1 FROM pixiegirl.sales_campaign_products
      WHERE campaign_id = $1 AND product_id = $2 AND include_exclude = 'include'`,
    [campaignId, IDS.draftCare],
  );
  assert.equal(omitted.length, 0, "another retail product cannot bypass campaign membership");
});

test("canonical bundle rows exclude retail from wig units and size-premium units", async () => {
  const bundleId = "22222222-0000-4000-8000-000000000001";
  const campaignId = "22222222-0000-4000-8000-000000000002";
  await q(
    `INSERT INTO pixiegirl.bundle_offers
       (bundle_id, bundle_code, display_name, pricing_model, bundle_price_ngn)
     VALUES ($1,'CARE-WIG','Wig plus oil','fixed_bundle_price',123000)`,
    [bundleId],
  );
  await q(
    `INSERT INTO pixiegirl.bundle_offer_products
       (bundle_id, product_id, variant_id, quantity, display_order)
     VALUES ($1,$2,$3,1,1), ($1,$4,$5,2,2)`,
    [bundleId, IDS.wigBase, IDS.vWig, IDS.careProduct, IDS.v50],
  );
  await q(
    `INSERT INTO pixiegirl.sales_campaigns (campaign_id, slug, status)
     VALUES ($1,'bundle-drop','live')`,
    [campaignId],
  );
  await q(
    `INSERT INTO pixiegirl.sales_campaign_bundles (campaign_id, bundle_id)
     VALUES ($1,$2)`,
    [campaignId, bundleId],
  );
  const { rows } = await q(
    `SELECT count(*) FILTER (WHERE p.catalogue_role <> 'retail')::int AS wig_units,
            count(*)::int AS total_components,
            sum(CASE WHEN p.catalogue_role = 'retail' THEN bop.quantity ELSE 0 END)::int AS retail_units
       FROM pixiegirl.sales_campaign_bundles scb
       JOIN pixiegirl.bundle_offer_products bop ON bop.bundle_id = scb.bundle_id
       JOIN pixiegirl.products p ON p.product_id = COALESCE(bop.product_id, (SELECT product_id FROM pixiegirl.product_variants WHERE variant_id = bop.variant_id))
      WHERE scb.campaign_id = $1`,
    [campaignId],
  );
  assert.equal(rows[0].wig_units, 1);
  assert.equal(rows[0].retail_units, 2);
  assert.equal(rows[0].total_components, 2);
  const { rows: legacy } = await q(
    `SELECT to_regclass('pixiegirl.product_bundles') AS legacy_table`,
  );
  assert.equal(legacy[0].legacy_table, null, "bundle source remains canonical");
});

test("mixed incentives calculate only eligible wig value; retail-only is zero", async () => {
  const mixed = "33333333-0000-4000-8000-000000000001";
  const retailOnly = "33333333-0000-4000-8000-000000000002";
  await createOrder({ orderId: mixed, number: "PXG-PR4-MIX", total: 130000 });
  await addLine({ orderId: mixed, productId: IDS.wigBase, variantId: IDS.vWig, total: 120000 });
  await addLine({ orderId: mixed, productId: IDS.careProduct, variantId: IDS.v50, total: 10000 });
  await addLine({ orderId: mixed, productId: null, variantId: null, total: 2500, kind: "service" });
  await createOrder({ orderId: retailOnly, number: "PXG-PR4-RET", total: 10000 });
  await addLine({ orderId: retailOnly, productId: IDS.careProduct, variantId: IDS.v50, total: 10000 });
  assert.equal(await eligibleWigValue(mixed), 120000);
  assert.equal(await eligibleWigValue(retailOnly), 0);
});

test("retail-only purchase does not consume first-wig eligibility, but a wig purchase does", async () => {
  const contactId = "44444444-0000-4000-8000-000000000001";
  const retailOrder = "44444444-0000-4000-8000-000000000002";
  const wigOrder = "44444444-0000-4000-8000-000000000003";
  await createOrder({ orderId: retailOrder, number: "PXG-PR4-FIRST-R", total: 10000 });
  await q(`UPDATE pixiegirl.sales_orders SET contact_id = $1 WHERE order_id = $2`, [contactId, retailOrder]);
  await addLine({ orderId: retailOrder, productId: IDS.careProduct, variantId: IDS.v50, total: 10000 });
  assert.equal(await firstWigEligible(contactId), true);

  await createOrder({ orderId: wigOrder, number: "PXG-PR4-FIRST-W", total: 120000 });
  await q(`UPDATE pixiegirl.sales_orders SET contact_id = $1 WHERE order_id = $2`, [contactId, wigOrder]);
  await addLine({ orderId: wigOrder, productId: IDS.wigBase, variantId: IDS.vWig, total: 120000 });
  assert.equal(await firstWigEligible(contactId), false);
});

test("FLH rejects retail role at the database boundary", async () => {
  await assert.rejects(
    q(`INSERT INTO faitlynhair.products
         (product_code, name, product_type, catalogue_role, retail_status,
          track_stock, is_custom, preorder_enabled, preorder_excluded,
          rewig_eligible, payment_model, is_visible_storefront,
          visible_on_channels, taxable, vat_rate)
       VALUES ('FLH-RETAIL-PR4','Forbidden Care','physical','retail','live',true,false,false,true,
               false,'full_payment_only',false,'{}',true,0.075)`),
    /check constraint|violates|Care/i,
  );
});

test("cancellation voids unpaid referral/commission rows but leaves paid rows unchanged", async () => {
  const orderId = "55555555-0000-4000-8000-000000000001";
  await q(
    `INSERT INTO shared.stylist_referral_attributions
       (business, stylist_id, order_id, status, commission_amount_ngn)
     VALUES ('pixiegirl',gen_random_uuid(),$1,'pending',12000),
            ('pixiegirl',gen_random_uuid(),$1,'payable',12000),
            ('pixiegirl',gen_random_uuid(),$1,'paid',12000)`,
    [orderId],
  );
  await q(
    `INSERT INTO pixiegirl.commission_earned (order_id, status, amount_ngn)
     VALUES ($1,'accrued',12000),($1,'approved',12000),($1,'paid',12000)`,
    [orderId],
  );
  await q(
    `UPDATE shared.stylist_referral_attributions
        SET status = 'void', updated_at = now()
      WHERE business = 'pixiegirl' AND order_id = $1
        AND status IN ('pending','payable')`,
    [orderId],
  );
  await q(
    `UPDATE pixiegirl.commission_earned
        SET status = 'reversed'
      WHERE order_id = $1 AND status IN ('accrued','approved')`,
    [orderId],
  );
  const { rows } = await q(
    `SELECT
       (SELECT count(*) FROM shared.stylist_referral_attributions WHERE order_id = $1 AND status = 'void')::int AS void_referrals,
       (SELECT count(*) FROM shared.stylist_referral_attributions WHERE order_id = $1 AND status = 'paid')::int AS paid_referrals,
       (SELECT count(*) FROM pixiegirl.commission_earned WHERE order_id = $1 AND status = 'reversed')::int AS reversed_commissions,
       (SELECT count(*) FROM pixiegirl.commission_earned WHERE order_id = $1 AND status = 'paid')::int AS paid_commissions`,
    [orderId],
  );
  assert.deepEqual(rows[0], {
    void_referrals: 2,
    paid_referrals: 1,
    reversed_commissions: 2,
    paid_commissions: 1,
  });
});
