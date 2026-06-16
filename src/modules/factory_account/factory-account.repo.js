/**
 * Factory Account (China running-balance ledger) — repository.
 * Per-brand tables via t(). Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

const ex = (c) => (c ? c.query.bind(c) : query);

// ── Factory accounts ──────────────────────────────────────

async function createAccount({ client, brand, data }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "factory_accounts")}
       (supplier_id, account_name, base_currency, credit_alert_threshold, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [data.supplier_id, data.account_name, data.base_currency ?? "CNY",
     data.credit_alert_threshold ?? null, data.notes ?? null, data.created_by ?? null],
  );
  return rows[0];
}

async function getAccount({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT fa.*, s.supplier_name, s.country
     FROM ${t(brand, "factory_accounts")} fa
     JOIN ${t(brand, "suppliers")} s ON s.supplier_id = fa.supplier_id
     WHERE fa.account_id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function listAccounts({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT fa.*, s.supplier_name, s.country
     FROM ${t(brand, "factory_accounts")} fa
     JOIN ${t(brand, "suppliers")} s ON s.supplier_id = fa.supplier_id
     ORDER BY fa.account_name`,
  );
  return rows;
}

async function updateAccount({ client, brand, id, data }) {
  const fields = [];
  const params = [];
  let idx = 1;
  for (const [col, val] of Object.entries(data)) {
    fields.push(`${col} = $${idx++}`);
    params.push(val);
  }
  fields.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "factory_accounts")} SET ${fields.join(", ")}
     WHERE account_id = $${idx} RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}

// ── Ledger entries ────────────────────────────────────────

async function addLedgerEntry({ client, brand, data }) {
  const amountBase = parseFloat(data.amount_original) * parseFloat(data.fx_rate_to_base ?? 1);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "factory_account_ledger")}
       (account_id, entry_type, direction, amount_original, original_currency,
        fx_rate_to_base, amount_base, reference_type, reference_id,
        description, entry_date, payment_method, paid_by, recorded_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,CURRENT_DATE),$12,$13,$14,$15)
     RETURNING *`,
    [
      data.account_id, data.entry_type, data.direction,
      data.amount_original, data.original_currency ?? "CNY",
      data.fx_rate_to_base ?? 1, amountBase,
      data.reference_type ?? null, data.reference_id ?? null,
      data.description ?? null, data.entry_date ?? null,
      data.payment_method ?? null, data.paid_by ?? null,
      data.recorded_by ?? null, data.notes ?? null,
    ],
  );
  return rows[0];
}

async function listLedgerEntries({ client, brand, account_id, limit = 50, offset = 0 }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "factory_account_ledger")}
     WHERE account_id = $1
     ORDER BY entry_date DESC, created_at DESC
     LIMIT $2 OFFSET $3`,
    [account_id, limit, offset],
  );
  const { rows: countRows } = await ex(client)(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "factory_account_ledger")} WHERE account_id = $1`,
    [account_id],
  );
  return { entries: rows, total: countRows[0].total };
}

async function reconcileEntries({ client, brand, entry_ids }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "factory_account_ledger")}
     SET is_reconciled = TRUE
     WHERE entry_id = ANY($1::uuid[]) RETURNING entry_id`,
    [entry_ids],
  );
  return rows;
}

// ── Shipments ─────────────────────────────────────────────

async function nextShipmentRef({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(shipment_ref FROM 4) AS INT)), 0) + 1 AS n
     FROM ${t(brand, "factory_shipments")}`,
  );
  const n = String(rows[0].n).padStart(4, "0");
  return `SHP${n}`;
}

async function createShipment({ client, brand, data }) {
  const courierFeeBase = data.courier_fee_original
    ? parseFloat(data.courier_fee_original)
    : null;

  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "factory_shipments")}
       (shipment_ref, account_id, supplier_id, courier, tracking_number,
        courier_fee_original, courier_fee_currency, courier_fee_base,
        status, shipped_at, estimated_arrival, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'dispatched',$9,$10,$11,$12) RETURNING *`,
    [
      data.shipment_ref, data.account_id, data.supplier_id,
      data.courier, data.tracking_number ?? null,
      data.courier_fee_original ?? null,
      data.courier_fee_currency ?? "CNY",
      courierFeeBase,
      data.shipped_at ?? null, data.estimated_arrival ?? null,
      data.notes ?? null, data.created_by ?? null,
    ],
  );
  return rows[0];
}

async function addShipmentItems({ client, brand, shipment_id, items }) {
  const inserted = [];
  for (const item of items) {
    const { rows } = await ex(client)(
      `INSERT INTO ${t(brand, "factory_shipment_items")}
         (shipment_id, po_line_id, sku_description, quantity_shipped, unit_price_base)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        shipment_id,
        item.po_line_id ?? null,
        item.sku_description ?? null,
        item.quantity_shipped,
        item.unit_price_base ?? null,
      ],
    );
    inserted.push(rows[0]);
  }
  return inserted;
}

async function getShipment({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT fs.*, fa.account_name, fa.base_currency, s.supplier_name
     FROM ${t(brand, "factory_shipments")} fs
     JOIN ${t(brand, "factory_accounts")} fa ON fa.account_id = fs.account_id
     JOIN ${t(brand, "suppliers")} s ON s.supplier_id = fs.supplier_id
     WHERE fs.shipment_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: items } = await ex(client)(
    `SELECT * FROM ${t(brand, "factory_shipment_items")} WHERE shipment_id = $1`,
    [id],
  );
  return { ...rows[0], items };
}

async function listShipments({ client, brand, account_id, status, limit = 50, offset = 0 }) {
  const conditions = ["1=1"];
  const params = [];
  let idx = 1;
  if (account_id) { conditions.push(`fs.account_id = $${idx++}`); params.push(account_id); }
  if (status) { conditions.push(`fs.status = $${idx++}`); params.push(status); }

  const { rows } = await ex(client)(
    `SELECT fs.*, fa.account_name, s.supplier_name
     FROM ${t(brand, "factory_shipments")} fs
     JOIN ${t(brand, "factory_accounts")} fa ON fa.account_id = fs.account_id
     JOIN ${t(brand, "suppliers")} s ON s.supplier_id = fs.supplier_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY fs.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    [...params, limit, offset],
  );
  const { rows: countRows } = await ex(client)(
    `SELECT COUNT(*)::int AS total
     FROM ${t(brand, "factory_shipments")} fs
     WHERE ${conditions.join(" AND ")}`,
    params,
  );
  return { shipments: rows, total: countRows[0].total };
}

async function advanceShipment({ client, brand, id, data }) {
  const sets = ["status = $1", "updated_at = NOW()"];
  const params = [data.status];
  if (data.arrived_at) { sets.push(`arrived_at = $${params.length + 1}`); params.push(data.arrived_at); }
  if (data.notes) { sets.push(`notes = $${params.length + 1}`); params.push(data.notes); }
  params.push(id);

  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "factory_shipments")} SET ${sets.join(", ")}
     WHERE shipment_id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}

async function linkShipmentToPo({ client, brand, shipment_id, draft_po_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "factory_shipments")} SET draft_po_id = $1, updated_at = NOW()
     WHERE shipment_id = $2 RETURNING *`,
    [draft_po_id, shipment_id],
  );
  return rows[0] ?? null;
}

async function linkShipmentToGrn({ client, brand, shipment_id, grn_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "factory_shipments")} SET grn_id = $1, updated_at = NOW()
     WHERE shipment_id = $2 RETURNING *`,
    [grn_id, shipment_id],
  );
  return rows[0] ?? null;
}

module.exports = {
  createAccount, getAccount, listAccounts, updateAccount,
  addLedgerEntry, listLedgerEntries, reconcileEntries,
  nextShipmentRef, createShipment, addShipmentItems,
  getShipment, listShipments, advanceShipment,
  linkShipmentToPo, linkShipmentToGrn,
};
