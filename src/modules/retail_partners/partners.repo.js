/**
 * Retail Partners (V2.2 §6.29) — repository.
 *
 * Per-brand tables: retail_partners, consignment_locations, consignment_stock,
 * consignment_movements, partner_settlements (+ _lines). PXG ships on
 * consignment; partners sell to end customers; a monthly settlement computes
 * each side's share. Parameterised SQL only; per-brand via the brand registry.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

const ex = (c) => (c ? c.query.bind(c) : query);

async function nextNumber({ client, brand, type }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS n`,
    [type],
  );
  return rows[0].n;
}

// ── Partners ───────────────────────────────────────────────
async function createPartner({ brand, p }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "retail_partners")}
       (partner_code, contact_id, display_name, margin_share_pct,
        payment_terms_days, credit_limit_ngn, settlement_frequency,
        onboarded_at, contract_document_id, notes, created_by)
     VALUES ($1,$2,$3,COALESCE($4,30),COALESCE($5,30),$6,
             COALESCE($7,'monthly'),$8,$9,$10,$11) RETURNING *`,
    [
      p.partner_code,
      p.contact_id,
      p.display_name,
      p.margin_share_pct === undefined ? null : p.margin_share_pct,
      p.payment_terms_days === undefined ? null : p.payment_terms_days,
      p.credit_limit_ngn === undefined ? null : p.credit_limit_ngn,
      p.settlement_frequency || null,
      p.onboarded_at || null,
      p.contract_document_id || null,
      p.notes || null,
      p.created_by || null,
    ],
  );
  return rows[0];
}
async function listPartners({ brand, status }) {
  const where = [];
  const params = [];
  let i = 1;
  if (status) {
    where.push(`rp.status = $${i++}`);
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT rp.*, c.email, c.primary_phone, c.company_name
       FROM ${t(brand, "retail_partners")} rp
       LEFT JOIN shared.contacts c ON c.contact_id = rp.contact_id
       ${w} ORDER BY rp.created_at DESC`,
    params,
  );
  return rows;
}
async function findPartner({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT rp.*, c.email, c.primary_phone, c.company_name
       FROM ${t(brand, "retail_partners")} rp
       LEFT JOIN shared.contacts c ON c.contact_id = rp.contact_id
      WHERE rp.partner_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function updatePartner({ brand, id, patch }) {
  const allowed = [
    "display_name",
    "margin_share_pct",
    "payment_terms_days",
    "credit_limit_ngn",
    "settlement_frequency",
    "contract_document_id",
    "notes",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(patch[k]);
    }
  }
  if (!sets.length) return findPartner({ brand, id });
  params.push(id);
  const { rows } = await query(
    `UPDATE ${t(brand, "retail_partners")} SET ${sets.join(", ")}, updated_at = now()
      WHERE partner_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function setPartnerStatus({ brand, id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await query(
    `UPDATE ${t(brand, "retail_partners")} SET ${sets.join(", ")}, updated_at = now()
      WHERE partner_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Locations ──────────────────────────────────────────────
async function createLocation({ brand, loc }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "consignment_locations")}
       (partner_id, stock_location_id, display_name, address, city, state,
        manager_name, manager_phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      loc.partner_id,
      loc.stock_location_id,
      loc.display_name,
      loc.address || null,
      loc.city || null,
      loc.state || null,
      loc.manager_name || null,
      loc.manager_phone || null,
    ],
  );
  return rows[0];
}
async function listLocations({ brand, partner_id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "consignment_locations")} WHERE partner_id = $1 ORDER BY display_name`,
    [partner_id],
  );
  return rows;
}
async function findLocation({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "consignment_locations")} WHERE consignment_location_id = $1`,
    [id],
  );
  return rows[0] || null;
}

// ── Consignment stock (maintained here — no DB trigger) ────
async function getStockRow({
  client,
  brand,
  consignment_location_id,
  variant_id,
}) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "consignment_stock")}
      WHERE consignment_location_id = $1 AND variant_id = $2`,
    [consignment_location_id, variant_id],
  );
  return rows[0] || null;
}
async function upsertStock({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "consignment_stock")}
       (consignment_location_id, partner_id, variant_id, qty_on_hand,
        qty_sold_since_last_settlement, qty_returned_since_last_settlement,
        agreed_retail_price_ngn, last_movement_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (consignment_location_id, variant_id) DO UPDATE
       SET qty_on_hand = $4,
           qty_sold_since_last_settlement = $5,
           qty_returned_since_last_settlement = $6,
           agreed_retail_price_ngn = COALESCE($7, ${t(brand, "consignment_stock")}.agreed_retail_price_ngn),
           last_movement_at = now()
     RETURNING *`,
    [
      row.consignment_location_id,
      row.partner_id,
      row.variant_id,
      row.qty_on_hand,
      row.qty_sold,
      row.qty_returned,
      row.agreed_retail_price_ngn || null,
    ],
  );
  return rows[0];
}
async function listStock({ brand, partner_id, consignment_location_id }) {
  const where = [];
  const params = [];
  let i = 1;
  if (partner_id) {
    where.push(`cs.partner_id = $${i++}`);
    params.push(partner_id);
  }
  if (consignment_location_id) {
    where.push(`cs.consignment_location_id = $${i++}`);
    params.push(consignment_location_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT cs.*, pv.sku, pv.variant_name,
            cl.display_name AS location_name,
            rp.display_name AS partner_name
       FROM ${t(brand, "consignment_stock")} cs
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = cs.variant_id
       LEFT JOIN ${t(brand, "consignment_locations")} cl
              ON cl.consignment_location_id = cs.consignment_location_id
       LEFT JOIN ${t(brand, "retail_partners")} rp ON rp.partner_id = cs.partner_id
       ${w} ORDER BY cs.last_movement_at DESC NULLS LAST`,
    params,
  );
  return rows;
}
async function resetStockCounters({ client, brand, partner_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "consignment_stock")}
        SET qty_sold_since_last_settlement = 0,
            qty_returned_since_last_settlement = 0,
            updated_at = now()
      WHERE partner_id = $1`,
    [partner_id],
  );
}

// ── Movements ──────────────────────────────────────────────
async function insertMovement({ client, brand, m }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "consignment_movements")}
       (movement_number, consignment_location_id, partner_id, variant_id,
        movement_type, quantity, unit_retail_price_ngn, partner_share_ngn,
        brand_share_ngn, reported_sale_at, reported_customer_name,
        stock_movement_id, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      m.movement_number,
      m.consignment_location_id,
      m.partner_id,
      m.variant_id,
      m.movement_type,
      m.quantity,
      m.unit_retail_price_ngn === undefined ? null : m.unit_retail_price_ngn,
      m.partner_share_ngn === undefined ? null : m.partner_share_ngn,
      m.brand_share_ngn === undefined ? null : m.brand_share_ngn,
      m.reported_sale_at || null,
      m.reported_customer_name || null,
      m.stock_movement_id || null,
      m.notes || null,
      m.recorded_by || null,
    ],
  );
  return rows[0];
}
async function listMovements({
  brand,
  partner_id,
  consignment_location_id,
  settled,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (partner_id) {
    where.push(`m.partner_id = $${i++}`);
    params.push(partner_id);
  }
  if (consignment_location_id) {
    where.push(`m.consignment_location_id = $${i++}`);
    params.push(consignment_location_id);
  }
  if (settled === false) where.push(`m.settlement_id IS NULL`);
  if (settled === true) where.push(`m.settlement_id IS NOT NULL`);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT m.*, pv.sku, pv.variant_name,
            cl.display_name AS location_name,
            rp.display_name AS partner_name
       FROM ${t(brand, "consignment_movements")} m
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = m.variant_id
       LEFT JOIN ${t(brand, "consignment_locations")} cl
              ON cl.consignment_location_id = m.consignment_location_id
       LEFT JOIN ${t(brand, "retail_partners")} rp ON rp.partner_id = m.partner_id
       ${w} ORDER BY m.recorded_at DESC`,
    params,
  );
  return rows;
}
async function unsettledForPeriod({
  client,
  brand,
  partner_id,
  period_start,
  period_end,
}) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "consignment_movements")}
      WHERE partner_id = $1 AND settlement_id IS NULL
        AND movement_type IN ('partner_sale','partner_return','partner_damage')
        AND recorded_at::date BETWEEN $2 AND $3
      ORDER BY recorded_at ASC`,
    [partner_id, period_start, period_end],
  );
  return rows;
}
async function linkMovementsToSettlement({
  client,
  brand,
  movement_ids,
  settlement_id,
}) {
  if (!movement_ids.length) return;
  await ex(client)(
    `UPDATE ${t(brand, "consignment_movements")} SET settlement_id = $2
      WHERE movement_id = ANY($1::uuid[])`,
    [movement_ids, settlement_id],
  );
}

// ── Settlements ────────────────────────────────────────────
async function createSettlement({ client, brand, s }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "partner_settlements")}
       (settlement_number, partner_id, period_start, period_end,
        total_gross_sales_ngn, total_returns_ngn, total_net_sales_ngn,
        total_partner_share_ngn, total_brand_share_ngn, total_damages_ngn,
        units_sold, units_returned)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      s.settlement_number,
      s.partner_id,
      s.period_start,
      s.period_end,
      s.total_gross_sales_ngn,
      s.total_returns_ngn,
      s.total_net_sales_ngn,
      s.total_partner_share_ngn,
      s.total_brand_share_ngn,
      s.total_damages_ngn,
      s.units_sold,
      s.units_returned,
    ],
  );
  return rows[0];
}
async function addSettlementLine({ client, brand, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "partner_settlement_lines")}
       (settlement_id, variant_id, consignment_location_id, units_sold,
        units_returned, units_damaged, gross_sales_ngn, partner_share_ngn,
        brand_share_ngn, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      line.settlement_id,
      line.variant_id || null,
      line.consignment_location_id || null,
      line.units_sold,
      line.units_returned,
      line.units_damaged,
      line.gross_sales_ngn,
      line.partner_share_ngn,
      line.brand_share_ngn,
      line.display_order || 0,
    ],
  );
  return rows[0];
}
async function listSettlements({ brand, partner_id, status }) {
  const where = [];
  const params = [];
  let i = 1;
  if (partner_id) {
    where.push(`ps.partner_id = $${i++}`);
    params.push(partner_id);
  }
  if (status) {
    where.push(`ps.status = $${i++}`);
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT ps.*, rp.display_name AS partner_name
       FROM ${t(brand, "partner_settlements")} ps
       LEFT JOIN ${t(brand, "retail_partners")} rp ON rp.partner_id = ps.partner_id
       ${w} ORDER BY ps.period_end DESC`,
    params,
  );
  return rows;
}
async function findSettlement({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT ps.*, rp.display_name AS partner_name
       FROM ${t(brand, "partner_settlements")} ps
       LEFT JOIN ${t(brand, "retail_partners")} rp ON rp.partner_id = ps.partner_id
      WHERE ps.settlement_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT l.*, pv.sku, pv.variant_name,
            cl.display_name AS location_name
       FROM ${t(brand, "partner_settlement_lines")} l
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = l.variant_id
       LEFT JOIN ${t(brand, "consignment_locations")} cl
              ON cl.consignment_location_id = l.consignment_location_id
      WHERE l.settlement_id = $1 ORDER BY l.display_order`,
    [id],
  );
  return { ...rows[0], lines };
}
async function setSettlementStatus({ client, brand, id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "partner_settlements")} SET ${sets.join(", ")}, updated_at = now()
      WHERE settlement_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

module.exports = {
  nextNumber,
  createPartner,
  listPartners,
  findPartner,
  updatePartner,
  setPartnerStatus,
  createLocation,
  listLocations,
  findLocation,
  getStockRow,
  upsertStock,
  listStock,
  resetStockCounters,
  insertMovement,
  listMovements,
  unsettledForPeriod,
  linkMovementsToSettlement,
  createSettlement,
  addSettlementLine,
  listSettlements,
  findSettlement,
  setSettlementStatus,
};
