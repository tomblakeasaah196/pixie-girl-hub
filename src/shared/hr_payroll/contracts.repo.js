/**
 * Staff contracts repository (HR — contract generation).
 * Parameterised SQL for shared.staff_contracts + a brand display-name lookup.
 */

"use strict";

const { ex: exec } = require("../../config/database");
async function businessName({ client, brand }) {
  const { rows } = await exec(client)(
    `SELECT display_name FROM shared.business_config WHERE business_key = $1 LIMIT 1`,
    [brand],
  );
  return rows[0] ? rows[0].display_name : null;
}

async function createContract({ client, input }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.staff_contracts
       (profile_id, contract_type, effective_from, effective_to,
        gross_salary, document_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      input.profile_id,
      input.contract_type,
      input.effective_from,
      input.effective_to || null,
      input.gross_salary,
      input.document_id || null,
      input.notes || null,
      input.created_by || null,
    ],
  );
  return rows[0];
}

async function listForProfile({ client, profileId }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.staff_contracts
      WHERE profile_id = $1 ORDER BY effective_from DESC`,
    [profileId],
  );
  return rows;
}

module.exports = { businessName, createContract, listForProfile };
