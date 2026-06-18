/**
 * Document numbering service (V2.2 §3).
 *
 * Allocates the next human-readable sequential number for a document type
 * from shared.document_numbering (e.g. PXG-SLP-0001). Used by every module
 * that issues numbered records (payslips, commissions, invoices, …).
 *
 * MUST be called inside the caller's transaction (pass the tx client) so the
 * allocation and the row insert commit together; the UPDATE ... RETURNING
 * locks the sequence row, serialising concurrent allocations.
 *
 * If a sequence isn't configured yet it is created from the brand's
 * document_prefix plus the given suffix (so a never-seeded type still works).
 */

"use strict";

function pad(n, width) {
  return String(n).padStart(width, "0");
}

async function brandPrefix(q, business, suffix, fallbackType) {
  const { rows } = await q(
    `SELECT document_prefix FROM shared.business_config WHERE business_key = $1`,
    [business],
  );
  if (!rows[0]) throw new Error(`Unknown business: ${business}`);
  const tail = (suffix || fallbackType.toUpperCase().slice(0, 3)).toUpperCase();
  return `${rows[0].document_prefix}-${tail}`;
}

/**
 * Allocate the next padded sequential number, e.g. "PXG-COM-0001".
 * @param {object} client  active pg transaction client (required)
 */
async function nextNumber(client, business, document_type, { suffix } = {}) {
  if (!client || typeof client.query !== "function") {
    throw new Error("nextNumber requires a transaction client");
  }
  const q = client.query.bind(client);

  let res = await q(
    `UPDATE shared.document_numbering
        SET next_number = next_number + 1
      WHERE business = $1 AND document_type = $2
      RETURNING prefix, (next_number - 1) AS allocated, padding`,
    [business, document_type],
  );

  if (res.rowCount === 0) {
    const prefix = await brandPrefix(q, business, suffix, document_type);
    res = await q(
      `INSERT INTO shared.document_numbering (business, document_type, prefix, next_number, padding)
       VALUES ($1, $2, $3, 2, 4)
       ON CONFLICT (business, document_type)
       DO UPDATE SET next_number = shared.document_numbering.next_number + 1
       RETURNING prefix,
                 (CASE WHEN xmax = 0 THEN 1 ELSE next_number - 1 END) AS allocated,
                 padding`,
      [business, document_type, prefix],
    );
  }

  const { prefix, allocated, padding } = res.rows[0];
  return `${prefix}-${pad(allocated, padding)}`;
}

/**
 * Allocate the next catalogue PRODUCT code in the brand's compact storefront
 * format: <PREFIX><zero-padded-seq><suffix> — e.g. "FLH001N" / "PXG001N".
 *
 * Unlike nextNumber (which splices a 3-letter type into the prefix, giving
 * "PXG-INV-0001"), product codes use the BARE brand prefix from
 * business_config plus a constant trailing letter, matching the codes printed
 * on physical stock. It is driven by the same shared.document_numbering
 * sequence (document_type = 'product') so Settings → Document Numbering stays
 * the single source of truth and the prefix/padding remain editable there.
 *
 * The sequence row is created lazily on first use from the brand's
 * document_prefix, so no migration/seed run is required to start importing.
 * MUST run inside the caller's transaction (the UPDATE ... RETURNING locks the
 * row, serialising concurrent allocations across single + bulk creates).
 *
 * @param {object} client  active pg transaction client (required)
 */
async function nextProductCode(
  client,
  business,
  { suffix = "N", padding = 3 } = {},
) {
  if (!client || typeof client.query !== "function") {
    throw new Error("nextProductCode requires a transaction client");
  }
  const q = client.query.bind(client);

  let res = await q(
    `UPDATE shared.document_numbering
        SET next_number = next_number + 1
      WHERE business = $1 AND document_type = 'product'
      RETURNING prefix, (next_number - 1) AS allocated, padding`,
    [business],
  );

  if (res.rowCount === 0) {
    const { rows } = await q(
      `SELECT document_prefix FROM shared.business_config WHERE business_key = $1`,
      [business],
    );
    if (!rows[0]) throw new Error(`Unknown business: ${business}`);
    res = await q(
      `INSERT INTO shared.document_numbering (business, document_type, prefix, next_number, padding)
       VALUES ($1, 'product', $2, 2, $3)
       ON CONFLICT (business, document_type)
       DO UPDATE SET next_number = shared.document_numbering.next_number + 1
       RETURNING prefix,
                 (CASE WHEN xmax = 0 THEN 1 ELSE next_number - 1 END) AS allocated,
                 padding`,
      [business, rows[0].document_prefix, padding],
    );
  }

  const { prefix, allocated, padding: pd } = res.rows[0];
  return `${prefix}${pad(allocated, pd)}${suffix}`;
}

/**
 * A period-stamped number that doesn't consume the sequence, e.g.
 * "PXG-PAY-2026-05" — uniqueness is guaranteed by the caller's own
 * UNIQUE(pay_year, pay_month) constraint.
 */
async function periodNumber(
  client,
  business,
  document_type,
  { suffix, year, month },
) {
  const q = client.query.bind(client);
  const { rows } = await q(
    `SELECT prefix FROM shared.document_numbering WHERE business = $1 AND document_type = $2`,
    [business, document_type],
  );
  const prefix = rows[0]
    ? rows[0].prefix
    : await brandPrefix(q, business, suffix, document_type);
  return `${prefix}-${year}-${pad(month, 2)}`;
}

module.exports = { nextNumber, nextProductCode, periodNumber };
