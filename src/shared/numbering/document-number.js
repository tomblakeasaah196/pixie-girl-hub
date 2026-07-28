/**
 * Guarded document numbering — the ONE way to call
 * `<brand>.fn_next_document_number(type)`.
 *
 * That PL/pgSQL function RAISEs when `shared.document_numbering` has no row for
 * (business, type):
 *
 *   IF NOT FOUND THEN
 *     RAISE EXCEPTION 'No document_numbering row for (<brand>, %)', p_document_type;
 *
 * Inside a transaction a RAISE aborts the WHOLE transaction, so an unguarded
 * call cannot simply be try/caught — every later statement fails with 25P02.
 * Callers must therefore wrap it in a SAVEPOINT, provision the missing row, and
 * retry. Sales did exactly that; Stock did not, and called the raw function for
 * `'stock_movement'` — a type nothing in the codebase ever seeded. Every stock
 * movement insert therefore RAISEd, which meant every reservation at checkout
 * failed and EVERY order line was recorded as a pre-order regardless of how much
 * stock was on the shelf, with the failure swallowed as a routine stock-out.
 *
 * Centralising it here means a brand that was never fully provisioned self-heals
 * on first use instead of silently breaking a whole module.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

/** House prefixes per document type, e.g. FLH-MOV-0001. */
const DOC_SUFFIX = {
  sales_order: "SO",
  sales_order_payment: "PAY",
  quotation: "QUO",
  credit_note: "CN",
  receipt: "RCT",
  invoice: "INV",
  stock_movement: "MOV",
  stock_transfer: "TRF",
  stock_adjustment: "ADJ",
  stock_count: "CNT",
  inbound_shipment: "IN",
  cancellation_request: "CR",
  // Purchasing called the RAW function for these — nothing ever seeded them,
  // so the RAISE aborted the transaction and creating a purchase order failed
  // outright. Same defect the stock_movement entry above documents.
  purchase_order: "PO",
  rfq: "RFQ",
  goods_received_note: "GRN",
  supplier_invoice: "SINV",
  purchase_return: "PRET",
};

/**
 * Did this error come from the function's own "no sequence row" RAISE?
 * plpgsql RAISE EXCEPTION surfaces as SQLSTATE P0001; some drivers drop the
 * code, so the message is checked too. Anything else must propagate — we only
 * want to auto-provision, never to mask a real fault.
 */
function isMissingSequence(err) {
  return Boolean(
    err &&
      (err.code === "P0001" || !err.code) &&
      /document_numbering/i.test(err.message || ""),
  );
}

/**
 * Seed a missing sequence row. The prefix root is borrowed from any existing
 * sequence for the brand so numbering stays in house style (FLH-…), falling
 * back to a key-derived root for a brand with no sequences at all.
 */
async function provisionSequence(run, brand, type) {
  const { rows } = await run(
    `SELECT split_part(prefix,'-',1) AS root
       FROM shared.document_numbering
      WHERE business = $1 AND prefix LIKE '%-%'
      ORDER BY seq_id LIMIT 1`,
    [brand],
  );
  const root =
    (rows[0] && rows[0].root) ||
    brand
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 4)
      .toUpperCase() ||
    "DOC";
  const suffix =
    DOC_SUFFIX[type] ||
    String(type)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6) ||
    "DOC";
  await run(
    `INSERT INTO shared.document_numbering (business, document_type, prefix, padding, next_number)
     VALUES ($1, $2, $3, 4, 1)
     ON CONFLICT DO NOTHING`,
    [brand, type, `${root}-${suffix}`],
  );
}

/**
 * Allocate the next number for `type`, provisioning the sequence if absent.
 * Pass `client` when inside a transaction — required for the SAVEPOINT guard.
 */
async function nextDocumentNumber({ client, brand, type }) {
  const call = `SELECT ${t(brand, "fn_next_document_number")}($1) AS n`;
  if (client) {
    await client.query("SAVEPOINT pgh_docnum");
    try {
      const { rows } = await client.query(call, [type]);
      await client.query("RELEASE SAVEPOINT pgh_docnum");
      return rows[0].n;
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT pgh_docnum");
      if (!isMissingSequence(err)) {
        await client.query("RELEASE SAVEPOINT pgh_docnum").catch(() => {});
        throw err;
      }
      await provisionSequence(client.query.bind(client), brand, type);
      const { rows } = await client.query(call, [type]);
      await client.query("RELEASE SAVEPOINT pgh_docnum").catch(() => {});
      return rows[0].n;
    }
  }
  try {
    const { rows } = await query(call, [type]);
    return rows[0].n;
  } catch (err) {
    if (!isMissingSequence(err)) throw err;
    await provisionSequence(query, brand, type);
    const { rows } = await query(call, [type]);
    return rows[0].n;
  }
}

module.exports = {
  DOC_SUFFIX,
  isMissingSequence,
  provisionSequence,
  nextDocumentNumber,
};
