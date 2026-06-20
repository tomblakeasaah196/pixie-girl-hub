/**
 * Brand Voice — parameterised SQL.
 *
 * Per-brand singleton (one row per business in `shared.brand_voice_config`,
 * already shipped in PR 1 migration 000213). The row contains the tone,
 * signature, do/don'ts JSONB, FAQ markdown, a small set of few-shot
 * sample transcripts Praxis reads when drafting replies, plus two
 * CEO-controlled toggles: classify_inbound (paid AI feature, default
 * OFF) and draft_on_tap (UI shows the Praxis button, default ON).
 */

"use strict";

const { query } = require("../../config/database");

async function getByBrand({ brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.brand_voice_config WHERE business = $1`,
    [brand],
  );
  return rows[0] || null;
}

async function upsert({ brand, user_id, input }) {
  const { rows } = await query(
    `INSERT INTO shared.brand_voice_config
       (business, tone, voice_summary, signature_html, do_donts,
        faq_markdown, sample_transcripts, primary_emojis,
        classify_inbound, draft_on_tap, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,COALESCE($5,'{"do":[],"dont":[]}'::jsonb),
             $6,COALESCE($7,'[]'::jsonb),COALESCE($8,'{}'::text[]),
             COALESCE($9,false),COALESCE($10,true),$11,now())
     ON CONFLICT (business) DO UPDATE
       SET tone               = EXCLUDED.tone,
           voice_summary      = EXCLUDED.voice_summary,
           signature_html     = EXCLUDED.signature_html,
           do_donts           = EXCLUDED.do_donts,
           faq_markdown       = EXCLUDED.faq_markdown,
           sample_transcripts = EXCLUDED.sample_transcripts,
           primary_emojis     = EXCLUDED.primary_emojis,
           classify_inbound   = EXCLUDED.classify_inbound,
           draft_on_tap       = EXCLUDED.draft_on_tap,
           updated_by         = EXCLUDED.updated_by,
           updated_at         = now()
     RETURNING *`,
    [
      brand,
      input.tone || null,
      input.voice_summary || null,
      input.signature_html || null,
      input.do_donts ? JSON.stringify(input.do_donts) : null,
      input.faq_markdown || null,
      input.sample_transcripts
        ? JSON.stringify(input.sample_transcripts)
        : null,
      input.primary_emojis || null,
      input.classify_inbound,
      input.draft_on_tap,
      user_id || null,
    ],
  );
  return rows[0];
}

module.exports = { getByBrand, upsert };
