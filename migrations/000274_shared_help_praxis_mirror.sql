-- ============================================================
-- MIGRATION 000274 — Help Center: mirror all help articles into
--                     ai_knowledge_chunks for Praxis RAG
-- Pixie Girl Hub · V2.2 §6.30 (Help Center) · §6.31 (Praxis grounding)
--
-- WHY THIS EXISTS
-- The mirror block in 000214 was generic (it copies every praxis_indexed
-- help article into shared.ai_knowledge_chunks), but it only ran once —
-- so it captured the articles that existed at that point. Help content
-- added by later migrations (attendance 000235, insights 000258, and the
-- Run+Operate module sets 000262–000273) was never mirrored, meaning
-- Praxis could NOT ground answers on it despite praxis_indexed = true.
--
-- This migration re-runs the same generic, idempotent sweep so EVERY
-- active, praxis_indexed help article has a corresponding knowledge chunk.
-- The NOT EXISTS guard makes it a no-op for anything already mirrored, so
-- it is safe to run now and safe to keep as the "catch-up" step future
-- help migrations rely on (each new article is picked up here on deploy).
--
-- Same shape as 000214 §4: source_type='custom', sensitivity='public',
-- source_ref='help_article:<slug>'. The ai-embed worker embeds new chunks
-- on its next sweep.
--
-- Idempotent: NOT EXISTS guard. Re-runs are no-ops.
-- ============================================================

INSERT INTO shared.ai_knowledge_chunks
  (source_type, source_ref, business, title, content, token_count,
   sensitivity, content_hash, metadata)
SELECT
  'custom',
  'help_article:' || a.slug,
  NULL,                                              -- applies to all brands
  a.title,
  a.body_markdown,
  -- Rough token count: 1 token ≈ 4 characters. Refined post-embedding.
  GREATEST(1, LENGTH(a.body_markdown) / 4),
  'public',
  md5(a.body_markdown),
  jsonb_build_object(
    'article_id', a.article_id,
    'slug',       a.slug,
    'audience',   a.audience,
    'related_module', a.related_module,
    'tags',       a.tags
  )
FROM shared.help_articles a
WHERE a.praxis_indexed = true
  AND a.is_active     = true
  -- Idempotent: skip if a chunk for this slug already exists.
  AND NOT EXISTS (
    SELECT 1 FROM shared.ai_knowledge_chunks k
     WHERE k.source_type = 'custom'
       AND k.source_ref  = 'help_article:' || a.slug
  );

-- ============================================================
-- Verify
--   -- Every active praxis_indexed article should have a chunk:
--   SELECT a.slug
--     FROM shared.help_articles a
--    WHERE a.praxis_indexed AND a.is_active
--      AND NOT EXISTS (
--        SELECT 1 FROM shared.ai_knowledge_chunks k
--         WHERE k.source_type='custom'
--           AND k.source_ref='help_article:'||a.slug
--      );  -- expected: 0 rows
-- ============================================================
