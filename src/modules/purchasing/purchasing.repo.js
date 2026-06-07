/**
 * Purchasing & Procurement (V2.2 §6.8) — repository.
 * Per-brand tables: suppliers, supplier_contacts, supplier_products,
 * rfqs, rfq_lines, rfq_quotes, purchase_orders, po_lines, po_state_history,
 * goods_received_notes, grn_lines, supplier_invoices, supplier_invoice_lines,
 * supplier_invoice_matches. Numbers via the per-brand fn_next_document_number().
 * This layer only reads/writes rows; GL posting + stock movements live in the
 * service (through accounting.postEntry / stock.service).
 */

"use strict";

const { query } = require("../../config/database");

const VALID = new Set(["pixiegirl", "faitlynhair"]);
const t = (brand, tbl) => {
  if (!VALID.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.${tbl}`;
};
const ex = (client) => (client ? client.query.bind(client) : query);

function buildUpdate(cols, src, start = 1) {
  const f = [];
  const p = [];
  let i = start;
  for (const col of cols) {
    if (src[col] === undefined) continue;
    f.push(`${col} = $${i++}`);
    p.push(src[col]);
  }
  return { f, p, next: i };
}

async function nextNumber({ client, brand, type }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS num`,
    [type],
  );
  return rows[0].num;
}

// ── Suppliers ────────────────────────────────────────────
const SUPPLIER_COLS = [
  "display_name",
  "supplier_type",
  "country_of_origin",
  "city",
  "default_currency",
  "tax_treatment",
  "vat_applicable",
  "wht_applicable",
  "wht_rate",
  "payment_terms_days",
  "credit_limit_ngn",
  "bank_name",
  "bank_account_number",
  "bank_swift",
  "bank_routing",
  "bank_address",
  "performance_rating",
  "preferred",
  "on_hold",
  "hold_reason",
  "notes",
  "is_active",
];
async function createSupplier({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "suppliers")}
       (supplier_code, contact_id, display_name, supplier_type, country_of_origin, city, default_currency,
        tax_treatment, vat_applicable, wht_applicable, wht_rate, payment_terms_days, credit_limit_ngn,
        bank_name, bank_account_number, bank_swift, bank_routing, bank_address, preferred, notes, created_by)
     VALUES ($1,$2,$3,COALESCE($4,'goods'),$5,$6,$7,COALESCE($8,'standard'),COALESCE($9,true),COALESCE($10,false),
             $11,COALESCE($12,0),$13,$14,$15,$16,$17,$18,COALESCE($19,false),$20,$21)
     RETURNING *`,
    [
      row.supplier_code,
      row.contact_id,
      row.display_name,
      row.supplier_type,
      row.country_of_origin || null,
      row.city || null,
      row.default_currency || null,
      row.tax_treatment,
      row.vat_applicable,
      row.wht_applicable,
      row.wht_rate ?? null,
      row.payment_terms_days,
      row.credit_limit_ngn ?? null,
      row.bank_name || null,
      row.bank_account_number || null,
      row.bank_swift || null,
      row.bank_routing || null,
      row.bank_address || null,
      row.preferred,
      row.notes || null,
      row.created_by || null,
    ],
  );
  return rows[0];
}
async function getSupplier({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "suppliers")} WHERE supplier_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function listSuppliers({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.is_active !== undefined) {
    where.push(`is_active = $${i++}`);
    params.push(filters.is_active);
  }
  if (filters.supplier_type) {
    where.push(`supplier_type = $${i++}`);
    params.push(filters.supplier_type);
  }
  if (filters.on_hold !== undefined) {
    where.push(`on_hold = $${i++}`);
    params.push(filters.on_hold);
  }
  if (filters.q) {
    where.push(`(display_name ILIKE $${i} OR supplier_code ILIKE $${i})`);
    params.push(`%${filters.q}%`);
    i++;
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "suppliers")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "suppliers")} ${w} ORDER BY display_name LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function updateSupplier({ client, brand, id, patch }) {
  const { f, p, next } = buildUpdate(SUPPLIER_COLS, patch);
  if (f.length === 0) return getSupplier({ client, brand, id });
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "suppliers")} SET ${f.join(", ")} WHERE supplier_id = $${next} RETURNING *`,
    [...p, id],
  );
  return rows[0] || null;
}

// ── Supplier contacts ────────────────────────────────────
async function addSupplierContact({ client, brand, link }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "supplier_contacts")} (supplier_id, contact_id, role, is_primary, notes)
     VALUES ($1,$2,$3,COALESCE($4,false),$5) RETURNING *`,
    [
      link.supplier_id,
      link.contact_id,
      link.role || null,
      link.is_primary,
      link.notes || null,
    ],
  );
  return rows[0];
}
async function listSupplierContacts({ client, brand, supplier_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "supplier_contacts")} WHERE supplier_id = $1 ORDER BY is_primary DESC, created_at`,
    [supplier_id],
  );
  return rows;
}
async function clearPrimaryContacts({ client, brand, supplier_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "supplier_contacts")} SET is_primary = false WHERE supplier_id = $1 AND is_primary = true`,
    [supplier_id],
  );
}
async function removeSupplierContact({
  client,
  brand,
  supplier_id,
  contact_link_id,
}) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "supplier_contacts")} WHERE contact_link_id = $1 AND supplier_id = $2`,
    [contact_link_id, supplier_id],
  );
  return rowCount > 0;
}

// ── Supplier products (variant ↔ supplier) ───────────────
const SUPPLIER_PRODUCT_COLS = [
  "supplier_sku",
  "supplier_description",
  "last_unit_cost",
  "last_unit_cost_currency",
  "last_unit_cost_ngn",
  "lead_time_days",
  "minimum_order_qty",
  "preferred",
  "is_active",
  "notes",
];
async function addSupplierProduct({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "supplier_products")}
       (supplier_id, variant_id, supplier_sku, supplier_description, last_unit_cost, last_unit_cost_currency,
        last_unit_cost_ngn, lead_time_days, minimum_order_qty, preferred, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,false),$11)
     ON CONFLICT (supplier_id, variant_id) DO UPDATE SET
       supplier_sku = EXCLUDED.supplier_sku, supplier_description = EXCLUDED.supplier_description,
       last_unit_cost = EXCLUDED.last_unit_cost, last_unit_cost_currency = EXCLUDED.last_unit_cost_currency,
       last_unit_cost_ngn = EXCLUDED.last_unit_cost_ngn, lead_time_days = EXCLUDED.lead_time_days,
       minimum_order_qty = EXCLUDED.minimum_order_qty, preferred = EXCLUDED.preferred, notes = EXCLUDED.notes
     RETURNING *`,
    [
      row.supplier_id,
      row.variant_id,
      row.supplier_sku || null,
      row.supplier_description || null,
      row.last_unit_cost ?? null,
      row.last_unit_cost_currency || null,
      row.last_unit_cost_ngn ?? null,
      row.lead_time_days ?? null,
      row.minimum_order_qty ?? null,
      row.preferred,
      row.notes || null,
    ],
  );
  return rows[0];
}
async function listSupplierProducts({
  client,
  brand,
  supplier_id,
  variant_id,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (supplier_id) {
    where.push(`sp.supplier_id = $${i++}`);
    params.push(supplier_id);
  }
  if (variant_id) {
    where.push(`sp.variant_id = $${i++}`);
    params.push(variant_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await ex(client)(
    `SELECT sp.*, pv.sku, pv.variant_name FROM ${t(brand, "supplier_products")} sp
       JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sp.variant_id ${w} ORDER BY sp.created_at DESC`,
    params,
  );
  return rows;
}
async function updateSupplierProduct({ client, brand, link_id, patch }) {
  const { f, p, next } = buildUpdate(SUPPLIER_PRODUCT_COLS, patch);
  if (f.length === 0) return null;
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "supplier_products")} SET ${f.join(", ")} WHERE link_id = $${next} RETURNING *`,
    [...p, link_id],
  );
  return rows[0] || null;
}
async function removeSupplierProduct({ client, brand, link_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "supplier_products")} WHERE link_id = $1`,
    [link_id],
  );
  return rowCount > 0;
}
// Refresh ONLY the last-cost fields (used on GRN posting). Must not clobber
// supplier_sku / lead time / MOQ / preferred / notes on an existing link.
async function touchSupplierCost({
  client,
  brand,
  supplier_id,
  variant_id,
  unit_cost_ngn,
}) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "supplier_products")}
       (supplier_id, variant_id, last_unit_cost, last_unit_cost_currency, last_unit_cost_ngn, last_purchased_at)
     VALUES ($1,$2,$3,'NGN',$3, now())
     ON CONFLICT (supplier_id, variant_id) DO UPDATE SET
       last_unit_cost = EXCLUDED.last_unit_cost,
       last_unit_cost_currency = EXCLUDED.last_unit_cost_currency,
       last_unit_cost_ngn = EXCLUDED.last_unit_cost_ngn,
       last_purchased_at = now()
     RETURNING *`,
    [supplier_id, variant_id, unit_cost_ngn],
  );
  return rows[0];
}

// ── RFQs ─────────────────────────────────────────────────
async function createRfq({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "rfqs")} (rfq_number, title, description, response_deadline, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      row.rfq_number,
      row.title,
      row.description || null,
      row.response_deadline || null,
      row.created_by || null,
    ],
  );
  return rows[0];
}
async function addRfqLine({ client, brand, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "rfq_lines")} (rfq_id, variant_id, description, quantity, unit_of_measure, target_unit_price_ngn, notes, display_order)
     VALUES ($1,$2,$3,$4,COALESCE($5,'each'),$6,$7,COALESCE($8,0)) RETURNING *`,
    [
      line.rfq_id,
      line.variant_id || null,
      line.description,
      line.quantity,
      line.unit_of_measure,
      line.target_unit_price_ngn ?? null,
      line.notes || null,
      line.display_order,
    ],
  );
  return rows[0];
}
async function getRfq({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "rfqs")} WHERE rfq_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT * FROM ${t(brand, "rfq_lines")} WHERE rfq_id = $1 ORDER BY display_order`,
    [id],
  );
  const { rows: quotes } = await ex(client)(
    `SELECT * FROM ${t(brand, "rfq_quotes")} WHERE rfq_id = $1 ORDER BY total_quoted_ngn`,
    [id],
  );
  return { ...rows[0], lines, quotes };
}
async function listRfqs({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "rfqs")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "rfqs")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setRfqStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "rfqs")} SET ${sets.join(", ")} WHERE rfq_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function addQuote({ client, brand, quote }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "rfq_quotes")}
       (rfq_id, supplier_id, quote_currency, total_quoted, total_quoted_ngn, fx_rate_used, line_prices,
        payment_terms_days, lead_time_days, validity_until, shipping_terms, quote_document_id, notes)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,1),$7::jsonb,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      quote.rfq_id,
      quote.supplier_id,
      quote.quote_currency,
      quote.total_quoted,
      quote.total_quoted_ngn,
      quote.fx_rate_used,
      JSON.stringify(quote.line_prices || []),
      quote.payment_terms_days ?? null,
      quote.lead_time_days ?? null,
      quote.validity_until || null,
      quote.shipping_terms || null,
      quote.quote_document_id || null,
      quote.notes || null,
    ],
  );
  return rows[0];
}
async function getQuote({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "rfq_quotes")} WHERE quote_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function setQuoteStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "rfq_quotes")} SET ${sets.join(", ")} WHERE quote_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Purchase orders ──────────────────────────────────────
async function createPo({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "purchase_orders")}
       (po_number, supplier_id, rfq_id, awarded_quote_id, title, description, delivery_location_id,
        po_currency, payment_terms_days, expected_delivery, shipping_terms, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      row.po_number,
      row.supplier_id,
      row.rfq_id || null,
      row.awarded_quote_id || null,
      row.title,
      row.description || null,
      row.delivery_location_id || null,
      row.po_currency,
      row.payment_terms_days ?? null,
      row.expected_delivery || null,
      row.shipping_terms || null,
      row.created_by || null,
    ],
  );
  return rows[0];
}
async function addPoLine({ client, brand, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "po_lines")}
       (po_id, variant_id, description, supplier_sku, qty_ordered, unit_price, unit_price_ngn, line_total, line_total_ngn,
        tax_rate, tax_amount_ngn, display_order, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,0),COALESCE($11,0),COALESCE($12,0),$13) RETURNING *`,
    [
      line.po_id,
      line.variant_id || null,
      line.description,
      line.supplier_sku || null,
      line.qty_ordered,
      line.unit_price,
      line.unit_price_ngn,
      line.line_total,
      line.line_total_ngn,
      line.tax_rate,
      line.tax_amount_ngn,
      line.display_order,
      line.notes || null,
    ],
  );
  return rows[0];
}
async function listPoLines({ client, brand, po_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "po_lines")} WHERE po_id = $1 ORDER BY display_order`,
    [po_id],
  );
  return rows;
}
async function getPoLine({ client, brand, line_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "po_lines")} WHERE line_id = $1`,
    [line_id],
  );
  return rows[0] || null;
}
async function findGrnLineForPoLine({ client, brand, po_line_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "grn_lines")} WHERE po_line_id = $1 ORDER BY display_order DESC LIMIT 1`,
    [po_line_id],
  );
  return rows[0] || null;
}
async function getPo({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "purchase_orders")} WHERE po_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const lines = await listPoLines({ client, brand, po_id: id });
  const { rows: history } = await ex(client)(
    `SELECT * FROM ${t(brand, "po_state_history")} WHERE po_id = $1 ORDER BY changed_at`,
    [id],
  );
  return { ...rows[0], lines, history };
}
async function listPos({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.supplier_id) {
    where.push(`supplier_id = $${i++}`);
    params.push(filters.supplier_id);
  }
  if (filters.open) {
    where.push(`status NOT IN ('received','closed','cancelled')`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "purchase_orders")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "purchase_orders")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setPoTotals({ client, brand, id, totals }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "purchase_orders")}
        SET subtotal = $2, tax_amount = $3, shipping_amount = $4, total = $5, total_ngn = $6, fx_rate_used = $7, total_qty_ordered = $8
      WHERE po_id = $1 RETURNING *`,
    [
      id,
      totals.subtotal,
      totals.tax_amount,
      totals.shipping_amount,
      totals.total,
      totals.total_ngn,
      totals.fx_rate_used,
      totals.total_qty_ordered,
    ],
  );
  return rows[0] || null;
}
async function setPoStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "purchase_orders")} SET ${sets.join(", ")} WHERE po_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function addPoHistory({ client, brand, h }) {
  await ex(client)(
    `INSERT INTO ${t(brand, "po_state_history")} (po_id, from_status, to_status, changed_by, changed_by_source, notes)
     VALUES ($1,$2,$3,$4,COALESCE($5,'user'),$6)`,
    [
      h.po_id,
      h.from_status || null,
      h.to_status,
      h.changed_by || null,
      h.changed_by_source,
      h.notes || null,
    ],
  );
}
async function incrementPoLineReceived({
  client,
  brand,
  po_line_id,
  qty_received,
  qty_rejected = 0,
}) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "po_lines")} SET qty_received = qty_received + $2, qty_rejected = qty_rejected + $3 WHERE line_id = $1 RETURNING *`,
    [po_line_id, qty_received, qty_rejected],
  );
  return rows[0] || null;
}
async function rollupPoReceived({ client, brand, po_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "purchase_orders")} p
        SET total_qty_received = sub.recv
       FROM (SELECT COALESCE(SUM(qty_received),0)::int AS recv FROM ${t(brand, "po_lines")} WHERE po_id = $1) sub
      WHERE p.po_id = $1 RETURNING p.*`,
    [po_id],
  );
  return rows[0] || null;
}

// ── Goods received notes ─────────────────────────────────
async function createGrn({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "goods_received_notes")}
       (grn_number, po_id, inbound_shipment_id, received_at_location_id, delivery_note_ref, received_by, inspected_by,
        total_qty_expected, total_qty_received, total_qty_rejected, rejection_reason, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,0),$11,$12) RETURNING *`,
    [
      row.grn_number,
      row.po_id,
      row.inbound_shipment_id || null,
      row.received_at_location_id,
      row.delivery_note_ref || null,
      row.received_by,
      row.inspected_by || null,
      row.total_qty_expected ?? null,
      row.total_qty_received ?? null,
      row.total_qty_rejected,
      row.rejection_reason || null,
      row.notes || null,
    ],
  );
  return rows[0];
}
async function addGrnLine({ client, brand, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "grn_lines")}
       (grn_id, po_line_id, variant_id, qty_expected, qty_received, qty_rejected, inspection_result, rejection_reason, unit_cost_ngn, display_order, notes)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),COALESCE($7,'pass'),$8,$9,COALESCE($10,0),$11) RETURNING *`,
    [
      line.grn_id,
      line.po_line_id,
      line.variant_id || null,
      line.qty_expected,
      line.qty_received,
      line.qty_rejected,
      line.inspection_result,
      line.rejection_reason || null,
      line.unit_cost_ngn ?? null,
      line.display_order,
      line.notes || null,
    ],
  );
  return rows[0];
}
async function listGrnLines({ client, brand, grn_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "grn_lines")} WHERE grn_id = $1 ORDER BY display_order`,
    [grn_id],
  );
  return rows;
}
async function getGrn({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "goods_received_notes")} WHERE grn_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const lines = await listGrnLines({ client, brand, grn_id: id });
  return { ...rows[0], lines };
}
async function listGrns({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.po_id) {
    where.push(`po_id = $${i++}`);
    params.push(filters.po_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "goods_received_notes")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "goods_received_notes")} ${w} ORDER BY received_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setGrnStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "goods_received_notes")} SET ${sets.join(", ")} WHERE grn_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Supplier invoices + three-way matching ───────────────
async function createSupplierInvoice({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "supplier_invoices")}
       (invoice_number, internal_reference, supplier_id, po_id, invoice_currency, subtotal, tax_amount, wht_amount,
        shipping, total, total_ngn, fx_rate_used, invoice_date, due_date, invoice_document_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,0),COALESCE($8,0),COALESCE($9,0),$10,$11,COALESCE($12,1),$13,$14,$15,$16) RETURNING *`,
    [
      row.invoice_number,
      row.internal_reference,
      row.supplier_id,
      row.po_id || null,
      row.invoice_currency,
      row.subtotal,
      row.tax_amount,
      row.wht_amount,
      row.shipping,
      row.total,
      row.total_ngn,
      row.fx_rate_used,
      row.invoice_date,
      row.due_date,
      row.invoice_document_id || null,
      row.notes || null,
    ],
  );
  return rows[0];
}
async function addSupplierInvoiceLine({ client, brand, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "supplier_invoice_lines")}
       (supplier_invoice_id, po_line_id, description, quantity, unit_price, line_total, line_total_ngn, account_id, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0)) RETURNING *`,
    [
      line.supplier_invoice_id,
      line.po_line_id || null,
      line.description,
      line.quantity,
      line.unit_price,
      line.line_total,
      line.line_total_ngn,
      line.account_id || null,
      line.display_order,
    ],
  );
  return rows[0];
}
async function listSupplierInvoiceLines({
  client,
  brand,
  supplier_invoice_id,
}) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "supplier_invoice_lines")} WHERE supplier_invoice_id = $1 ORDER BY display_order`,
    [supplier_invoice_id],
  );
  return rows;
}
async function addMatch({ client, brand, match }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "supplier_invoice_matches")}
       (supplier_invoice_id, supplier_invoice_line_id, po_line_id, grn_line_id, quantity_match, price_match, match_status, variance_ngn, override_approved_by, override_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      match.supplier_invoice_id,
      match.supplier_invoice_line_id,
      match.po_line_id || null,
      match.grn_line_id || null,
      match.quantity_match,
      match.price_match,
      match.match_status,
      match.variance_ngn ?? null,
      match.override_approved_by || null,
      match.override_reason || null,
    ],
  );
  return rows[0];
}
async function listMatches({ client, brand, supplier_invoice_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "supplier_invoice_matches")} WHERE supplier_invoice_id = $1 ORDER BY matched_at`,
    [supplier_invoice_id],
  );
  return rows;
}
async function getSupplierInvoice({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "supplier_invoices")} WHERE supplier_invoice_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const lines = await listSupplierInvoiceLines({
    client,
    brand,
    supplier_invoice_id: id,
  });
  const matches = await listMatches({ client, brand, supplier_invoice_id: id });
  return { ...rows[0], lines, matches };
}
async function listSupplierInvoices({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.supplier_id) {
    where.push(`supplier_id = $${i++}`);
    params.push(filters.supplier_id);
  }
  if (filters.po_id) {
    where.push(`po_id = $${i++}`);
    params.push(filters.po_id);
  }
  if (filters.unpaid) {
    where.push(`status NOT IN ('paid','void')`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "supplier_invoices")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "supplier_invoices")} ${w} ORDER BY invoice_date DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setSupplierInvoiceStatus({
  client,
  brand,
  id,
  status,
  extra = {},
}) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "supplier_invoices")} SET ${sets.join(", ")} WHERE supplier_invoice_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function applySupplierPayment({ client, brand, id, amount_ngn }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "supplier_invoices")} SET amount_paid_ngn = amount_paid_ngn + $2 WHERE supplier_invoice_id = $1 RETURNING *`,
    [id, amount_ngn],
  );
  return rows[0] || null;
}

module.exports = {
  nextNumber,
  createSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
  addSupplierContact,
  listSupplierContacts,
  clearPrimaryContacts,
  removeSupplierContact,
  addSupplierProduct,
  touchSupplierCost,
  listSupplierProducts,
  updateSupplierProduct,
  removeSupplierProduct,
  createRfq,
  addRfqLine,
  getRfq,
  listRfqs,
  setRfqStatus,
  addQuote,
  getQuote,
  setQuoteStatus,
  createPo,
  addPoLine,
  listPoLines,
  getPoLine,
  findGrnLineForPoLine,
  getPo,
  listPos,
  setPoTotals,
  setPoStatus,
  addPoHistory,
  incrementPoLineReceived,
  rollupPoReceived,
  createGrn,
  addGrnLine,
  listGrnLines,
  getGrn,
  listGrns,
  setGrnStatus,
  createSupplierInvoice,
  addSupplierInvoiceLine,
  listSupplierInvoiceLines,
  addMatch,
  listMatches,
  getSupplierInvoice,
  listSupplierInvoices,
  setSupplierInvoiceStatus,
  applySupplierPayment,
};
