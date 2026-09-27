/**
 * Order amendments (§6.2 "Change Order") — parameterised SQL only.
 *
 * Split out of sales.repo.js because an amendment writes across the order in a
 * way ordinary order creation never does: it DELETES lines, rewrites the
 * header's money in place, and keeps its own audit table. Keeping that in one
 * file makes the blast radius of the feature obvious.
 */

"use strict";

const { ex } = require("../../config/database");
const { t } = require("../../config/brands");

const AMENDMENT_COLS = [
  "order_id",
  "amendment_number",
  "reason",
  "reason_category",
  "subtotal_before_ngn",
  "discount_before_ngn",
  "tax_before_ngn",
  "shipping_before_ngn",
  "total_before_ngn",
  "subtotal_after_ngn",
  "discount_after_ngn",
  "tax_after_ngn",
  "shipping_after_ngn",
  "total_after_ngn",
  "amount_paid_ngn",
  "balance_after_ngn",
  "lines_before",
  "lines_after",
  "line_changes",
  "delivery_before",
  "delivery_after",
  "effects",
  "order_status_before",
  "revenue_recognised",
  "journal_entry_id",
  "customer_notified",
  "amended_by",
  "amended_by_name",
];
// Columns the DB stores as jsonb — stringified on the way in so a JS object
// binds cleanly instead of arriving as "[object Object]".
const JSON_COLS = new Set([
  "lines_before",
  "lines_after",
  "line_changes",
  "delivery_before",
  "delivery_after",
  "effects",
]);

/**
 * Take the order row's write lock for the life of the transaction.
 *
 * An amendment reads the order's lines, re-prices them and writes the header
 * back — a read-modify-write that two operators hitting "Save changes" at the
 * same moment would interleave, leaving the second one's totals computed from
 * lines the first had already replaced. The lock serialises them; the second
 * simply waits and then re-reads the truth.
 */
async function lockOrder({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT order_id FROM ${t(brand, "sales_orders")}
      WHERE order_id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

/** Next 1-based sequence number for this order's amendments. */
async function nextAmendmentNumber({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT COALESCE(MAX(amendment_number), 0) + 1 AS n
       FROM ${t(brand, "sales_order_amendments")}
      WHERE order_id = $1`,
    [order_id],
  );
  return rows[0] ? Number(rows[0].n) : 1;
}

async function insertAmendment({ client, brand, row }) {
  const f = [];
  const ph = [];
  const p = [];
  let i = 1;
  for (const c of AMENDMENT_COLS) {
    if (row[c] === undefined) continue;
    f.push(c);
    ph.push(JSON_COLS.has(c) ? `$${i++}::jsonb` : `$${i++}`);
    p.push(JSON_COLS.has(c) ? JSON.stringify(row[c]) : row[c]);
  }
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "sales_order_amendments")} (${f.join(",")})
     VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

/** Stamp the effects/journal/notified fields once the post-commit work is known. */
async function finaliseAmendment({ client, brand, amendment_id, patch }) {
  const sets = [];
  const p = [amendment_id];
  let i = 2;
  if (patch.effects !== undefined) {
    sets.push(`effects = $${i++}::jsonb`);
    p.push(JSON.stringify(patch.effects));
  }
  if (patch.journal_entry_id !== undefined) {
    sets.push(`journal_entry_id = $${i++}`);
    p.push(patch.journal_entry_id);
  }
  if (patch.customer_notified !== undefined) {
    sets.push(`customer_notified = $${i++}`);
    p.push(patch.customer_notified);
  }
  if (!sets.length) return null;
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "sales_order_amendments")}
        SET ${sets.join(", ")} WHERE amendment_id = $1 RETURNING *`,
    p,
  );
  return rows[0] || null;
}

/** Newest first — the order detail's "Change history" card. */
async function listAmendments({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT a.*, u.display_name AS amended_by_display_name
       FROM ${t(brand, "sales_order_amendments")} a
       LEFT JOIN shared.users u ON u.user_id = a.amended_by
      WHERE a.order_id = $1
      ORDER BY a.amendment_number DESC`,
    [order_id],
  );
  return rows;
}

/**
 * Drop the lines an amendment removed.
 *
 * Safe by schema design: everything that points at a sales_order_line does so
 * ON DELETE SET NULL (invoice_lines, service_jobs, commission_earned,
 * pos_void_lines, production custom-order lines) except
 * sales_order_discounts.applied_to_line_id, which CASCADEs — exactly right,
 * since a per-line campaign discount dies with its line. The amendment row
 * keeps the full `lines_before` snapshot, so nothing is lost to history.
 */
async function deleteLines({ client, brand, line_ids }) {
  const ids = (line_ids || []).filter(Boolean);
  if (!ids.length) return 0;
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "sales_order_lines")} WHERE line_id = ANY($1::uuid[])`,
    [ids],
  );
  return rowCount;
}

/** Rewrite one kept line's quantity / price / tax / totals in place. */
async function updateLine({ client, brand, line_id, patch }) {
  const cols = [
    "quantity",
    "unit_price_ngn",
    "line_discount_ngn",
    "tax_rate",
    "tax_amount_ngn",
    "line_total_ngn",
    "display_order",
    "notes",
  ];
  const sets = [];
  const p = [line_id];
  let i = 2;
  for (const c of cols) {
    if (patch[c] === undefined) continue;
    sets.push(`${c} = $${i++}`);
    p.push(patch[c]);
  }
  if (!sets.length) return null;
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "sales_order_lines")} SET ${sets.join(", ")}
      WHERE line_id = $1 RETURNING *`,
    p,
  );
  return rows[0] || null;
}

/**
 * Re-scale a kept line's own campaign discount row after its quantity changed.
 *
 * The per-line rows in sales_order_discounts are the ledger the amendment
 * re-reads on EVERY subsequent change to recover the per-unit saving (it
 * divides by the line's quantity). Leaving a stale amount behind after a
 * quantity change would silently inflate or shrink the discount on the next
 * amendment. A row that scales to zero is deleted rather than zeroed — the
 * table's CHECK requires amount_ngn > 0.
 */
async function setLineDiscountAmount({ client, brand, line_id, amount_ngn }) {
  const amount = Number(amount_ngn || 0);
  if (!(amount > 0)) {
    await ex(client)(
      `DELETE FROM ${t(brand, "sales_order_discounts")}
        WHERE applied_to_line_id = $1`,
      [line_id],
    );
    return 0;
  }
  // A line can carry more than one source row in principle; scale them to the
  // new total by putting it all on the first and dropping the rest, so the
  // ledger keeps summing to the line's actual discount.
  const { rows } = await ex(client)(
    `SELECT discount_id FROM ${t(brand, "sales_order_discounts")}
      WHERE applied_to_line_id = $1 ORDER BY applied_at`,
    [line_id],
  );
  if (!rows.length) return 0;
  await ex(client)(
    `UPDATE ${t(brand, "sales_order_discounts")}
        SET amount_ngn = $2 WHERE discount_id = $1`,
    [rows[0].discount_id, amount_ngn],
  );
  if (rows.length > 1) {
    await ex(client)(
      `DELETE FROM ${t(brand, "sales_order_discounts")}
        WHERE discount_id = ANY($1::uuid[])`,
      [rows.slice(1).map((r) => r.discount_id)],
    );
  }
  return amount;
}

/**
 * Rewrite one discount row's amount, or drop it when it scales to nothing —
 * the table's CHECK requires amount_ngn > 0.
 *
 * Used when a carried-forward order-level discount can't be absorbed in full by
 * the replacement cart: the order's discount_amount_ngn only counts what was
 * actually applied, so leaving the ledger rows at their original figures would
 * make the breakdown stop tying out to the order total.
 */
async function setDiscountAmount({ client, brand, discount_id, amount_ngn }) {
  if (!(Number(amount_ngn) > 0)) {
    await ex(client)(
      `DELETE FROM ${t(brand, "sales_order_discounts")} WHERE discount_id = $1`,
      [discount_id],
    );
    return null;
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "sales_order_discounts")}
        SET amount_ngn = $2 WHERE discount_id = $1 RETURNING *`,
    [discount_id, amount_ngn],
  );
  return rows[0] || null;
}

/** Order-level discount rows (no applied_to_line_id) — carried forward. */
async function listOrderLevelDiscounts({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "sales_order_discounts")}
      WHERE order_id = $1 AND applied_to_line_id IS NULL
      ORDER BY applied_at`,
    [order_id],
  );
  return rows;
}

/**
 * Rewrite the order header's money after a re-price.
 *
 * display_total is recomputed from the SAME fx_rate the order was booked at —
 * never a live rate. A foreign-currency order re-quoted at today's rate would
 * silently reprice history (the §6.5 rule the MoneyText component exists to
 * enforce on the front end).
 */
async function setOrderTotals({ client, brand, id, totals }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "sales_orders")}
        SET subtotal_ngn        = $2,
            discount_amount_ngn = $3,
            tax_amount_ngn      = $4,
            shipping_fee_ngn    = $5,
            total_ngn           = $6,
            display_total       = CASE
              WHEN display_currency IS NULL OR display_currency = 'NGN' THEN NULL
              WHEN COALESCE(fx_rate_used, 0) > 0 AND fx_rate_used <> 1
                THEN round($6::numeric / fx_rate_used, 2)
              ELSE display_total
            END,
            updated_at = now()
      WHERE order_id = $1
      RETURNING *`,
    [
      id,
      totals.subtotal_ngn,
      totals.discount_amount_ngn,
      totals.tax_amount_ngn,
      totals.shipping_fee_ngn,
      totals.total_ngn,
    ],
  );
  return rows[0] || null;
}

/** Fulfilment type + delivery address snapshot + customer notes. */
async function setDeliveryDetails({
  client,
  brand,
  id,
  order_type,
  address_snapshot,
  customer_notes,
  specific_instructions,
}) {
  const hasSpec = specific_instructions !== undefined;
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "sales_orders")}
        SET order_type = COALESCE($2, order_type),
            delivery_address_snapshot = COALESCE($3::jsonb, delivery_address_snapshot),
            customer_notes = COALESCE($4, customer_notes),
            specific_instructions = CASE WHEN $5::boolean THEN $6::text ELSE specific_instructions END,
            updated_at = now()
      WHERE order_id = $1
      RETURNING *`,
    [
      id,
      order_type || null,
      address_snapshot ? JSON.stringify(address_snapshot) : null,
      customer_notes === undefined ? null : customer_notes,
      hasSpec,
      hasSpec ? specific_instructions : null,
    ],
  );
  return rows[0] || null;
}


/** Denormalised "this order has been changed" markers on the order row. */
async function bumpAmendmentCounters({ client, brand, id }) {
  await ex(client)(
    `UPDATE ${t(brand, "sales_orders")}
        SET amendment_count = amendment_count + 1,
            last_amended_at = now()
      WHERE order_id = $1`,
    [id],
  );
}

/**
 * Set or clear the made-to-order flag on specific order lines.
 *
 * The reconciler's verdict, written down: a line whose units the amendment
 * really secured (directly, or from a size-adjacent sibling) is no longer
 * back-ordered, and one it could not secure is. Without the clearing half, a
 * line that went in as a pre-order stayed one forever — and because the ORDER
 * flag is derived from these, the order kept advertising a production window
 * even after the amendment put the unit on the shelf.
 */
async function setLinesPreorder({ client, brand, line_ids, is_preorder }) {
  const ids = (line_ids || []).filter(Boolean);
  if (!ids.length) return;
  await ex(client)(
    `UPDATE ${t(brand, "sales_order_lines")}
        SET is_preorder = $2 WHERE line_id = ANY($1::uuid[])`,
    [ids, Boolean(is_preorder)],
  );
}

/**
 * Clear the pre-order flag when nothing on the order is made-to-order any
 * more — an amendment that swaps a back-ordered wig for one on the shelf must
 * stop the order advertising a production window it no longer has.
 *
 * The window SNAPSHOT (ship-by date and the min/max weeks the customer was
 * promised) goes with the flag: it is only meaningful while the order is made
 * to order, and leaving it behind would have the order carry a production
 * window with nothing in production. `markOrderPreorder` re-stamps all three
 * the next time a line is short, so nothing is lost by clearing them.
 */
async function refreshPreorderFlag({ client, brand, id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "sales_orders")} so
        SET is_preorder = EXISTS (
              SELECT 1 FROM ${t(brand, "sales_order_lines")} l
               WHERE l.order_id = so.order_id AND l.is_preorder = true
            ),
            preorder_ready_by = CASE
              WHEN EXISTS (
                SELECT 1 FROM ${t(brand, "sales_order_lines")} l
                 WHERE l.order_id = so.order_id AND l.is_preorder = true
              ) THEN preorder_ready_by ELSE NULL END,
            preorder_min_weeks = CASE
              WHEN EXISTS (
                SELECT 1 FROM ${t(brand, "sales_order_lines")} l
                 WHERE l.order_id = so.order_id AND l.is_preorder = true
              ) THEN preorder_min_weeks ELSE NULL END,
            preorder_max_weeks = CASE
              WHEN EXISTS (
                SELECT 1 FROM ${t(brand, "sales_order_lines")} l
                 WHERE l.order_id = so.order_id AND l.is_preorder = true
              ) THEN preorder_max_weeks ELSE NULL END
      WHERE so.order_id = $1
      RETURNING is_preorder`,
    [id],
  );
  return rows[0] ? rows[0].is_preorder : false;
}

module.exports = {
  lockOrder,
  nextAmendmentNumber,
  insertAmendment,
  finaliseAmendment,
  listAmendments,
  deleteLines,
  updateLine,
  setLineDiscountAmount,
  setDiscountAmount,
  listOrderLevelDiscounts,
  setOrderTotals,
  setDeliveryDetails,
  setLinesPreorder,
  bumpAmendmentCounters,
  refreshPreorderFlag,
};
