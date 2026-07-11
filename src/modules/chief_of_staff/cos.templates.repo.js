/**
 * Chief of Staff (PR5) — playbook templates repository.
 *
 * shared.goal_templates: a saved goal shape (milestones + tasks as day-offsets)
 * the CEO can re-instantiate with fresh dates. Scoped to the CEO's brands +
 * globals (business IS NULL). Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

/** Templates visible to a CEO: their brands' own playbooks + globals, most-used first. */
async function listTemplates({ businesses }) {
  const { rows } = await query(
    `SELECT t.*, g.title AS source_goal_title
       FROM shared.goal_templates t
       LEFT JOIN shared.goals g ON g.goal_id = t.source_goal_id
      WHERE t.business IS NULL OR t.business = ANY($1::text[])
      ORDER BY t.usage_count DESC, t.created_at DESC`,
    [businesses || []],
  );
  return rows;
}

/** One template, scoped to the CEO's brands + globals (else null). */
async function findTemplate({ template_id, businesses }) {
  const { rows } = await query(
    `SELECT * FROM shared.goal_templates
      WHERE template_id = $1 AND (business IS NULL OR business = ANY($2::text[]))`,
    [template_id, businesses || []],
  );
  return rows[0] || null;
}

async function createTemplate({ t }) {
  const { rows } = await query(
    `INSERT INTO shared.goal_templates
       (business, name, description, structure, source_goal_id, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     RETURNING *`,
    [
      t.business || null,
      t.name,
      t.description || null,
      JSON.stringify(t.structure || {}),
      t.source_goal_id || null,
      t.created_by || null,
    ],
  );
  return rows[0];
}

async function incrementUsage({ template_id }) {
  const { rows } = await query(
    `UPDATE shared.goal_templates
        SET usage_count = usage_count + 1, updated_at = now()
      WHERE template_id = $1
      RETURNING usage_count`,
    [template_id],
  );
  return rows[0] ? rows[0].usage_count : null;
}

module.exports = { listTemplates, findTemplate, createTemplate, incrementUsage };
