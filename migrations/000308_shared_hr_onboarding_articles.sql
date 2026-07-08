-- ============================================================
-- MIGRATION 000308 — Curated onboarding articles (HR & Staff → Onboarding)
--
-- Today the My HR "Getting started" card's SOP list is whatever Help Center
-- article happens to carry the 'onboarding' tag, brand-wide, with no admin
-- control over which articles show or in what order — articles tagged
-- 'onboarding' for unrelated reasons (e.g. a Stylists-module explainer) leak
-- onto every new hire's card. This lets HR curate an explicit, ordered list
-- per brand; hr_ops.repo.onboardingHelpArticles falls back to the old
-- tag-based query when the list is empty, so existing installs keep working.
-- Idempotent.
-- ============================================================

ALTER TABLE shared.hr_settings
  ADD COLUMN IF NOT EXISTS onboarding_help_article_ids UUID[] NOT NULL DEFAULT '{}';
