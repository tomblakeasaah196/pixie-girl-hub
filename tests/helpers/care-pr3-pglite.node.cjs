"use strict";

/**
 * Embedded-PostgreSQL (PGlite) coverage for PR 3 — Care & Accessories order
 * links, the `/o` order-form checkout, the manual delivery-fee review
 * lifecycle, the Stylist Studio bypass and wig-only / FLH regressions.
 *
 * REAL SQL: the real 000094/000095/000096 templates, the real repos/services
 * (smartcomm order links + resolvers, storefront order form, sales, delivery
 * review, service-jobs studio line query). Test doubles only for things that
 * leave the process: the payment gateway (fixture), brand URL lookup, the GL
 * poster (recorded, so the idempotency key + lines can be asserted) and the
 * Comms Studio dispatcher (recorded).
 *
 * This is embedded-PG evidence, NOT staging validation.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fixture = require("./care-pglite-fixture.cjs");
const { IDS, PXG, seed } = fixture;

const FLH = "faitlynhair";
const STAFF = { user_id: "eeeeeeee-0000-4000-8000-000000000001", full_name: "Test Staff" };
const q = (sql, params) => fixture.db().query(sql, params);

const EXTRA_DDL = (B) => `
CREATE TABLE IF NOT EXISTS ${B}.sales_order_payments (
  payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES ${B}.sales_orders(order_id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'bank_transfer',
  provider text, provider_reference text,
  amount_ngn numeric(14,2) NOT NULL CHECK (amount_ngn > 0),
  status text NOT NULL DEFAULT 'pending',
  refunded_amount_ngn numeric(14,2) NOT NULL DEFAULT 0,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ${B}.credit_notes (
  credit_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES ${B}.invoices(invoice_id),
  total_ngn numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'draft'
);
`;
const LINKS_DDL = `
CREATE TABLE IF NOT EXISTS shared.smartcomm_order_links (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business text NOT NULL, channel_id uuid, contact_id uuid, created_by uuid,
  mode text NOT NULL DEFAULT 'shop', sales_channel text NOT NULL DEFAULT 'whatsapp',
  items jsonb NOT NULL DEFAULT '[]', cart jsonb, notes text,
  status text NOT NULL DEFAULT 'active',
  public_slug text NOT NULL UNIQUE,
  expires_at timestamptz, order_id uuid, order_number text, ordered_at timestamptz,
  open_count integer NOT NULL DEFAULT 0, first_opened_at timestamptz, last_opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
`;

const posted = [];
const dispatched = [];
let payNo = 1;
let CONTACT = null;

before(async () => {
  await fixture.boot();
  await q(LINKS_DDL);
  for (const b of [PXG, FLH]) await fixture.db().exec(EXTRA_DDL(b));
  await seed();
  // PR 3 suites place many orders — top up sellable stock so the lifecycle
  // tests never trip the (separately tested) OUT_OF_STOCK rule.
  await q(`UPDATE pixiegirl.stock_levels SET on_hand = 500 WHERE location_id = $1`, [IDS.loc]);
  const c = await q(`INSERT INTO shared.contacts (display_name, first_name, primary_phone)
                     VALUES ('Review Customer','Review','+2348010000099') RETURNING contact_id`);
  CONTACT = c.rows[0].contact_id;
  // Out-of-process doubles, installed as PROPERTY swaps on the real modules
  // (callers resolve them at call time).
  require("../../src/utils/brand-urls").orderLinkUrl = async (_b, slug) => `https://shop.test/o/${slug}`;
  require("../../src/modules/accounting/accounting.service").postEntry = async (args) => {
    posted.push(args);
    return { journal_entry_id: "je-" + posted.length };
  };
  require("../../src/modules/comms_studio/dispatcher").dispatch = async (args) => {
    dispatched.push(args);
    return { dispatched: true, channel: "whatsapp" };
  };
}, 120_000);
after(async () => { const d = fixture.db(); if (d) await d.close(); });

// ── helpers ────────────────────────────────────────────────
async function retailDispatchOrder({ shipping = 2500, lines } = {}) {
  const sales = require("../../src/modules/sales/sales.service");
  return sales.createOrder({
    brand: PXG, user: STAFF, request_id: `t-${Math.random()}`,
    input: {
      contact_id: CONTACT, sales_channel: "quick_sale", order_type: "dispatch",
      payment_plan: "full", shipping_fee_ngn: shipping,
      lines: lines || [{ variant_id: IDS.v50, quantity: 1 }],
    },
  });
}
async function markPaid(order_id) {
  await q(`UPDATE pixiegirl.sales_orders SET status = 'paid', amount_paid_ngn = total_ngn WHERE order_id = $1`, [order_id]);
}
async function addPayment(order_id, amount, status = "captured", refunded = 0) {
  const { rows } = await q(
    `INSERT INTO pixiegirl.sales_order_payments (payment_number, order_id, amount_ngn, status, refunded_amount_ngn, captured_at)
     VALUES ($1,$2,$3,$4,$5, now()) RETURNING payment_id`,
    [`PXG-PAY-${String(payNo++).padStart(4, "0")}`, order_id, amount, status, refunded],
  );
  if (status === "captured")
    await q(`UPDATE pixiegirl.sales_order_payments SET status = 'captured' WHERE payment_id = $1`, [rows[0].payment_id]);
  return rows[0].payment_id;
}
const orderRow = async (id) => (await q(`SELECT * FROM pixiegirl.sales_orders WHERE order_id = $1`, [id])).rows[0];
// The validator middleware throws a ZodError (Express 5 forwards it); returns
// the error or null.
const validate = async (body) => {
  const v = require("../../src/modules/smartcomm/smartcomm.validator");
  try {
    v.validateOrderLinkCreate({ body }, {}, () => {});
    return null;
  } catch (err) {
    return err;
  }
};
const dr = () => require("../../src/modules/sales/delivery-review.service");

// ── order links ────────────────────────────────────────────
test("order-link validator: retail needs an exact variant_id; styled fields on retail are forged", async () => {
  assert.equal(await validate({ items: [{ kind: "retail", variant_id: IDS.v100, qty: 1 }] }), null);
  assert.ok(await validate({ items: [{ kind: "retail", product_id: IDS.careProduct, qty: 1 }] }), "no variant_id refused");
  assert.ok(
    await validate({ items: [{ kind: "retail", variant_id: IDS.v100, size_code: "M", qty: 1 }] }),
    "retail + styled size refused",
  );
});

test("order link: exact retail SKU round-trips; live price replaces a tampered link price", async () => {
  const links = require("../../src/modules/smartcomm/smartcomm.order-links.service");
  const created = await links.createLink({
    brand: PXG, user: STAFF, request_id: "t-link",
    input: {
      sales_channel: "whatsapp",
      items: [
        { kind: "retail", product_id: IDS.careProduct, variant_id: IDS.v100, sku: "PXG-OIL-100", qty: 2, price_ngn: "1" },
        { kind: "base", product_id: IDS.wigBase, qty: 1 },
      ],
    },
  });
  assert.match(created.url, /\/o\//);
  assert.deepEqual(created.warnings, []);
  const ctx = await links.getPublicContext(created.slug);
  const retail = ctx.items.find((i) => i.kind === "retail");
  assert.equal(retail.variant_id, IDS.v100, "exact 100 ml — never the default 50 ml");
  assert.equal(retail.variant_label, "100 ml");
  assert.equal(Number(retail.price_ngn), 8000, "live storefront price, not the tampered ₦1");
  assert.equal(retail.image_url, "https://cdn.test/oil.jpg");
  assert.deepEqual(retail.lines, [{ variant_id: IDS.v100, quantity: 2 }]);
  // Base link regression: products has no is_active column — the old query
  // threw and every base link resolved to zero lines.
  const base = ctx.items.find((i) => i.kind === "base");
  assert.equal(base.lines.length, 1, "base link resolves a sellable line");
  assert.equal(base.lines[0].variant_id, IDS.vWig);
  assert.equal(ctx.has_care_items, true);
  assert.equal(ctx.delivery_available, false);
  assert.equal(ctx.care_delivery_notice, "EXTRA DELIVERY FEES MAY APPLY");
});

test("order link: forged retail items refuse (wig variant, draft SKU, FLH, missing variant)", async () => {
  const resolvers = require("../../src/modules/smartcomm/smartcomm.order-links.resolvers");
  const [wigAsRetail, draft, noVariant] = await resolvers.resolveItems(PXG, [
    { kind: "retail", variant_id: IDS.vWig, qty: 1 },
    { kind: "retail", variant_id: IDS.vDraft, qty: 1 },
    { kind: "retail", product_id: IDS.careProduct, qty: 1 },
  ]);
  for (const r of [wigAsRetail, draft, noVariant]) {
    assert.equal(r.lines.length, 0, `refused: ${r.unresolved_reason}`);
    assert.ok(r.unresolved_reason);
  }
  const [flh] = await resolvers.resolveItems(FLH, [{ kind: "retail", variant_id: IDS.v50, qty: 1 }]);
  assert.equal(flh.lines.length, 0, "FLH never resolves a retail link");
  // A base item may only pin a variant OF THAT product: pairing the wig base
  // with a Care SKU must not sell the bottle under the wig's name.
  const [basePinnedForeign] = await resolvers.resolveItems(PXG, [
    { kind: "base", product_id: IDS.wigBase, variant_id: IDS.v50, qty: 1 },
  ]);
  assert.equal(basePinnedForeign.variant_id, IDS.vWig, "foreign pin ignored → the base's own default SKU");
});

// ── /o order-form checkout ─────────────────────────────────
function formInput(extra) {
  return {
    first_name: "Ada", last_name: "Obi", phone: "+2348010000001",
    sales_channel: "public_form", payment_plan: "full", payment_gateway: "nomba",
    fulfilment_type: "pickup",
    items: [{ variant_id: IDS.v50, quantity: 1 }],
    ...extra,
  };
}

test("/o checkout: retail pickup places a full-payment order; double-submit returns the same order", async () => {
  const sf = require("../../src/modules/storefront/storefront.service");
  const a = await sf.submitOrderForm({ brand: PXG, request_id: "t-o-1", input: formInput({ client_idempotency_key: "order:slug-dup" }) });
  assert.ok(a.order_id);
  const row = await orderRow(a.order_id);
  assert.equal(row.payment_plan, "full");
  assert.equal(Number(row.shipping_fee_ngn || 0), 0);
  assert.equal(row.needs_delivery_review, false, "pickup is never queued");
  const b = await sf.submitOrderForm({ brand: PXG, request_id: "t-o-2", input: formInput({ client_idempotency_key: "order:slug-dup" }) });
  assert.equal(b.order_id, a.order_id, "idempotent: no second order");
  const n = await q(`SELECT count(*)::int AS n FROM pixiegirl.sales_orders WHERE client_idempotency_key = 'order:slug-dup'`);
  assert.equal(n.rows[0].n, 1);
});

test("/o checkout: retail delivery is refused fail-closed with the exact MAY notice (never ₦0)", async () => {
  const sf = require("../../src/modules/storefront/storefront.service");
  await assert.rejects(
    sf.submitOrderForm({
      brand: PXG, request_id: "t-o-3",
      input: formInput({ fulfilment_type: "delivery", zone_code: "NG", address: { line1: "1 Test St", country_code: "NG" }, delivery_address: "1 Test St" }),
    }),
    (err) => {
      assert.equal(err.code, "RETAIL_DELIVERY_ARRANGED");
      const msg = err.options?.user_message || err.user_message || "";
      assert.match(msg, /EXTRA DELIVERY FEES MAY APPLY/);
      assert.doesNotMatch(msg, /WILL APPLY/);
      return true;
    },
  );
});

test("/o checkout: wig-only delivery still charges the zone tier (unchanged)", async () => {
  const sf = require("../../src/modules/storefront/storefront.service");
  const r = await sf.submitOrderForm({
    brand: PXG, request_id: "t-o-4",
    input: formInput({
      items: [{ variant_id: IDS.vWig, quantity: 1 }],
      fulfilment_type: "delivery", zone_code: "NG",
      address: { line1: "1 Test St", country_code: "NG" }, delivery_address: "1 Test St",
      client_idempotency_key: "order:wig-only",
    }),
  });
  const row = await orderRow(r.order_id);
  assert.equal(Number(row.shipping_fee_ngn), 2500, "zone tier 1–2 wigs");
  assert.equal(row.needs_delivery_review, false, "wig-only is never queued");
});

// ── delivery-fee review lifecycle ──────────────────────────
test("review: increase → consent applies the fee → a SEPARATE post-consent top-up settles and unblocks dispatch", async () => {
  const sales = require("../../src/modules/sales/sales.service");
  const order = await retailDispatchOrder({ shipping: 2500 });
  await markPaid(order.order_id);
  let row = await orderRow(order.order_id);
  assert.equal(row.needs_delivery_review, true);
  const totalBefore = Number(row.total_ngn);

  // Dispatch blocked — app message AND the raw DB trigger.
  await assert.rejects(
    sales.setOrderStatus({ brand: PXG, user: STAFF, request_id: "t", id: order.order_id, status: "dispatched" }),
    (e) => e.code === "DELIVERY_REVIEW_PENDING",
  );
  await assert.rejects(
    q(`UPDATE pixiegirl.sales_orders SET status = 'dispatched' WHERE order_id = $1`, [order.order_id]),
    /cannot dispatch/,
  );
  // The bare delivery-fee setter is not a side door around the review.
  await assert.rejects(
    sales.setDeliveryFee({ brand: PXG, user: STAFF, request_id: "t", id: order.order_id, fee_ngn: 0 }),
    (e) => e.code === "DELIVERY_REVIEW_REQUIRED",
  );

  // openReview is idempotent (the order was auto-queued at placement).
  const again = await dr().openReview({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id });
  const count = await q(`SELECT count(*)::int AS n FROM pixiegirl.delivery_fee_reviews WHERE order_id = $1`, [order.order_id]);
  assert.equal(count.rows[0].n, 1);
  assert.equal(again.status, "pending_review");

  const p = await dr().proposeFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, proposed_fee_ngn: 4000, calculation_basis: "Courier quote #123" });
  assert.equal(p.review.status, "awaiting_customer");
  assert.equal(Number(p.review.difference_ngn), 1500);

  // No top-up before consent — and the ORIGINAL payment can never be one.
  const early = await addPayment(order.order_id, 1500);
  await assert.rejects(
    dr().verifyTopUp({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, payment_id: early }),
    (e) => e.code === "CONSENT_REQUIRED",
  );

  posted.length = 0; dispatched.length = 0;
  const consent = await dr().recordConsent({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, accepted: true, channel: "whatsapp", reference: "msg-42" });
  assert.equal(consent.next_action, "verify_topup");
  // The agreed fee is on the order NOW, so the balance (and the link) carry it…
  row = await orderRow(order.order_id);
  assert.equal(Number(row.shipping_fee_ngn), 4000);
  assert.equal(Number(row.total_ngn), totalBefore + 1500, "total reconciled at consent");
  assert.ok(consent.payment_link && consent.payment_link.checkout_url, "top-up link minted for the new balance");
  // …but the order still can't ship until the difference is actually paid.
  assert.equal(row.needs_delivery_review, true);
  await assert.rejects(q(`UPDATE pixiegirl.sales_orders SET status = 'dispatched' WHERE order_id = $1`, [order.order_id]), /cannot dispatch/);
  // Paid order → revenue recognised → exactly one balanced shipping-delta entry.
  assert.equal(posted.length, 1, "one GL adjusting entry");
  assert.equal(posted[0].entry.idempotency_key, `delivery_review:${consent.review.review_id}`);
  const { ACCOUNTS } = require("../../src/modules/accounting/posting-map");
  const lines = posted[0].lines;
  assert.equal(lines.length, 2, JSON.stringify(lines));
  const debit = lines.find((l) => l.debit_ngn);
  const credit = lines.find((l) => l.credit_ngn);
  assert.equal(debit.account_code, ACCOUNTS.CUSTOMER_DEPOSITS);
  assert.equal(credit.account_code, ACCOUNTS.SHIPPING_REVENUE);
  assert.equal(Number(debit.debit_ngn), 1500);
  assert.equal(Number(credit.credit_ngn), 1500);
  // Consent can't be flipped or the fee re-priced under it.
  await assert.rejects(
    dr().recordConsent({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, accepted: false, channel: "phone", reference: "call" }),
    (e) => e.code === "CONSENT_ALREADY_RECORDED",
  );
  await assert.rejects(
    dr().proposeFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, proposed_fee_ngn: 9000, calculation_basis: "Try again" }),
    (e) => e.code === "CONSENT_ALREADY_RECORDED",
  );

  // A payment taken BEFORE consent (e.g. the original checkout payment) is
  // not the separate top-up.
  await assert.rejects(
    dr().verifyTopUp({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, payment_id: early }),
    (e) => e.code === "TOPUP_PREDATES_CONSENT",
  );
  const pending = await addPayment(order.order_id, 1500, "pending");
  await assert.rejects(
    dr().verifyTopUp({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, payment_id: pending }),
    (e) => e.code === "PAYMENT_NOT_VERIFIED",
  );
  const short = await addPayment(order.order_id, 1000);
  await assert.rejects(
    dr().verifyTopUp({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, payment_id: short }),
    (e) => e.code === "TOPUP_SHORT",
  );

  posted.length = 0; dispatched.length = 0;
  const topUp = await addPayment(order.order_id, 1500);
  const done = await dr().verifyTopUp({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, payment_id: topUp });
  assert.equal(done.review.status, "accepted");
  row = await orderRow(order.order_id);
  assert.equal(Number(row.shipping_fee_ngn), 4000);
  assert.equal(Number(row.total_ngn), totalBefore + 1500, "not applied twice");
  assert.equal(row.needs_delivery_review, false);
  assert.equal(posted.length, 0, "the ledger was reconciled at consent — no second entry");
  assert.equal(dispatched[0].event_key, "delivery_fee_settled");
  assert.ok(done.review.customer_notified_at, "notified only because dispatch reported sent");

  const ev = await q(`SELECT event_type FROM pixiegirl.delivery_fee_review_events WHERE order_id = $1 ORDER BY created_at`, [order.order_id]);
  assert.deepEqual(
    ev.rows.map((r) => r.event_type),
    ["opened", "fee_proposed", "consent_received", "topup_verified", "settled"],
    "complete, ordered audit trail",
  );

  // Now dispatch is allowed.
  const out = await sales.setOrderStatus({ brand: PXG, user: STAFF, request_id: "t", id: order.order_id, status: "dispatched" });
  assert.equal(out.status, "dispatched");
});

test("review: an UNPAID order's fee change posts no GL delta (order.paid will post the final figures)", async () => {
  const order = await retailDispatchOrder({ shipping: 1000 });
  await dr().proposeFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, proposed_fee_ngn: 1000, calculation_basis: "Same as agreed" });
  posted.length = 0;
  const c = await dr().confirmFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id });
  assert.equal(c.review.status, "confirmed");
  const order2 = await retailDispatchOrder({ shipping: 1000 });
  await dr().proposeFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order2.order_id, proposed_fee_ngn: 3000, calculation_basis: "Courier" });
  await dr().recordConsent({ brand: PXG, user: STAFF, request_id: "t", order_id: order2.order_id, accepted: true, channel: "whatsapp", reference: "ok" });
  assert.equal(posted.length, 0, "no adjusting entry before revenue is recognised — else shipping counts twice");
  assert.equal(Number((await orderRow(order2.order_id)).shipping_fee_ngn), 3000);
});

test("review: a lower fee on an over-paid order needs refund evidence; a credit note is not reversed twice", async () => {
  const order = await retailDispatchOrder({ shipping: 4000 });
  await markPaid(order.order_id);
  await dr().proposeFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, proposed_fee_ngn: 2500, calculation_basis: "Cheaper courier" });
  // Confirming would leave the customer ₦1,500 over-paid with no refund.
  await assert.rejects(
    dr().confirmFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id }),
    (e) => e.code === "REFUND_REQUIRED",
  );
  const inv = await q(`INSERT INTO pixiegirl.invoices (invoice_number, order_id, status, total_ngn) VALUES ('INV-CN-1',$1,'partially_refunded', 1) RETURNING invoice_id`, [order.order_id]);
  const cn = await q(`INSERT INTO pixiegirl.credit_notes (credit_note_number, invoice_id, total_ngn, status) VALUES ('CN-1',$1,1500,'issued') RETURNING credit_note_id`, [inv.rows[0].invoice_id]);
  posted.length = 0;
  const done = await dr().verifyRefund({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, credit_note_id: cn.rows[0].credit_note_id });
  assert.equal(done.review.status, "credited");
  assert.equal(posted.length, 0, "the credit note already reversed the difference on the GL");
  const invAfter = await q(`SELECT total_ngn FROM pixiegirl.invoices WHERE invoice_id = $1`, [inv.rows[0].invoice_id]);
  assert.equal(Number(invAfter.rows[0].total_ngn), 1, "invoice not resynced down on top of the credit note");
  assert.equal(Number((await orderRow(order.order_id)).shipping_fee_ngn), 2500);
});

test("review: turning the rollout flag OFF never strands an already-queued order", async () => {
  const { config } = require("../../src/config/env");
  const order = await retailDispatchOrder({ shipping: 2000 });
  config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = false;
  try {
    const queue = await dr().listQueue({ brand: PXG, page: 1, page_size: 100 });
    assert.ok(queue.data.some((r) => r.order_id === order.order_id));
    const c = await dr().confirmFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id });
    assert.equal(c.review.status, "confirmed");
    assert.equal((await orderRow(order.order_id)).needs_delivery_review, false);
  } finally {
    config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = true;
  }
});

test("review: customer refuses the increase → dispatch stays blocked → re-price releases it", async () => {
  const order = await retailDispatchOrder({ shipping: 2500 });
  await markPaid(order.order_id);
  await dr().proposeFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, proposed_fee_ngn: 6000, calculation_basis: "Remote area courier" });
  const r = await dr().recordConsent({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, accepted: false, channel: "phone", reference: "call-7" });
  assert.equal(r.review.status, "declined");
  assert.equal((await orderRow(order.order_id)).needs_delivery_review, true, "declined must NOT release dispatch");
  await assert.rejects(q(`UPDATE pixiegirl.sales_orders SET status = 'dispatched' WHERE order_id = $1`, [order.order_id]), /cannot dispatch/);

  const routed = await dr().routeDecline({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id });
  assert.equal(routed.cancellation_fee_applied, false, "no invented cancellation fee");
  assert.equal(routed.next_action, "staff_refund_review");

  // Staff re-price at the amount already paid → no change → confirm.
  await dr().openReview({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id });
  const old = await q(`SELECT status FROM pixiegirl.delivery_fee_reviews WHERE order_id = $1 ORDER BY created_at`, [order.order_id]);
  assert.deepEqual(old.rows.map((x) => x.status), ["cancelled", "pending_review"], "declined review superseded");
  await dr().proposeFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, proposed_fee_ngn: 2500, calculation_basis: "Customer moved to a covered address" });
  const c = await dr().confirmFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id });
  assert.equal(c.review.status, "confirmed");
  assert.equal((await orderRow(order.order_id)).needs_delivery_review, false);
});

test("review: decrease needs real refund evidence on THIS order, then credits and settles", async () => {
  const order = await retailDispatchOrder({ shipping: 4000 });
  await markPaid(order.order_id);
  const p = await dr().proposeFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, proposed_fee_ngn: 2500, calculation_basis: "Cheaper courier" });
  assert.equal(p.review.direction, "decrease");
  assert.equal((await orderRow(order.order_id)).needs_delivery_review, true);

  // A credit note from ANOTHER order is not evidence.
  const other = await retailDispatchOrder({ shipping: 0 });
  const inv = await q(`INSERT INTO pixiegirl.invoices (invoice_number, order_id, status) VALUES ('INV-OTHER',$1,'issued') RETURNING invoice_id`, [other.order_id]);
  const cn = await q(`INSERT INTO pixiegirl.credit_notes (credit_note_number, invoice_id, total_ngn, status) VALUES ('CN-OTHER',$1,5000,'issued') RETURNING credit_note_id`, [inv.rows[0].invoice_id]);
  await assert.rejects(
    dr().verifyRefund({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, credit_note_id: cn.rows[0].credit_note_id }),
    /Credit note for this order/,
  );
  // A captured (not refunded) payment is not evidence; nor is a short refund.
  const notRefunded = await addPayment(order.order_id, 1500);
  await assert.rejects(
    dr().verifyRefund({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, refund_payment_id: notRefunded }),
    (e) => e.code === "REFUND_NOT_VERIFIED",
  );
  const shortRefund = await addPayment(order.order_id, 1500, "partially_refunded", 500);
  await assert.rejects(
    dr().verifyRefund({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, refund_payment_id: shortRefund }),
    (e) => e.code === "REFUND_SHORT",
  );
  const refunded = await addPayment(order.order_id, 1500, "refunded", 1500);
  const done = await dr().verifyRefund({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, refund_payment_id: refunded });
  assert.equal(done.review.status, "credited");
  const row = await orderRow(order.order_id);
  assert.equal(Number(row.shipping_fee_ngn), 2500);
  assert.equal(row.needs_delivery_review, false);
});

test("review: wig-only and pickup orders are never reviewable; FLH is gated out", async () => {
  const sales = require("../../src/modules/sales/sales.service");
  const wig = await retailDispatchOrder({ lines: [{ variant_id: IDS.vWig, quantity: 1 }] });
  assert.equal((await orderRow(wig.order_id)).needs_delivery_review, false);
  await assert.rejects(
    dr().openReview({ brand: PXG, user: STAFF, request_id: "t", order_id: wig.order_id }),
    (e) => e.code === "NOT_A_RETAIL_ORDER",
  );
  const pickup = await sales.createOrder({
    brand: PXG, user: STAFF, request_id: "t-pickup",
    input: { contact_id: null, sales_channel: "quick_sale", order_type: "collection", payment_plan: "full", lines: [{ variant_id: IDS.v50, quantity: 1 }] },
  });
  assert.equal((await orderRow(pickup.order_id)).needs_delivery_review, false, "pickup never queued");
  await assert.rejects(dr().listQueue({ brand: FLH }), /Care & Accessories|not found/i);
});

test("queue: lists open + declined retail reviews only, driven by the durable flag", async () => {
  const res = await dr().listQueue({ brand: PXG, page: 1, page_size: 100 });
  assert.ok(res.data.length >= 1);
  for (const r of res.data) {
    assert.ok(["pending_review", "awaiting_customer", "declined"].includes(r.status));
    assert.ok(r.retail_line_count > 0, "only retail-containing orders");
  }
});

// ── Studio bypass ──────────────────────────────────────────
test("Studio bypass: retail lines never open studio jobs; retail-only orders cannot be 'assigned'", async () => {
  const sales = require("../../src/modules/sales/sales.service");
  const sjRepo = require("../../src/modules/service_jobs/service-jobs.repo");
  const order = await retailDispatchOrder({ shipping: 0, lines: [{ variant_id: IDS.v50, quantity: 1 }] });
  // Even a mislabelled retail line is excluded from the studio query.
  await q(`UPDATE pixiegirl.sales_order_lines SET line_kind = 'styled' WHERE order_id = $1`, [order.order_id]);
  assert.deepEqual(await sjRepo.allStudioLines({ brand: PXG, order_id: order.order_id }), []);
  await q(`UPDATE pixiegirl.sales_order_lines SET line_kind = 'product' WHERE order_id = $1`, [order.order_id]);
  await markPaid(order.order_id);
  await assert.rejects(
    sales.setOrderStatus({ brand: PXG, user: STAFF, request_id: "t", id: order.order_id, status: "assigned" }),
    (e) => e.code === "RETAIL_NOT_STYLED",
  );
  // Retail still reaches pack → (review settled) → completion.
  const ready = await sales.setOrderStatus({ brand: PXG, user: STAFF, request_id: "t", id: order.order_id, status: "order_ready" });
  assert.equal(ready.status, "order_ready");
  await dr().proposeFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id, proposed_fee_ngn: 0, calculation_basis: "Staff delivered in person" });
  await dr().confirmFee({ brand: PXG, user: STAFF, request_id: "t", order_id: order.order_id });
  assert.equal((await sales.setOrderStatus({ brand: PXG, user: STAFF, request_id: "t", id: order.order_id, status: "dispatched" })).status, "dispatched");
  assert.equal((await sales.setOrderStatus({ brand: PXG, user: STAFF, request_id: "t", id: order.order_id, status: "completed" })).status, "completed");
});

test("Studio: a mixed order keeps its genuine wig line for styling", async () => {
  const sjRepo = require("../../src/modules/service_jobs/service-jobs.repo");
  const order = await retailDispatchOrder({ lines: [{ variant_id: IDS.vWig, quantity: 1 }, { variant_id: IDS.v100, quantity: 1 }] });
  await q(`UPDATE pixiegirl.sales_order_lines SET line_kind = 'styled' WHERE order_id = $1 AND variant_id = $2`, [order.order_id, IDS.vWig]);
  const studio = await sjRepo.allStudioLines({ brand: PXG, order_id: order.order_id });
  assert.deepEqual(studio.map((l) => l.variant_id), [IDS.vWig]);
});
