-- ============================================================
-- 000245_shared_storefront_snapshot_trigger_fix
-- Pixie Girl Hub · JBS Praxis
--
-- Fixes shared.fn_storefront_snapshot_on_publish (originally defined in
-- 000014_shared_triggers). The trigger is shared by storefront_themes,
-- storefront_pages and storefront_navigation. The original body selected
-- the entity id with:
--
--   CASE TG_TABLE_NAME
--     WHEN 'storefront_themes' THEN NEW.theme_id
--     WHEN 'storefront_pages'  THEN NEW.page_id
--     WHEN 'storefront_navigation' THEN NEW.nav_id
--   END
--
-- Postgres resolves every column reference in that CASE at plan time,
-- regardless of which branch executes. So when the trigger fires on
-- storefront_themes (which has no page_id / nav_id), it raises
-- "record \"new\" has no field \"page_id\"" — breaking every publish and
-- the storefront seed script.
--
-- Fix: snapshot NEW to JSONB once and read the id with null-safe JSON
-- field access (->>), which never errors on a missing key.
-- Idempotent: CREATE OR REPLACE only; triggers from 000014 are unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION shared.fn_storefront_snapshot_on_publish()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_entity_type TEXT;
  v_snapshot    JSONB;
  v_entity_id   UUID;
BEGIN
  IF NEW.status <> 'published' OR (OLD IS NOT NULL AND OLD.status = 'published') THEN
    RETURN NEW;
  END IF;

  v_snapshot := row_to_json(NEW)::jsonb;

  v_entity_type := CASE TG_TABLE_NAME
                     WHEN 'storefront_themes'     THEN 'theme'
                     WHEN 'storefront_pages'      THEN 'page'
                     WHEN 'storefront_navigation' THEN 'navigation'
                   END;

  v_entity_id := COALESCE(
                   v_snapshot ->> 'theme_id',
                   v_snapshot ->> 'page_id',
                   v_snapshot ->> 'nav_id'
                 )::uuid;

  INSERT INTO shared.storefront_revisions
    (business, entity_type, entity_id, snapshot, published_by, published_at)
  VALUES
    (NEW.business, v_entity_type, v_entity_id, v_snapshot,
     NEW.published_by, COALESCE(NEW.published_at, now()));

  RETURN NEW;
END;
$$;
