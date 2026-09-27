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

const fixture = require("./care-pglite-fixture.cjs");
const { IDS, PXG, seed } = fixture;
// `db` is created by boot(); a getter keeps every existing `db.query(...)`
// call site unchanged.
const dbProxy = new Proxy({}, { get: (_t, k) => { const d = fixture.db(); const v = d[k]; return typeof v === "function" ? v.bind(d) : v; } });
const db = dbProxy;

before(async () => { await fixture.boot(); }, 120_000);
after(async () => { const d = fixture.db(); if (d) await d.close(); });

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
  // The oil is taxable at 7.5 %: createOrder adds VAT on top, so the quote
  // must too, or the gateway charges more than the bag showed.
  assert.equal(q.tax_ngn, "375.00");
  assert.equal(q.total_ngn, "5375.00");
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
  // A legacy non-retail row (the public add path now refuses bare hair-base
  // variants — see the next test) still quotes the wig zone tier untouched.
  await db.query(
    `INSERT INTO shared.cart_items (cart_id, business, product_id, variant_id, quantity, product_name_snapshot, unit_price_ngn)
     VALUES ($1, $2, $3, $4, 2, 'Classic Base', 120000)`,
    [cart.cart_id, PXG, IDS.wigBase, IDS.vWig],
  );
  const q = await storefront.quoteCart({
    brand: PXG, cart_id: cart.cart_id,
    address: { country_code: "NG", zone_code: "NG" }, display_currency: "NGN",
  });
  assert.equal(q.has_care_items, false);
  assert.equal(q.delivery_available, true);
  assert.equal(q.delivery_ngn, "2500.00", "2 wigs stay in tier 1–2");
  assert.equal(q.lines[0].unavailable, true, "a bare hair-base line is never publicly sellable");
  assert.equal(q.tax_ngn, "0.00");
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
  // PR 3: a retail-containing DISPATCH order is queued for a human the moment it
  // is placed — the zone rate card prices by wig quantity, so it cannot price
  // this basket. The durable flag (not a text status filter) is what later
  // blocks dispatch until the fee is agreed, consented and reconciled.
  const queued = await db.query(`
    SELECT o.needs_delivery_review, r.review_id, r.status, r.initial_fee_ngn
    FROM pixiegirl.sales_orders o
    LEFT JOIN pixiegirl.delivery_fee_reviews r ON r.order_id = o.order_id
    WHERE o.order_id = $1
  `, [order.order_id]);
  assert.equal(queued.rows[0].needs_delivery_review, true, "mixed dispatch order is queued");
  assert.equal(queued.rows[0].status, "pending_review");
  assert.equal(Number(queued.rows[0].initial_fee_ngn), Number(order.shipping_fee_ngn));
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

test("storefront: a raw hair-base variant can't be added or checked out publicly (no ₦0 / private-stock leak)", async () => {
  const cartService = require("../../src/modules/storefront/cart.service");
  const storefront = require("../../src/modules/storefront/storefront.service");
  const cart = await cartService.getOrCreateCart({ business: PXG, session_token: "guest-wigdel" });
  // Hair bases are private stock (000043) and usually ₦0 because a wig sells
  // through its styled record; a guessed/leaked base variant id must not buy one.
  await assert.rejects(
    cartService.addStorefrontItem({ business: PXG, cart_id: cart.cart_id, item: { variant_id: IDS.vWig, quantity: 1 } }),
    (err) => err.code === "VARIANT_NOT_FOUND",
  );
  await assert.rejects(
    cartService.addStorefrontItem({ business: PXG, cart_id: cart.cart_id, item: { product_id: IDS.wigBase, quantity: 1 } }),
    (err) => err.code === "VARIANT_NOT_FOUND",
  );
  // …and a legacy row already in a bag refuses at checkout.
  await db.query(
    `INSERT INTO shared.cart_items (cart_id, business, product_id, variant_id, quantity, product_name_snapshot, unit_price_ngn)
     VALUES ($1, $2, $3, $4, 1, 'Classic Base', 0)`,
    [cart.cart_id, PXG, IDS.wigBase, IDS.vWig],
  );
  await assert.rejects(
    storefront.checkout({
      brand: PXG, cart_id: cart.cart_id,
      input: {
        fulfilment_type: "delivery",
        contact: { first_name: "Bee", phone: "+2348022222222", address: { line1: "2 Wig Rd", city: "Lagos", country_code: "NG", zone_code: "NG" } },
      },
    }),
    (err) => err.code === "CART_ITEM_UNRESOLVED",
  );
});

test("cart: item edits are scoped to the shopper's own cart; Care quantities are stock-only", async () => {
  const cartService = require("../../src/modules/storefront/cart.service");
  const mine = await cartService.getOrCreateCart({ business: PXG, session_token: "guest-owner" });
  const theirs = await cartService.getOrCreateCart({ business: PXG, session_token: "guest-other" });
  const line = await cartService.addStorefrontItem({ business: PXG, cart_id: mine.cart_id, item: { variant_id: IDS.v50, quantity: 1 } });
  // Another shopper's cart id + my item id must not touch my bag.
  await assert.rejects(
    cartService.updateItem({ business: PXG, cart_id: theirs.cart_id, cart_item_id: line.cart_item_id, quantity: 2 }),
    (err) => /not found/i.test(err.message),
  );
  await cartService.removeItem({ business: PXG, cart_id: theirs.cart_id, cart_item_id: line.cart_item_id });
  const still = await cartService.getCart({ business: PXG, session_token: "guest-owner" });
  assert.equal(still.items.length, 1, "a foreign cart id cannot delete my line");
  // The stepper can't back-order a stock-only SKU past its sellable shelf
  // (earlier tests reserved some units, so read the live figure).
  const resolver = require("../../src/modules/catalogue/retail-resolver");
  const { available } = await resolver.resolveSellableVariant({ brand: PXG, variant_id: IDS.v50 });
  assert.ok(available >= 1);
  await assert.rejects(
    cartService.updateItem({ business: PXG, cart_id: mine.cart_id, cart_item_id: line.cart_item_id, quantity: available + 1 }),
    (err) => err.code === "OUT_OF_STOCK",
  );
  const ok = await cartService.updateItem({ business: PXG, cart_id: mine.cart_id, cart_item_id: line.cart_item_id, quantity: available });
  assert.equal(ok.quantity, available);
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
  assert.equal(await storefront.careEnabled({ brand: PXG }), true);
  assert.equal(await storefront.careEnabled({ brand: "faitlynhair" }), false);
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
