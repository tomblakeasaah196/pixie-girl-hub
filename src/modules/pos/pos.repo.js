/**
 * Point of Sale (V2.2 §6.3) — repository.
 * Per-brand tables: pos_terminals, pos_pin_credentials, pos_sessions,
 * pos_transactions, pos_payment_splits, pos_cash_drops, pos_void_log,
 * pos_session_summary. Numbers via fn_next_document_number().
 * Parameterised SQL only; checkout orchestration lives in the service.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
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

// ── pos_terminals ────────────────────────────────────────
const TERMINAL_COLS = [
  "display_name",
  "location_id",
  "default_sell_location_id",
  "device_fingerprint",
  "printer_endpoint",
  "nomba_terminal_id",
  "paystack_terminal_id",
  "is_active",
  "is_offline_capable",
  "opening_cash_float_ngn",
];
async function createTerminal({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "pos_terminals")}
       (terminal_code, display_name, location_id, default_sell_location_id, device_fingerprint, printer_endpoint,
        nomba_terminal_id, paystack_terminal_id, is_offline_capable, opening_cash_float_ngn)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,true),COALESCE($10,0)) RETURNING *`,
    [
      row.terminal_code,
      row.display_name,
      row.location_id,
      row.default_sell_location_id || null,
      row.device_fingerprint || null,
      row.printer_endpoint || null,
      row.nomba_terminal_id || null,
      row.paystack_terminal_id || null,
      row.is_offline_capable,
      row.opening_cash_float_ngn,
    ],
  );
  return rows[0];
}
async function getTerminal({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_terminals")} WHERE terminal_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function findTerminalByNombaId({ client, brand, nomba_terminal_id }) {
  if (!nomba_terminal_id) return null;
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_terminals")} WHERE nomba_terminal_id = $1 LIMIT 1`,
    [nomba_terminal_id],
  );
  return rows[0] || null;
}
async function listTerminals({ client, brand, is_active }) {
  const where = [];
  const params = [];
  let i = 1;
  if (is_active !== undefined) {
    where.push(`is_active = $${i++}`);
    params.push(is_active);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_terminals")} ${w} ORDER BY display_name`,
    params,
  );
  return rows;
}
async function updateTerminal({ client, brand, id, patch }) {
  const { f, p, next } = buildUpdate(TERMINAL_COLS, patch);
  if (f.length === 0) return getTerminal({ client, brand, id });
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "pos_terminals")} SET ${f.join(", ")} WHERE terminal_id = $${next} RETURNING *`,
    [...p, id],
  );
  return rows[0] || null;
}

// ── pos_pin_credentials ──────────────────────────────────
async function getPinByUser({ client, brand, user_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_pin_credentials")} WHERE user_id = $1`,
    [user_id],
  );
  return rows[0] || null;
}
async function upsertPin({
  client,
  brand,
  user_id,
  pin_hash,
  must_change_pin = false,
  expires_at = null,
}) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "pos_pin_credentials")} (user_id, pin_hash, must_change_pin, expires_at, failed_attempts, locked_until, changed_at)
     VALUES ($1,$2,$3,$4,0,NULL, now())
     ON CONFLICT (user_id) DO UPDATE SET
       pin_hash = EXCLUDED.pin_hash, must_change_pin = EXCLUDED.must_change_pin, expires_at = EXCLUDED.expires_at,
       failed_attempts = 0, locked_until = NULL, is_active = true, changed_at = now()
     RETURNING *`,
    [user_id, pin_hash, must_change_pin, expires_at],
  );
  return rows[0];
}
async function setPinState({ client, brand, user_id, patch }) {
  const cols = [
    "failed_attempts",
    "locked_until",
    "last_used_at",
    "is_active",
    "must_change_pin",
  ];
  const { f, p, next } = buildUpdate(cols, patch);
  if (f.length === 0) return getPinByUser({ client, brand, user_id });
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "pos_pin_credentials")} SET ${f.join(", ")} WHERE user_id = $${next} RETURNING *`,
    [...p, user_id],
  );
  return rows[0] || null;
}

// ── pos_sessions ─────────────────────────────────────────
async function createSession({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "pos_sessions")} (session_number, terminal_id, staff_user_id, opening_cash_ngn)
     VALUES ($1,$2,$3,COALESCE($4,0)) RETURNING *`,
    [
      row.session_number,
      row.terminal_id,
      row.staff_user_id,
      row.opening_cash_ngn,
    ],
  );
  return rows[0];
}
async function getSession({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_sessions")} WHERE session_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function findOpenSessionForTerminal({ client, brand, terminal_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_sessions")} WHERE terminal_id = $1 AND status = 'open'`,
    [terminal_id],
  );
  return rows[0] || null;
}
async function listSessions({
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
  if (filters.terminal_id) {
    where.push(`terminal_id = $${i++}`);
    params.push(filters.terminal_id);
  }
  if (filters.staff_user_id) {
    where.push(`staff_user_id = $${i++}`);
    params.push(filters.staff_user_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "pos_sessions")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "pos_sessions")} ${w} ORDER BY opened_at DESC LIMIT $${i++} OFFSET $${i++}`,
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
async function setSessionStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "pos_sessions")} SET ${sets.join(", ")} WHERE session_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── pos_transactions ─────────────────────────────────────
async function createTransaction({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "pos_transactions")}
       (transaction_number, order_id, session_id, terminal_id, cashier_user_id, customer_contact_id, is_walk_in,
        subtotal_ngn, discount_total_ngn, tax_total_ngn, total_ngn, was_offline, client_idempotency_key, status)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true),COALESCE($8,0),COALESCE($9,0),COALESCE($10,0),$11,COALESCE($12,false),$13,'pending') RETURNING *`,
    [
      row.transaction_number,
      row.order_id,
      row.session_id,
      row.terminal_id,
      row.cashier_user_id,
      row.customer_contact_id || null,
      row.is_walk_in,
      row.subtotal_ngn,
      row.discount_total_ngn,
      row.tax_total_ngn,
      row.total_ngn,
      row.was_offline,
      row.client_idempotency_key || null,
    ],
  );
  return rows[0];
}
async function getTransaction({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_transactions")} WHERE transaction_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: splits } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_payment_splits")} WHERE transaction_id = $1 ORDER BY recorded_at`,
    [id],
  );
  return { ...rows[0], splits };
}
async function findTransactionByIdempotency({
  client,
  brand,
  terminal_id,
  key,
}) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_transactions")} WHERE terminal_id = $1 AND client_idempotency_key = $2`,
    [terminal_id, key],
  );
  return rows[0] || null;
}
async function listTransactions({
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
  if (filters.session_id) {
    where.push(`session_id = $${i++}`);
    params.push(filters.session_id);
  }
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.cashier_user_id) {
    where.push(`cashier_user_id = $${i++}`);
    params.push(filters.cashier_user_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "pos_transactions")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "pos_transactions")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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
async function setTransaction({ client, brand, id, patch }) {
  const cols = [
    "status",
    "voided_at",
    "voided_by",
    "void_reason",
    "receipt_printed",
    "receipt_emailed_to",
    "receipt_whatsapp_to",
    "cash_received_ngn",
    "cash_returned_ngn",
    "card_received_ngn",
    "transfer_received_ngn",
    "points_redeemed_ngn",
    "offline_synced_at",
  ];
  const { f, p, next } = buildUpdate(cols, patch);
  if (f.length === 0) return null;
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "pos_transactions")} SET ${f.join(", ")} WHERE transaction_id = $${next} RETURNING *`,
    [...p, id],
  );
  return rows[0] || null;
}

// ── pos_payment_splits ───────────────────────────────────
async function addSplit({ client, brand, split }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "pos_payment_splits")}
       (transaction_id, sales_order_payment_id, method, amount_ngn, provider_reference, approval_code, card_last4, cash_tendered_ngn, cash_returned_ngn, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'completed')) RETURNING *`,
    [
      split.transaction_id,
      split.sales_order_payment_id || null,
      split.method,
      split.amount_ngn,
      split.provider_reference || null,
      split.approval_code || null,
      split.card_last4 || null,
      split.cash_tendered_ngn ?? null,
      split.cash_returned_ngn ?? null,
      split.status,
    ],
  );
  return rows[0];
}

// ── pos_cash_drops ───────────────────────────────────────
async function createDrop({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "pos_cash_drops")} (drop_number, session_id, amount_ngn, reason, performed_by, witnessed_by, destination, bank_deposit_reference, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      row.drop_number,
      row.session_id,
      row.amount_ngn,
      row.reason || null,
      row.performed_by || null,
      row.witnessed_by || null,
      row.destination || null,
      row.bank_deposit_reference || null,
      row.notes || null,
    ],
  );
  return rows[0];
}
async function listDrops({ client, brand, session_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_cash_drops")} WHERE session_id = $1 ORDER BY performed_at`,
    [session_id],
  );
  return rows;
}
async function sumDrops({ client, brand, session_id }) {
  const { rows } = await ex(client)(
    `SELECT COALESCE(SUM(amount_ngn),0)::numeric AS total FROM ${t(brand, "pos_cash_drops")} WHERE session_id = $1`,
    [session_id],
  );
  return Number(rows[0].total);
}

// ── pos_void_log ─────────────────────────────────────────
async function addVoid({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "pos_void_log")} (transaction_id, void_type, voided_line_id, amount_ngn, reason, performed_by, approved_by, workflow_instance_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      row.transaction_id,
      row.void_type,
      row.voided_line_id || null,
      row.amount_ngn,
      row.reason,
      row.performed_by,
      row.approved_by || null,
      row.workflow_instance_id || null,
    ],
  );
  return rows[0];
}
async function listVoids({ client, brand, transaction_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_void_log")} WHERE transaction_id = $1 ORDER BY performed_at`,
    [transaction_id],
  );
  return rows;
}

// ── pos_session_summary (Z-report) ───────────────────────
async function aggregateSession({ client, brand, session_id }) {
  const run = ex(client);
  const { rows: tx } = await run(
    `SELECT
        COUNT(*)::int AS total_transactions,
        COUNT(*) FILTER (WHERE is_walk_in)::int AS walk_in_transactions,
        COUNT(*) FILTER (WHERE NOT is_walk_in)::int AS dispatch_transactions,
        COUNT(*) FILTER (WHERE status = 'voided')::int AS void_transactions,
        COUNT(*) FILTER (WHERE status IN ('refunded','partial_refund'))::int AS refund_transactions,
        COALESCE(SUM(subtotal_ngn) FILTER (WHERE status = 'completed'),0)::numeric AS gross_sales_ngn,
        COALESCE(SUM(discount_total_ngn) FILTER (WHERE status = 'completed'),0)::numeric AS discounts_given_ngn,
        COALESCE(SUM(tax_total_ngn) FILTER (WHERE status = 'completed'),0)::numeric AS tax_collected_ngn,
        COALESCE(SUM(total_ngn) FILTER (WHERE status = 'completed'),0)::numeric AS net_sales_ngn,
        COUNT(DISTINCT customer_contact_id) FILTER (WHERE customer_contact_id IS NOT NULL)::int AS unique_customers
       FROM ${t(brand, "pos_transactions")} WHERE session_id = $1`,
    [session_id],
  );
  const { rows: pay } = await run(
    `SELECT
        COALESCE(SUM(s.amount_ngn) FILTER (WHERE s.method = 'cash'),0)::numeric AS cash_collected_ngn,
        COALESCE(SUM(s.amount_ngn) FILTER (WHERE s.method IN ('paystack_card','nomba_terminal')),0)::numeric AS card_collected_ngn,
        COALESCE(SUM(s.amount_ngn) FILTER (WHERE s.method IN ('paystack_transfer','bank_transfer','opay')),0)::numeric AS transfer_collected_ngn,
        COALESCE(SUM(s.amount_ngn) FILTER (WHERE s.method = 'points'),0)::numeric AS points_redeemed_ngn,
        COALESCE(SUM(s.amount_ngn) FILTER (WHERE s.method IN ('wallet','voucher')),0)::numeric AS other_collected_ngn
       FROM ${t(brand, "pos_payment_splits")} s
       JOIN ${t(brand, "pos_transactions")} txn ON txn.transaction_id = s.transaction_id
      WHERE txn.session_id = $1 AND txn.status = 'completed' AND s.status = 'completed'`,
    [session_id],
  );
  return { ...tx[0], ...pay[0] };
}
async function upsertSummary({ client, brand, session_id, row }) {
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 2}`);
  const updates = cols.map((c) => `${c} = EXCLUDED.${c}`);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "pos_session_summary")} (session_id, ${cols.join(", ")})
     VALUES ($1, ${placeholders.join(", ")})
     ON CONFLICT (session_id) DO UPDATE SET ${updates.join(", ")}, generated_at = now()
     RETURNING *`,
    [session_id, ...cols.map((c) => row[c])],
  );
  return rows[0];
}
async function getSummary({ client, brand, session_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pos_session_summary")} WHERE session_id = $1`,
    [session_id],
  );
  return rows[0] || null;
}

// ── shared.pos_terminal_reconciliation (Fallback 1) ──────
// Cross-brand queue: webhooks are received before the brand is known, so this
// table lives in `shared`. Rows are filtered to a brand by resolved_brand.
async function enqueueReconciliation({ client, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.pos_terminal_reconciliation
       (webhook_id, provider, resolved_brand, nomba_terminal_id, alias_account_name,
        sender_name, sender_bank, amount_ngn, transaction_time, provider_reference, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     ON CONFLICT (provider, provider_reference) WHERE provider_reference IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [
      row.webhook_id || null,
      row.provider || "nomba",
      row.resolved_brand || null,
      row.nomba_terminal_id || null,
      row.alias_account_name || null,
      row.sender_name || null,
      row.sender_bank || null,
      row.amount_ngn,
      row.transaction_time || null,
      row.provider_reference || null,
      JSON.stringify(row.raw_payload || {}),
    ],
  );
  return rows[0] || null;
}
async function listReconciliation({
  client,
  brand,
  status = "pending",
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  // A brand sees its own terminals' items plus any still-unresolved (NULL) rows.
  const where = `WHERE (resolved_brand = $1 OR resolved_brand IS NULL) AND status = $2`;
  const params = [brand, status];
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM shared.pos_terminal_reconciliation ${where}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM shared.pos_terminal_reconciliation ${where}
      ORDER BY transaction_time DESC NULLS LAST, created_at DESC
      LIMIT $3 OFFSET $4`,
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
async function getReconciliation({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.pos_terminal_reconciliation WHERE recon_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function setReconciliationStatus({ client, id, patch }) {
  const cols = [
    "status",
    "resolved_brand",
    "matched_brand",
    "matched_order_id",
    "matched_by",
    "matched_at",
    "note",
  ];
  const { f, p, next } = buildUpdate(cols, patch);
  if (f.length === 0) return getReconciliation({ client, id });
  const { rows } = await ex(client)(
    `UPDATE shared.pos_terminal_reconciliation SET ${f.join(", ")} WHERE recon_id = $${next} RETURNING *`,
    [...p, id],
  );
  return rows[0] || null;
}

module.exports = {
  nextNumber,
  createTerminal,
  getTerminal,
  findTerminalByNombaId,
  listTerminals,
  updateTerminal,
  enqueueReconciliation,
  listReconciliation,
  getReconciliation,
  setReconciliationStatus,
  getPinByUser,
  upsertPin,
  setPinState,
  createSession,
  getSession,
  findOpenSessionForTerminal,
  listSessions,
  setSessionStatus,
  createTransaction,
  getTransaction,
  findTransactionByIdempotency,
  listTransactions,
  setTransaction,
  addSplit,
  createDrop,
  listDrops,
  sumDrops,
  addVoid,
  listVoids,
  aggregateSession,
  upsertSummary,
  getSummary,
};
