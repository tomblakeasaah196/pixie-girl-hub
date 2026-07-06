-- ============================================================
-- MIGRATION 000287 — Help Center: mirror PR2 help articles into
--                     ai_knowledge_chunks for Praxis RAG
-- Pixie Girl Hub · V2.2 §6.30 (Help Center) · §6.31 (Praxis grounding)
--
-- The mirror is generic (copies every praxis_indexed help article into
-- shared.ai_knowledge_chunks), but the migration runner applies each file
-- exactly once — so the earlier sweep in 000274 only captured articles
-- that existed at that point. This file re-runs the same idempotent sweep
-- so the PR2 Finance + People sets (000275–000286) are grounded for Praxis.
--
-- Same shape as 000214 §4 / 000274. NOT EXISTS guard makes it a no-op for
-- anything already mirrored.
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
  AND NOT EXISTS (
    SELECT 1 FROM shared.ai_knowledge_chunks k
     WHERE k.source_type = 'custom'
       AND k.source_ref  = 'help_article:' || a.slug
  );

-- ============================================================
-- Verify
--   SELECT a.slug FROM shared.help_articles a
--    WHERE a.praxis_indexed AND a.is_active
--      AND NOT EXISTS (SELECT 1 FROM shared.ai_knowledge_chunks k
--        WHERE k.source_type='custom'
--          AND k.source_ref='help_article:'||a.slug);  -- expected: 0 rows
-- ============================================================
