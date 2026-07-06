-- ============================================================
-- 000302_shared_splash_config
--
-- The boot/login splash (logo + app name) already reads product_name and
-- logo_dark_url/logo_light_url straight from shared.platform_settings.
-- The one thing it was missing a home for is the caption line shown
-- under the app name — this adds `login_config.splash.subline`,
-- editable from Settings → Login Editor (Appearance → Login screen).
--
-- Idempotent: only fills the key when absent, so a re-apply (or an
-- admin's later edit) never clobbers a saved value.
-- ============================================================

UPDATE shared.platform_settings
SET login_config = jsonb_set(
  login_config,
  '{splash}',
  jsonb_build_object('subline', 'Your command center'),
  true
)
WHERE login_config->'splash' IS NULL;
