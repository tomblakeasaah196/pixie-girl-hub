/**
 * POS terminal-payment reconciliation — repository.
 *
 * Backs the Sales → POS Reconciliation tab and the webhook fallback that
 * parks an unmatched Nomba terminal payment (business_setup/webhooks.service.js).
 * `shared.pos_terminal_reconciliation` is shared (not brand-scoped) because a
 * terminal's owning brand isn't known until it's resolved — see
 * migrations/000240_shared_pos_terminal_reconciliation.sql.
 *
 * Parameterised SQL only — no business logic, no HTTP.
 */

"use strict";

const { query, ex } = require("../../config/database");
const { t, assertBrand } = require("../../config/brands");

// ── Terminal registry (per-brand) ──────────────────────────

async function findTerminalByNombaId({ client, brand, nomba_terminal_id }) {
  assertBrand(brand);
  if (!nomba_terminal_id) return null;
  const { rows } = await ex(client)(
    `SELECT terminal_id, terminal_code, display_name, location_id
       FROM ${t(brand, "pos_terminals")}
      WHERE nomba_terminal_id = $1 AND is_active = true
      LIMIT 1`,
    [nomba_terminal_id],
  );
  return rows[0] || null;
}

// ── Reconciliation queue ────────────────────────────────────

const ENQUEUE_COLS = [
  "webhook_id",
  "provider",
  "resolved_brand",
  "nomba_terminal_id",
  "alias_account_name",
  "amount_ngn",
  "transaction_time",
  "provider_reference",
  "raw_payload",
];

/**
 * Idempotent insert — the partial unique index on (provider, provider_reference)
 * ensures a replayed/duplicate webhook enqueues at most once. Returns the
 * created row, or null when this exact transaction was already parked.
 */
async function enqueueReconciliation({ client, row }) {
  const f = [];
  const ph = [];
  const p = [];
  let i = 1;
  for (const c of ENQUEUE_COLS) {
    if (row[c] === undefined) continue;
    f.push(c);
    if (c === "raw_payload") {
      ph.push(`$${i++}::jsonb`);
      p.push(JSON.stringify(row[c]));
    } else {
      ph.push(`$${i++}`);
      p.push(row[c]);
    }
  }
  const { rows } = await ex(client)(
    `INSERT INTO shared.pos_terminal_reconciliation (${f.join(",")})
     VALUES (${ph.join(",")})
     ON CONFLICT (provider, provider_reference) WHERE provider_reference IS NOT NULL
     DO NOTHING
     RETURNING *`,
    p,
  );
  return rows[0] || null;
}

async function findById({ client, recon_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.pos_terminal_reconciliation WHERE recon_id = $1`,
    [recon_id],
  );
  return rows[0] || null;
}

// Match the paginated envelope every other admin list uses ({ data, meta });
// the admin api client's PaginatedResponse<T> expects this exact shape.
function envelope(rows, { page, page_size, total }) {
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total,
      has_more: (page - 1) * page_size + rows.length < total,
    },
  };
}

/** A brand's own pending queue — the terminal has already been resolved to it. */
async function listPending({ brand, page = 1, page_size = 25 }) {
  assertBrand(brand);
  const offset = (page - 1) * page_size;
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.pos_terminal_reconciliation
      WHERE resolved_brand = $1 AND status = 'pending'`,
    [brand],
  );
  const { rows } = await query(
    `SELECT * FROM shared.pos_terminal_reconciliation
      WHERE resolved_brand = $1 AND status = 'pending'
      ORDER BY transaction_time DESC NULLS LAST, created_at DESC
      LIMIT $2 OFFSET $3`,
    [brand, page_size, offset],
  );
  return envelope(rows, { page, page_size, total: c[0].total });
}

/** Cross-brand queue for payments whose terminal brand is still unknown —
 * CEO-only (enforced by the service layer), independent of X-Brand-Context. */
async function listUnresolved({ page = 1, page_size = 25 }) {
  const offset = (page - 1) * page_size;
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.pos_terminal_reconciliation
      WHERE resolved_brand IS NULL AND status = 'pending'`,
  );
  const { rows } = await query(
    `SELECT * FROM shared.pos_terminal_reconciliation
      WHERE resolved_brand IS NULL AND status = 'pending'
      ORDER BY transaction_time DESC NULLS LAST, created_at DESC
      LIMIT $1 OFFSET $2`,
    [page_size, offset],
  );
  return envelope(rows, { page, page_size, total: c[0].total });
}

async function markMatched({ recon_id, matched_brand, matched_order_id, matched_by }) {
  const { rows } = await query(
    `UPDATE shared.pos_terminal_reconciliation
        SET status = 'matched',
            matched_brand = $2,
            matched_order_id = $3,
            matched_by = $4,
            matched_at = now(),
            resolved_brand = COALESCE(resolved_brand, $2)
      WHERE recon_id = $1 AND status = 'pending'
      RETURNING *`,
    [recon_id, matched_brand, matched_order_id, matched_by],
  );
  return rows[0] || null;
}

/**
 * `matched_by`/`matched_at` double as "resolved by/at" for an ignore too —
 * the schema has no separate ignored_by/ignored_at pair, and reusing these
 * keeps one place to look for "who closed this row" regardless of outcome.
 */
async function markIgnored({ recon_id, note, ignored_by }) {
  const { rows } = await query(
    `UPDATE shared.pos_terminal_reconciliation
        SET status = 'ignored',
            note = $2,
            matched_by = $3,
            matched_at = now()
      WHERE recon_id = $1 AND status = 'pending'
      RETURNING *`,
    [recon_id, note, ignored_by],
  );
  return rows[0] || null;
}

/**
 * Staff who can act on POS Reconciliation for a brand: sales:edit grant
 * holders (brand-scoped or '*') plus every CEO — used for the new-item
 * notification fan-out. `brand` is null for unresolved-terminal items, which
 * narrows this to CEOs only. No generic "who holds this permission" helper
 * exists elsewhere yet, so this is self-contained to the feature.
 */
async function listNotifyRecipients({ brand }) {
  const { rows } = await query(
    `SELECT DISTINCT u.user_id
       FROM shared.users u
       LEFT JOIN shared.user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN shared.permissions p
         ON p.role_id = ur.role_id
        AND p.module = 'sales' AND p.action = 'edit' AND p.allowed = true
      WHERE u.status = 'active'
        AND (
          u.is_ceo = true
          OR (p.permission_id IS NOT NULL AND (ur.business = '*' OR ur.business = $1))
        )`,
    [brand || null],
  );
  return rows.map((r) => r.user_id);
}

module.exports = {
  findTerminalByNombaId,
  enqueueReconciliation,
  findById,
  listPending,
  listUnresolved,
  markMatched,
  markIgnored,
  listNotifyRecipients,
};
