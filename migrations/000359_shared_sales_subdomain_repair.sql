-- ============================================================
-- 000359_shared_sales_subdomain_repair
-- Pixie Girl Hub · Sales Campaigns — repair the public sale host so
-- campaign links stop 404-ing.
--
-- WHY. Public sale pages are served by the Next.js landing app on the brand's
-- dedicated SALES SUBDOMAIN (e.g. sales.faitlynhair.com), which owns the
-- `/sale/:slug` routes. The share link + "View live" URL is built from
-- business_config.sales_subdomain, falling back to storefront_domain. When
-- sales_subdomain is NULL/blank, or was left equal to the bare apex
-- (storefront_domain), the link resolves to the APEX host —
-- e.g. https://faitlynhair.com/sale/black-friday-sale — which the storefront
-- app does NOT route, so the buyer gets a 404. The subdomain
-- (https://sales.faitlynhair.com/sale/black-friday-sale) works.
--
-- The domain-rename repair (000347) rewrote sales_subdomain by string-replace,
-- so any row that never carried a `sales.` prefix (or was blank) survived as
-- the apex. This repair pins it to `sales.<apex>` for every active brand whose
-- sales_subdomain is missing or equal to the apex — the exact "fell back to the
-- apex → 404" case. A brand that already has a proper distinct subdomain is
-- left untouched.
--
-- Idempotent + safe: only fires when sales_subdomain is blank or apex-equal;
-- once set to `sales.<apex>` it no longer matches, so re-runs are no-ops.
-- storefront_domain is normalised (scheme + trailing slash + leading www.
-- stripped) before the `sales.` prefix so we never produce
-- `sales.https://...` or `sales.www...`. Brands are UI-editable afterwards
-- (Settings → Business Setup → Public Identity). The runner wraps each file in
-- its own BEGIN/COMMIT, so this does NOT self-wrap.
-- ============================================================

UPDATE shared.business_config
   SET sales_subdomain =
         'sales.' || regexp_replace(
                       regexp_replace(lower(btrim(storefront_domain)), '^https?://', ''),
                       '^www\.', ''
                     )
 WHERE is_active = true
   AND storefront_domain IS NOT NULL
   AND btrim(storefront_domain) <> ''
   AND (
         sales_subdomain IS NULL
         OR btrim(sales_subdomain) = ''
         OR lower(regexp_replace(btrim(sales_subdomain),  '^https?://|/+$', '', 'g'))
          = lower(regexp_replace(btrim(storefront_domain), '^https?://|/+$', '', 'g'))
       );

-- Verify:
--   SELECT business_key, storefront_domain, sales_subdomain
--     FROM shared.business_config WHERE is_active = true;
