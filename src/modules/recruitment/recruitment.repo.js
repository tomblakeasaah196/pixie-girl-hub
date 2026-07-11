/**
 * Recruitment repository — parameterised SQL only (no business logic, no events).
 *
 * Owns shared.recruitment_context, shared.role_templates, shared.job_openings,
 * shared.candidates and shared.recruitment_offers. Everything is in the `shared`
 * schema (cross-brand); rows carry a `business` key for the issuing brand.
 */

"use strict";

const { query, transaction } = require("../../config/database");

const jsonb = (v) => JSON.stringify(v === null || v === undefined ? {} : v);

// ── Company context pack ───────────────────────────────────
async function getContext({ businesses }) {
  const keys = Array.from(new Set(["*", ...(businesses || [])]));
  const { rows } = await query(
    `SELECT * FROM shared.recruitment_context WHERE business = ANY($1::text[])`,
    [keys],
  );
  return rows;
}

async function listContext() {
  const { rows } = await query(
    `SELECT * FROM shared.recruitment_context ORDER BY business`,
  );
  return rows;
}

async function upsertContext({ business, fields, user_id }) {
  const { rows } = await query(
    `INSERT INTO shared.recruitment_context
       (business, display_name, summary, tone, target_markets,
        non_negotiables, signatory_name, signatory_title,
        signatory_signature_data_url, notes, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (business) DO UPDATE SET
        display_name                 = EXCLUDED.display_name,
        summary                      = EXCLUDED.summary,
        tone                         = EXCLUDED.tone,
        target_markets               = EXCLUDED.target_markets,
        non_negotiables              = EXCLUDED.non_negotiables,
        signatory_name               = EXCLUDED.signatory_name,
        signatory_title              = EXCLUDED.signatory_title,
        signatory_signature_data_url = EXCLUDED.signatory_signature_data_url,
        notes                        = EXCLUDED.notes,
        updated_by                   = EXCLUDED.updated_by,
        updated_at                   = now()
     RETURNING *`,
    [
      business,
      fields.display_name || null,
      fields.summary || null,
      fields.tone || null,
      fields.target_markets || null,
      fields.non_negotiables || null,
      fields.signatory_name || null,
      fields.signatory_title || null,
      fields.signatory_signature_data_url || null,
      fields.notes || null,
      user_id || null,
    ],
  );
  return rows[0];
}

// ── Role templates ─────────────────────────────────────────
async function listTemplates({ business }) {
  const { rows } = await query(
    `SELECT * FROM shared.role_templates
      WHERE business IS NULL OR business = $1
      ORDER BY title`,
    [business || null],
  );
  return rows;
}

async function createTemplate({ input, user_id }) {
  const { rows } = await query(
    `INSERT INTO shared.role_templates
       (business, title, department, employment_type, seniority, intake, content, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
     RETURNING *`,
    [
      input.business || null,
      input.title,
      input.department || null,
      input.employment_type || "full_time",
      input.seniority || null,
      jsonb(input.intake),
      jsonb(input.content),
      user_id || null,
    ],
  );
  return rows[0];
}

async function deleteTemplate({ id }) {
  await query(`DELETE FROM shared.role_templates WHERE template_id = $1`, [id]);
}

// ── Job openings ───────────────────────────────────────────
async function createOpening({ brand, input, user_id, client }) {
  const q = client || { query };
  const { rows } = await q.query(
    `INSERT INTO shared.job_openings
       (business, title, department, employment_type, seniority, location,
        headcount, target_businesses, intake, jd_markdown, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::jsonb,$10,$11)
     RETURNING *`,
    [
      brand,
      input.title,
      input.department || null,
      input.employment_type || "full_time",
      input.seniority || null,
      input.location || null,
      input.headcount || 1,
      input.target_businesses || [],
      jsonb(input.intake),
      input.jd_markdown || null,
      user_id || null,
    ],
  );
  return rows[0];
}

async function listOpenings({ brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.job_openings WHERE business = $1 ORDER BY created_at DESC`,
    [brand],
  );
  return rows;
}

// ── Candidates ─────────────────────────────────────────────
async function createCandidate({ brand, input, user_id, client }) {
  const q = client || { query };
  const { rows } = await q.query(
    `INSERT INTO shared.candidates
       (business, opening_id, full_name, email, phone, source, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      brand,
      input.opening_id || null,
      input.full_name,
      input.email,
      input.phone || null,
      input.source || null,
      input.notes || null,
      user_id || null,
    ],
  );
  return rows[0];
}

// ── Offers ─────────────────────────────────────────────────
const OFFER_COLS = `offer_id, business, opening_id, candidate_id, title,
  candidate_name, candidate_email, target_businesses, jd_markdown, offer_markdown,
  offer_meta, status, public_token, signature_request_id, offer_document_id,
  contract_document_id, role_ids, is_ceo, provisioned_user_id, ai_provider,
  expires_at, sent_at, signed_at, provisioned_at, created_by, created_at, updated_at`;

async function createOffer({ brand, input, user_id, client }) {
  const q = client || { query };
  const { rows } = await q.query(
    `INSERT INTO shared.recruitment_offers
       (business, opening_id, candidate_id, title, candidate_name, candidate_email,
        target_businesses, jd_markdown, offer_markdown, offer_meta, role_ids,
        is_ceo, ai_provider, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10::jsonb,$11::uuid[],$12,$13,$14)
     RETURNING ${OFFER_COLS}`,
    [
      brand,
      input.opening_id || null,
      input.candidate_id || null,
      input.title,
      input.candidate_name || null,
      input.candidate_email || null,
      input.target_businesses || [],
      input.jd_markdown || "",
      input.offer_markdown || "",
      jsonb(input.offer_meta),
      input.role_ids || [],
      input.is_ceo || false,
      input.ai_provider || null,
      user_id || null,
    ],
  );
  return rows[0];
}

async function getOffer({ brand, id }) {
  const { rows } = await query(
    `SELECT ${OFFER_COLS} FROM shared.recruitment_offers
      WHERE offer_id = $1 ${brand ? "AND business = $2" : ""}`,
    brand ? [id, brand] : [id],
  );
  return rows[0] || null;
}

async function getOfferByToken({ token }) {
  const { rows } = await query(
    `SELECT ${OFFER_COLS} FROM shared.recruitment_offers WHERE public_token = $1`,
    [token],
  );
  return rows[0] || null;
}

async function listOffers({ brand, status }) {
  const params = [brand];
  let where = `business = $1`;
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT ${OFFER_COLS} FROM shared.recruitment_offers
      WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
    params,
  );
  return rows;
}

/**
 * Patch an offer's mutable fields. Only whitelisted keys are updatable; jsonb
 * and array columns are cast explicitly. Returns the updated row.
 */
async function updateOffer({ id, fields, client }) {
  const q = client || { query };
  const sets = [];
  const params = [];
  const put = (col, val, cast = "") => {
    params.push(val);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (fields.title !== undefined) put("title", fields.title);
  if (fields.candidate_name !== undefined) put("candidate_name", fields.candidate_name);
  if (fields.candidate_email !== undefined) put("candidate_email", fields.candidate_email);
  if (fields.candidate_id !== undefined) put("candidate_id", fields.candidate_id);
  if (fields.target_businesses !== undefined)
    put("target_businesses", fields.target_businesses, "::text[]");
  if (fields.jd_markdown !== undefined) put("jd_markdown", fields.jd_markdown);
  if (fields.offer_markdown !== undefined) put("offer_markdown", fields.offer_markdown);
  if (fields.offer_meta !== undefined) put("offer_meta", jsonb(fields.offer_meta), "::jsonb");
  if (fields.role_ids !== undefined) put("role_ids", fields.role_ids, "::uuid[]");
  if (fields.is_ceo !== undefined) put("is_ceo", fields.is_ceo);
  if (fields.status !== undefined) put("status", fields.status);
  if (fields.public_token !== undefined) put("public_token", fields.public_token);
  if (fields.signature_request_id !== undefined)
    put("signature_request_id", fields.signature_request_id);
  if (fields.offer_document_id !== undefined) put("offer_document_id", fields.offer_document_id);
  if (fields.contract_document_id !== undefined)
    put("contract_document_id", fields.contract_document_id);
  if (fields.ai_provider !== undefined) put("ai_provider", fields.ai_provider);
  if (fields.expires_at !== undefined) put("expires_at", fields.expires_at);
  if (fields.sent_at !== undefined) put("sent_at", fields.sent_at);
  if (fields.signed_at !== undefined) put("signed_at", fields.signed_at);
  if (fields.provisioned_at !== undefined) put("provisioned_at", fields.provisioned_at);
  if (fields.provisioned_user_id !== undefined)
    put("provisioned_user_id", fields.provisioned_user_id);

  if (!sets.length) return getOffer({ id });
  params.push(id);
  const { rows } = await q.query(
    `UPDATE shared.recruitment_offers SET ${sets.join(", ")}
      WHERE offer_id = $${params.length} RETURNING ${OFFER_COLS}`,
    params,
  );
  return rows[0] || null;
}

async function businessBranding({ brand }) {
  const { rows } = await query(
    `SELECT display_name, legal_name, accent_colour, secondary_colour,
            logo_path, logo_alt_path, brand_theme,
            address, phone, email, website,
            tin, cac_number, vat_number, mission_statement
       FROM shared.business_config WHERE business_key = $1`,
    [brand],
  );
  return rows[0] || null;
}

async function userIdByEmail({ email }) {
  const { rows } = await query(
    `SELECT user_id FROM shared.users WHERE email = $1 LIMIT 1`,
    [email],
  );
  return rows[0] ? rows[0].user_id : null;
}

/**
 * The candidate's captured e-signature for an offer's signature request, if any.
 * The candidate is the sole external signer, so we take the signed signer row.
 * Returns the raw signature artifact (inline data URL or stored media path) plus
 * the signing metadata; null when the request has no signed signer yet.
 */
async function getOfferSignature({ request_id }) {
  if (!request_id) return null;
  const { rows } = await query(
    `SELECT signature_data_url, captured_signature_path, signed_at,
            verification_code, display_name_snapshot
       FROM shared.signature_request_signers
      WHERE request_id = $1 AND status = 'signed'
      ORDER BY signed_at ASC NULLS LAST
      LIMIT 1`,
    [request_id],
  );
  return rows[0] || null;
}

module.exports = {
  transaction,
  // context
  getContext,
  listContext,
  upsertContext,
  // templates
  listTemplates,
  createTemplate,
  deleteTemplate,
  // openings + candidates
  createOpening,
  listOpenings,
  createCandidate,
  // offers
  createOffer,
  getOffer,
  getOfferByToken,
  listOffers,
  updateOffer,
  businessBranding,
  userIdByEmail,
  getOfferSignature,
};
