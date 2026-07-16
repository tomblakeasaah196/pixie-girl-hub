-- ============================================================
-- MIGRATION — Faitlyn Hair domain move: thefaitlynbrand.com → faitlynhair.com
--
-- The brand's public domain and mailboxes moved to faitlynhair.com and
-- the old thefaitlynbrand.com DNS was retired. Any stored row still
-- carrying the old domain now misbehaves: outbound mail bounces
-- ("450 4.1.8 Sender address rejected: Domain not found" — the exact
-- error the Messaging inbox surfaced), and public links point at a dead
-- host. This rewrites every stored occurrence of the old domain.
--
-- Everything touched here is UI-editable afterwards (Messaging →
-- Settings, Settings → Business Setup → Public Identity, Landing
-- Studio), so a future domain change needs no code — this is a one-time
-- data repair, not a new hardcoding.
--
-- Idempotent: replace() is a no-op once nothing matches, and every
-- UPDATE is guarded by a LIKE filter.
-- ============================================================

-- ── 1. Brand identity (Settings → Business Setup → Public Identity) ──
-- email_from_address is getSender()'s business-config fallback; website /
-- storefront_domain / sales_subdomain drive every public link + the
-- host → brand resolver.
UPDATE shared.business_config
SET email_from_address = replace(email_from_address, 'thefaitlynbrand.com', 'faitlynhair.com'),
    support_email      = replace(support_email,      'thefaitlynbrand.com', 'faitlynhair.com'),
    website            = replace(website,            'thefaitlynbrand.com', 'faitlynhair.com'),
    storefront_domain  = replace(storefront_domain,  'thefaitlynbrand.com', 'faitlynhair.com'),
    sales_subdomain    = replace(sales_subdomain,    'thefaitlynbrand.com', 'faitlynhair.com')
WHERE business_key = 'faitlynhair'
  AND concat_ws(' ', email_from_address, support_email, website,
                storefront_domain, sales_subdomain) LIKE '%thefaitlynbrand.com%';

-- ── 2. Messaging connections (Messaging → Settings) ──────────────────
-- from_email on the email_outbound row is the FIRST thing
-- email.service.getSender() stamps on outbound mail — the row the 450
-- bounce traced back to. smtp_user is only rewritten when it still
-- carries the old domain (that mailbox login is dead either way; the
-- operator may need to re-enter the password for the new mailbox).
UPDATE shared.messaging_accounts
SET from_email     = replace(from_email,     'thefaitlynbrand.com', 'faitlynhair.com'),
    reply_to_email = replace(reply_to_email, 'thefaitlynbrand.com', 'faitlynhair.com'),
    smtp_user      = replace(smtp_user,      'thefaitlynbrand.com', 'faitlynhair.com')
WHERE business = 'faitlynhair'
  AND concat_ws(' ', from_email, reply_to_email, smtp_user) LIKE '%thefaitlynbrand.com%';

-- The inbound mailbox identity (row identity — UNIQUE (platform,
-- external_account_id)). Guarded so we never collide with a row the
-- operator already re-created under the new domain; a skipped old row
-- is left as-is for manual cleanup in Messaging → Settings.
UPDATE shared.messaging_accounts m
SET external_account_id = replace(m.external_account_id, 'thefaitlynbrand.com', 'faitlynhair.com')
WHERE m.business = 'faitlynhair'
  AND m.external_account_id LIKE '%thefaitlynbrand.com%'
  AND NOT EXISTS (
    SELECT 1 FROM shared.messaging_accounts other
     WHERE other.platform = m.platform
       AND other.external_account_id =
           replace(m.external_account_id, 'thefaitlynbrand.com', 'faitlynhair.com')
  );

-- ── 3. WhatsApp template URL buttons (seeded by 000314) ──────────────
UPDATE shared.whatsapp_templates
SET components = replace(components::text, 'thefaitlynbrand.com', 'faitlynhair.com')::jsonb
WHERE business = 'faitlynhair'
  AND components::text LIKE '%thefaitlynbrand.com%';

-- ── 4. Landing Studio configs (seeded by 000225, edited in the Studio) ─
UPDATE shared.landing_pages
SET draft_config     = replace(draft_config::text,     'thefaitlynbrand.com', 'faitlynhair.com')::jsonb,
    published_config = replace(published_config::text, 'thefaitlynbrand.com', 'faitlynhair.com')::jsonb
WHERE business_key = 'faitlynhair'
  AND (draft_config::text LIKE '%thefaitlynbrand.com%'
       OR published_config::text LIKE '%thefaitlynbrand.com%');

-- ── 5. Help Centre copy + its RAG mirror (seeded by 000222) ──────────
UPDATE shared.help_articles
SET summary       = replace(summary,       'thefaitlynbrand.com', 'faitlynhair.com'),
    body_markdown = replace(body_markdown, 'thefaitlynbrand.com', 'faitlynhair.com')
WHERE summary LIKE '%thefaitlynbrand.com%'
   OR body_markdown LIKE '%thefaitlynbrand.com%';

-- content_hash tracks the content so the next `npm run ai:reindex`
-- (runs on every deploy) re-embeds the changed chunks.
UPDATE shared.ai_knowledge_chunks
SET content      = replace(content, 'thefaitlynbrand.com', 'faitlynhair.com'),
    content_hash = md5(replace(content, 'thefaitlynbrand.com', 'faitlynhair.com'))
WHERE content LIKE '%thefaitlynbrand.com%';

-- ── 6. Brand-schema email sender fields ──────────────────────────────
-- Campaign/template rows can pin their own from/reply-to. Guarded with
-- to_regclass because shared migrations run BEFORE brand bootstrap on a
-- fresh install (the schema won't exist yet — and a fresh install never
-- contains the old domain anyway).
DO $$
BEGIN
  IF to_regclass('faitlynhair.email_templates') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE faitlynhair.email_templates
      SET from_email     = replace(from_email,     'thefaitlynbrand.com', 'faitlynhair.com'),
          reply_to_email = replace(reply_to_email, 'thefaitlynbrand.com', 'faitlynhair.com')
      WHERE concat_ws(' ', from_email, reply_to_email) LIKE '%thefaitlynbrand.com%'
    $q$;
  END IF;
  IF to_regclass('faitlynhair.email_campaigns') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE faitlynhair.email_campaigns
      SET from_email     = replace(from_email,     'thefaitlynbrand.com', 'faitlynhair.com'),
          reply_to_email = replace(reply_to_email, 'thefaitlynbrand.com', 'faitlynhair.com')
      WHERE concat_ws(' ', from_email, reply_to_email) LIKE '%thefaitlynbrand.com%'
    $q$;
  END IF;
END $$;
