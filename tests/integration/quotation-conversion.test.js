"use strict";

/**
 * Quotation → order conversion — DB integration (revenue-critical).
 *
 * The quotation pay rail (000090) mints the order at the moment a gateway
 * payment confirms, from a webhook that may be delivered more than once. This
 * proves, against a real schema, the two properties that make that safe:
 *
 *   1. converting stamps the link BOTH ways — quotations.converted_sales_order_id
 *      forward, sales_orders.quotation_id back (the back-pointer column has
 *      existed since 000019 but was never populated until this rail);
 *   2. calling ensureQuotationOrder twice yields ONE order, not two — the
 *      re-delivered-webhook case.
 *
 * OPT-IN: needs a migrated + seeded DB. Enable with RUN_DB_TESTS=1. Rather than
 * blind-seeding a product tree, it AUTO-DISCOVERS an in-stock variant and a
 * contact; if the DB has neither it skips with a note.
 *
 *   RUN_DB_TESTS=1 DB_HOST=localhost DB_NAME=pixie_hub_test ... \
 *     npx jest tests/integration/quotation-conversion
 */

const RUN = process.env.RUN_DB_TESTS === "1";
const db = require("../../src/config/database");
const salesService = require("../../src/modules/sales/sales.service");
const salesRepo = require("../../src/modules/sales/sales.repo");
const { VALID_BRANDS } = require("../../src/config/brands");

const suite = RUN ? describe : describe.skip;

suite("quotation → order conversion (DB)", () => {
  beforeAll(async () => {
    await db.initDatabase();
  });
  afterAll(async () => {
    await db.closeDatabase();
  });

  /** A (brand, contact_id, variant) triple we can build a real quote from. */
  async function findFixture() {
    for (const brand of VALID_BRANDS) {
      const { rows: variants } = await db.query(
        `SELECT v.variant_id, v.sku, p.name
           FROM ${brand}.product_variants v
           JOIN ${brand}.products p ON p.product_id = v.product_id
          LIMIT 1`,
      );
      if (!variants.length) continue;
      const { rows: contacts } = await db.query(
        `SELECT contact_id FROM shared.contacts
          WHERE $1 = ANY(visible_to) LIMIT 1`,
        [brand],
      );
      if (!contacts.length) continue;
      return {
        brand,
        contact_id: contacts[0].contact_id,
        variant: variants[0],
      };
    }
    return null;
  }

  let fx;
  beforeAll(async () => {
    fx = await findFixture();
    if (!fx)
      // eslint-disable-next-line no-console
      console.warn(
        "quotation-conversion: no variant+contact fixture found — skipping assertions",
      );
  });

  async function makeQuote() {
    return salesService.createQuotation({
      brand: fx.brand,
      user: { user_id: null },
      request_id: "test:quotation-conversion",
      input: {
        contact_id: fx.contact_id,
        delivery_type: "dispatch",
        lines: [
          {
            variant_id: fx.variant.variant_id,
            quantity: 1,
            unit_price_ngn: "25000.00",
          },
        ],
      },
    });
  }

  test("conversion stamps the quote↔order link in both directions", async () => {
    if (!fx) return;
    const quote = await makeQuote();

    const order = await salesService.ensureQuotationOrder({
      brand: fx.brand,
      quotation_id: quote.quotation_id,
    });

    // Back-pointer on the order.
    expect(order.quotation_id).toBe(quote.quotation_id);
    // Forward pointer + terminal status on the quote.
    const after = await salesRepo.findQuotationById({
      brand: fx.brand,
      id: quote.quotation_id,
    });
    expect(after.status).toBe("converted");
    expect(after.converted_sales_order_id).toBe(order.order_id);
  });

  test("a re-delivered webhook converts once, not twice", async () => {
    if (!fx) return;
    const quote = await makeQuote();

    const first = await salesService.ensureQuotationOrder({
      brand: fx.brand,
      quotation_id: quote.quotation_id,
    });
    const second = await salesService.ensureQuotationOrder({
      brand: fx.brand,
      quotation_id: quote.quotation_id,
    });

    expect(second.order_id).toBe(first.order_id);
    // And no twin exists in the table — the definitive check.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM ${fx.brand}.sales_orders
        WHERE quotation_id = $1`,
      [quote.quotation_id],
    );
    expect(rows[0].n).toBe(1);
  });

  test("simultaneous deliveries collapse onto one order", async () => {
    if (!fx) return;
    const quote = await makeQuote();

    // The sequential case is guarded by the quote's status; this is the race
    // the client_idempotency_key ('quotation:<id>') unique index exists for.
    const results = await Promise.allSettled([
      salesService.ensureQuotationOrder({
        brand: fx.brand,
        quotation_id: quote.quotation_id,
      }),
      salesService.ensureQuotationOrder({
        brand: fx.brand,
        quotation_id: quote.quotation_id,
      }),
    ]);
    const orders = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value.order_id);
    expect(orders.length).toBeGreaterThan(0);
    expect(new Set(orders).size).toBe(1);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM ${fx.brand}.sales_orders
        WHERE quotation_id = $1`,
      [quote.quotation_id],
    );
    expect(rows[0].n).toBe(1);
  });
});
