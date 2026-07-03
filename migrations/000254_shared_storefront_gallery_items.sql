-- ============================================================
-- 000254_shared_storefront_gallery_items
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- The home "Tagged on Instagram" gallery originally stored a photo-only slot
-- (slots.gallery.images = ["/maison/a.jpg", ...]). The storefront now supports a
-- clickable, credited tile shape (slots.gallery.items = [{ image, instagram_link,
-- handle }, ...]) — but the Storefront Studio editor only shows the per-tile
-- "Instagram link" field once the slot actually carries that item shape.
--
-- This migration reshapes existing home galleries in place: every photo is
-- preserved and wrapped into an item with empty instagram_link/handle for the
-- operator to fill in. It runs across BOTH brands (shared table keyed by
-- business) and every status (draft/published/archived).
--
-- Idempotent + non-destructive: only rows whose gallery still has an `images`
-- array and no `items` key are touched; re-running is a no-op.
-- ============================================================

UPDATE shared.storefront_pages p
SET slots = jsonb_set(
      p.slots #- '{gallery,images}',
      '{gallery,items}',
      COALESCE(
        (
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'image', img,
                     'instagram_link', '',
                     'handle', ''
                   )
                 )
          FROM jsonb_array_elements_text(p.slots -> 'gallery' -> 'images') AS img
        ),
        '[]'::jsonb
      )
    )
WHERE p.page_key = 'home'
  AND jsonb_typeof(p.slots -> 'gallery' -> 'images') = 'array'
  AND NOT (p.slots -> 'gallery' ? 'items');
