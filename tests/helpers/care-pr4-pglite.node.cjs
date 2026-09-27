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
      amount_ngn numeric NOT NULL DEFAULT 0,
      payroll_run_id uuid, paid_at timestamptz
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

test.before(async () => {
  await fixture.boot();
  await fixture.seed();
  db = fixture.db();
  await addPr4Tables();
});

test.after(async () => {
  if (db) await db.close();
});

test("campaign quote pricing: retail needs explicit membership, keeps its exact SKU, never counts as a wig", async () => {
  // Calls the REAL campaigns.public.service.priceQuoteLine (the function the
  // landing quote and checkout rely on), not a re-implementation of its SQL.
  const campaigns = require("../../src/modules/sales_campaigns/campaigns.public.service");
  const campaignId = "11111111-0000-4000-8000-000000000001";
  const otherCampaign = "11111111-0000-4000-8000-000000000009";
  await q(`INSERT INTO pixiegirl.sales_campaigns (campaign_id, slug, status) VALUES ($1,'care-drop','live'), ($2,'no-care','live')`,
    [campaignId, otherCampaign]);
  await q(
    `INSERT INTO pixiegirl.sales_campaign_products (campaign_id, product_id, include_exclude, campaign_price_ngn)
     VALUES ($1,$2,'include',7000)`,
    [campaignId, IDS.careProduct],
  );
  const priced = await campaigns.priceQuoteLine({
    brand: "pixiegirl", campaign_id: campaignId,
    item: { variant_id: IDS.v100, product_id: IDS.careProduct, quantity: 1 },
  });
  assert.equal(priced.kind, "retail");
  assert.equal(priced.wig_units, 0, "a bottle is never another wig");
  assert.equal(priced.unit_price_ngn, "8000.00", "the exact 100 ml SKU's live price, not the 50 ml default");
  assert.equal(Number(priced.vat_rate), 0.075, "taxable care carries its VAT into the quote");
  // Not a member of this campaign → not priced (checkout refuses it too).
  const outside = await campaigns.priceQuoteLine({
    brand: "pixiegirl", campaign_id: otherCampaign,
    item: { variant_id: IDS.v100, product_id: IDS.careProduct, quantity: 1 },
  });
  assert.equal(outside, null, "retail cannot bypass campaign membership");
  // A retail product without its exact SKU is refused, never defaulted.
  await assert.rejects(
    campaigns.priceQuoteLine({ brand: "pixiegirl", campaign_id: campaignId, item: { product_id: IDS.careProduct, quantity: 1 } }),
    (err) => err.code === "RETAIL_VARIANT_REQUIRED",
  );
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

test("incentive basis (real helper): mixed subtracts only the retail share; retail-only is zero; others untouched", async () => {
  const { retailShare, minusShare } = require("../../src/modules/sales/incentive-basis");
  const mixed = "33333333-0000-4000-8000-000000000001";
  const retailOnly = "33333333-0000-4000-8000-000000000002";
  const withService = "33333333-0000-4000-8000-000000000003";
  await createOrder({ orderId: mixed, number: "PXG-PR4-MIX", total: 132500 });
  await addLine({ orderId: mixed, productId: IDS.wigBase, variantId: IDS.vWig, total: 120000 });
  await addLine({ orderId: mixed, productId: IDS.careProduct, variantId: IDS.v50, total: 10000 });
  await addLine({ orderId: mixed, productId: null, variantId: null, total: 2500, kind: "service" });
  await createOrder({ orderId: retailOnly, number: "PXG-PR4-RET", total: 10000 });
  await addLine({ orderId: retailOnly, productId: IDS.careProduct, variantId: IDS.v50, total: 10000 });
  await createOrder({ orderId: withService, number: "PXG-PR4-SVC", total: 2500 });
  await addLine({ orderId: withService, productId: null, variantId: null, total: 2500, kind: "service" });

  const m = await retailShare({ brand: "pixiegirl", order_id: mixed });
  assert.equal(m.hasRetail, true);
  assert.equal(m.retailOnly, false);
  // Services keep counting exactly as before PR 4 — only retail is removed.
  assert.equal(minusShare("132500", m.retailTotal).toFixed(2), "122500.00");
  const r = await retailShare({ brand: "pixiegirl", order_id: retailOnly });
  assert.equal(r.retailOnly, true, "retail-only earns nothing");
  const svc = await retailShare({ brand: "pixiegirl", order_id: withService });
  assert.equal(svc.hasRetail, false, "a service-only order is untouched (PR 4 had zeroed it)");
  assert.equal(svc.retailOnly, false);
});

test("first-wig eligibility (real coupon.firstTimeOk): Care-only history keeps it; wig or service history uses it", async () => {
  const coupons = require("../../src/modules/retention/coupon.service");
  const contactId = "44444444-0000-4000-8000-000000000001";
  const retailOrder = "44444444-0000-4000-8000-000000000002";
  const wigOrder = "44444444-0000-4000-8000-000000000003";
  await createOrder({ orderId: retailOrder, number: "PXG-PR4-FIRST-R", total: 10000 });
  await q(`UPDATE pixiegirl.sales_orders SET contact_id = $1 WHERE order_id = $2`, [contactId, retailOrder]);
  await addLine({ orderId: retailOrder, productId: IDS.careProduct, variantId: IDS.v50, total: 10000 });
  assert.equal(await coupons.firstTimeOk({ brand: "pixiegirl", contact_id: contactId }), true);

  await createOrder({ orderId: wigOrder, number: "PXG-PR4-FIRST-W", total: 120000 });
  await q(`UPDATE pixiegirl.sales_orders SET contact_id = $1 WHERE order_id = $2`, [contactId, wigOrder]);
  await addLine({ orderId: wigOrder, productId: IDS.wigBase, variantId: IDS.vWig, total: 120000 });
  assert.equal(await coupons.firstTimeOk({ brand: "pixiegirl", contact_id: contactId }), false);

  // A service-only past order counted before PR 4 and still does.
  const svcContact = "44444444-0000-4000-8000-000000000009";
  const svcOrder = "44444444-0000-4000-8000-000000000008";
  await createOrder({ orderId: svcOrder, number: "PXG-PR4-FIRST-S", total: 2500 });
  await q(`UPDATE pixiegirl.sales_orders SET contact_id = $1 WHERE order_id = $2`, [svcContact, svcOrder]);
  await addLine({ orderId: svcOrder, productId: null, variantId: null, total: 2500, kind: "service" });
  assert.equal(await coupons.firstTimeOk({ brand: "pixiegirl", contact_id: svcContact }), false);
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

test("cancellation (real repo/service): voids unpaid referral + commission rows, leaves paid rows", async () => {
  const programmeRepo = require("../../src/modules/stylist_programme/programme.repo");
  const payroll = require("../../src/shared/hr_payroll/payroll.service");
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
  const voided = await programmeRepo.voidAttributionsForOrder({ business: "pixiegirl", order_id: orderId });
  assert.equal(voided.length, 2);
  const reversed = await payroll.reverseForCancelledOrder({ brand: "pixiegirl", order_id: orderId });
  assert.equal(reversed, 2);
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
