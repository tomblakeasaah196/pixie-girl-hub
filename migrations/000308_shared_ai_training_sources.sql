-- ============================================================
-- MIGRATION 000256 — Praxis training sources (uploaded media)
-- Pixie Girl Hub · JBS Praxis · V2.2 §8.5
-- ============================================================
--
-- Lets a trusted user upload files (docs, PDFs, images, any media) to TEACH
-- Praxis. Each upload is stored, its extractable text (+ the uploader's title
-- and notes) is chunked into shared.ai_knowledge_chunks and embedded, so it
-- becomes retrievable knowledge. This table is the "library" the UI lists and
-- can delete from; the actual learned content lives as knowledge chunks whose
-- source_ref is 'upload/<source_id>#<n>'.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.ai_training_sources (
  source_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business          TEXT,                        -- brand context, or NULL = global
  uploaded_by       UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  title             TEXT        NOT NULL,
  note              TEXT,                         -- optional context the uploader adds
  kind              TEXT        NOT NULL DEFAULT 'file'
                    CHECK (kind IN ('file', 'text')),
  original_filename TEXT,
  mime_type         TEXT,
  storage_key       TEXT,                         -- storage.service key (NULL for pure text)
  byte_size         BIGINT      NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'stored'
                    CHECK (status IN ('stored', 'embedded', 'failed')),
  chunk_count       INTEGER     NOT NULL DEFAULT 0,
  extract_chars     INTEGER     NOT NULL DEFAULT 0,  -- how much text we extracted
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_training_sources_business
  ON shared.ai_training_sources (business, created_at DESC);
