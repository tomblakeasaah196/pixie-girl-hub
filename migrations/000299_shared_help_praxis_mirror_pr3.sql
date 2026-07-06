-- ============================================================
-- MIGRATION 000299 — Help Center: mirror PR3 help articles into
--                     ai_knowledge_chunks for Praxis RAG
-- Pixie Girl Hub · V2.2 §6.30 (Help Center) · §6.31 (Praxis grounding)
--
-- Re-runs the generic, idempotent mirror (see 000274 / 000287) so the PR3
-- Grow + System sets (000288–000298) are grounded for Praxis. The runner
-- applies each file once, so a fresh sweep is needed per batch.
--
-- NOTE: once the in-app Help Editor ships in this PR, new/edited articles
-- are synced to ai_knowledge_chunks live on save — this migration only
-- covers the seed content added by 000288–000298.
--
-- NOT EXISTS guard makes it a no-op for anything already mirrored.
-- ============================================================

INSERT INTO shared.ai_knowledge_chunks
  (source_type, source_ref, business, title, content, token_count,
   sensitivity, content_hash, metadata)
SELECT
  'custom',
  'help_article:' || a.slug,
  NULL,
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
-- Verify: 0 rows =
--   SELECT a.slug FROM shared.help_articles a
--    WHERE a.praxis_indexed AND a.is_active
--      AND NOT EXISTS (SELECT 1 FROM shared.ai_knowledge_chunks k
--        WHERE k.source_type='custom' AND k.source_ref='help_article:'||a.slug);
-- ============================================================
