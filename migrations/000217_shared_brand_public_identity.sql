-- ============================================================
-- MIGRATION 000217 — Brand public identity (support email + URL
-- helpers) and a Help-article copy fix.
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- PR 4 — turns "the system assumes one storefront URL via env" into
-- "every brand has its own public face read from business_config".
--
-- What this adds:
--   1. business_config.support_email            — e.g. support@pixiegirlglobal.com
--   2. business_config.support_email_display_name — "From:" header text
--                                                  e.g. 'Pixie Girl Support'
--   3. Help-article body fix — removes hardcoded `pixiegirl.ng` examples
--      from migration 000214's seeds and re-mirrors to ai_knowledge_chunks
--      so Praxis stops quoting the wrong domain back to the CEO.
--
-- The actual per-brand public link helper lives in
-- `src/utils/brand-urls.js` and reads `business_config.storefront_domain`
-- (column already shipped in migration 000002). This migration just
-- adds the email companions and patches the copy.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. business_config — support email columns                         ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.business_config
  ADD COLUMN IF NOT EXISTS support_email              TEXT,
  ADD COLUMN IF NOT EXISTS support_email_display_name TEXT;

COMMENT ON COLUMN shared.business_config.support_email IS
  'Public customer-care mailbox for this brand (e.g. support@pixiegirlglobal.com). '
  'Used as the From: address on receipts/invoices, the Reply-To on automated '
  'outbound mail, and the inbound mailbox the email webhook handler matches against.';
COMMENT ON COLUMN shared.business_config.support_email_display_name IS
  'Friendly From: header (e.g. "Pixie Girl Support"). When NULL, falls back to display_name.';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. Help article body fix (PR 2's 000214 seeded `pixiegirl.ng` —    ║
-- ║    no brand actually has that domain).                             ║
-- ╚════════════════════════════════════════════════════════════════════╝
--
-- We rewrite the article body to use generic placeholders that Praxis
-- can quote without misleading the CEO. The article slug stays the same;
-- only the `body_markdown` + `updated_at` move. The companion
-- `ai_knowledge_chunks` row is then re-seeded so Praxis's RAG corpus
-- reflects the corrected text on its next embedding sweep.

UPDATE shared.help_articles
   SET body_markdown = $body$
# The Online QR welcome form

Every new customer who DMs us hits a bottleneck: we don't have their full
delivery address, their preferred channel, or their Instagram handle yet.
The old way to fix that was three back-and-forth messages. The Hub way
is one link.

## How it works

In any chat, tap **"Send Online QR"** in the composer. The Hub mints a
unique link on this brand's storefront domain — e.g.
`{your-storefront-domain}/welcome/{token}` — bound to the conversation.
Send it. The customer taps it, fills the form on their phone (60 seconds,
mobile-first), submits.

The Hub does five things in one moment:

1. Creates or updates their contact record.
2. Records their Instagram handle, WhatsApp number, email and preferred
   channel.
3. Saves their delivery address with the Google Maps pin (latitude /
   longitude — so the rider's app navigates straight there).
4. Marks their birthday (auto-enrols them in birthday automations).
5. Drops a green "✅ form completed" line back into the chat so the
   staffer sees it instantly.

## Why this changes the unit economics

Once the form is filled, **every subsequent message routes itself**. Our
automation reads `preferred_channel` and sends the receipt, the tracking
link, the layaway reminder via whichever channel they picked. We never
guess wrong, and we never burn WhatsApp credit on a customer who'd have
been just as happy with email.

It also means delivery success goes up because the rider has lat/lng
instead of a fuzzy address, and you stop losing orders to "the rider
couldn't find me".

## Where the QR codes live

Two QR codes hang off the same form:

- **Walk-in QR** — print and stick on the salon counter. Customer scans
  in store.
- **Online QR** — the link our staff send in DMs (described above).

Both routes land in the same form and create / update the same contact
record. The only difference is the `source` tag on the contact (`walkin`
vs `online`).

## Configuration the CEO controls

The storefront domain used in these links lives on each brand in
**Settings → Business Setup** (the `storefront_domain` field). Change it
there and every future link uses the new value — no code deploy.
$body$,
       updated_at = now()
 WHERE slug = 'the-online-qr-welcome-form';

-- Same hygiene for the messaging cost-model article that referenced
-- specific Cloudflare email examples.
UPDATE shared.help_articles
   SET body_markdown = $body$
# Where the Hub sends marketing

The Hub's marketing pipeline ships with one principle: **never let
marketing run on a channel that charges per recipient unless you said
yes, recipient by recipient.**

## What runs free, by default

- **Email newsletter** — Cloudflare-routed inbound (set your support
  mailbox in **Settings → Business Setup → Support email**), free
  outbound via the SMTP you already have. Scales to thousands at zero
  per-message cost.
- **Instagram posts + reels** — published from the Social Media module.
  Reach is organic.
- **Instagram DMs** (only inside the 24-hour window) — when a customer
  has DMed you today, you can include them in a personalised broadcast
  for free. Outside the window, no go.

## What's blocked by default

- **WhatsApp marketing blasts.** The default policy on `marketing_blast`,
  `newsletter` and `campaign_launch` events has `block_whatsapp = true`.
  Even if a contact's preference is "WhatsApp", marketing automations
  will refuse to use it. This is a hard guardrail — the kind a typo
  shouldn't be able to bypass.

## What you can enable explicitly

If you decide a Christmas promo is worth ₦88 per VIP, do it deliberately:

1. **Business Setup → Channel Policy → marketing_blast** — set
   `block_whatsapp` to false and `channel_preference` to "whatsapp" for
   one campaign.
2. Build a tight segment (top-100, not the whole list).
3. Submit the campaign. Hub shows you the projected cost before launch.
4. After it runs, set `block_whatsapp` back to true.

The 4-click discipline is intentional: the next intern can't ship a
₦200,000 mistake.

## Where ad spend lives

Paid Instagram + Facebook ads run through Meta Ads Manager (the Hub's
Social Media module syncs spend daily). That's a different cost lever
entirely — measured in CPM and CPC, not per-message. Use ads for
acquisition; use the inbox for retention.
$body$,
       updated_at = now()
 WHERE slug = 'what-marketing-channels-the-hub-uses';

-- Re-mirror the corrected article bodies to the RAG corpus.
-- DELETE + INSERT keeps the embedding hash + chunk_id stable per slug
-- and the ai-embed worker picks the rewritten content up on its next
-- sweep.
DELETE FROM shared.ai_embeddings
 WHERE source_table = 'ai_knowledge_chunks'
   AND source_id IN (
     SELECT chunk_id FROM shared.ai_knowledge_chunks
      WHERE source_type = 'custom'
        AND source_ref IN (
          'help_article:the-online-qr-welcome-form',
          'help_article:what-marketing-channels-the-hub-uses'
        )
   );
DELETE FROM shared.ai_knowledge_chunks
 WHERE source_type = 'custom'
   AND source_ref IN (
     'help_article:the-online-qr-welcome-form',
     'help_article:what-marketing-channels-the-hub-uses'
   );
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
WHERE a.slug IN (
        'the-online-qr-welcome-form',
        'what-marketing-channels-the-hub-uses'
      )
  AND a.praxis_indexed = true
  AND a.is_active     = true;

-- ============================================================
-- Verify
--   SELECT support_email FROM shared.business_config;
--   SELECT body_markdown FROM shared.help_articles
--    WHERE slug = 'the-online-qr-welcome-form';
-- ============================================================
