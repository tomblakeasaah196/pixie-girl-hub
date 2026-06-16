-- ============================================================
-- MIGRATION 000214 — Smartcomm channel policy + Help Center
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Companion to 000213. Adds the COST DISCIPLINE layer so the
-- Hub never silently burns Meta credit on outbound automations
-- the CEO didn't sign off on:
--
--   1. `contacts.preferred_channel` — captured from inbound
--      webhooks (whichever channel they DMed from) and the
--      Online QR welcome form. Every outbound automation reads
--      this first when deciding where to send.
--
--   2. `outbound_channel_policy` — CEO-editable matrix mapping
--      every automation event (order_confirmation, shipped,
--      payment_overdue, etc.) to a channel preference. Defaults
--      ship reflecting the post-discussion strategy:
--        - everything transactional → email (free)
--        - delivery + payment-overdue → whatsapp (recovery-positive)
--        - marketing → instagram + email
--      The CEO can flip any row.
--
--   3. `help_categories` + `help_articles` — the DB-backed Help
--      Center the CEO + staff read. The article body is markdown.
--      Six seeded articles explain the messaging cost model in
--      plain language (the "why can't my staff initiate WhatsApp"
--      conversation the CEO might have with Praxis).
--
--   4. `ai_knowledge_chunks` seed — the same six help articles
--      are also seeded as RAG chunks (source_type='custom',
--      sensitivity='public') so Praxis can answer questions
--      grounded in them.
--
--   5. SMS hardening — `notification_preferences.sms_enabled`
--      default flipped to `false` and any existing rows set to
--      false. The SMS service file itself is deleted in this PR.
--
-- All additions are idempotent (IF NOT EXISTS / ON CONFLICT).
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. contacts.preferred_channel                                      ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.contacts
  ADD COLUMN IF NOT EXISTS preferred_channel  TEXT
    CHECK (preferred_channel IS NULL OR preferred_channel IN
           ('whatsapp','instagram','email','sms','none')),
  ADD COLUMN IF NOT EXISTS preferred_channel_set_at TIMESTAMPTZ;

COMMENT ON COLUMN shared.contacts.preferred_channel IS
  'Customer-stated preferred outbound channel. Read by every automation '
  'before falling back to the outbound_channel_policy default. ''none'' '
  '= do-not-contact (respect this for marketing; transactional may still '
  'go on email for receipts the customer needs).';

CREATE INDEX IF NOT EXISTS idx_contacts_preferred_channel
  ON shared.contacts (preferred_channel)
  WHERE preferred_channel IS NOT NULL;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. outbound_channel_policy                                         ║
-- ╚════════════════════════════════════════════════════════════════════╝
--
-- One row per (business, event_key). event_key is a stable string the
-- emitter passes when enqueueing an outbound notification, e.g.
--   'order_confirmation', 'order_shipped', 'order_delivered',
--   'payment_received', 'payment_reminder', 'layaway_reminder',
--   'invoice_issued', 'production_update', 'marketing_blast',
--   'campaign_launch', 'newsletter', 'welcome', 'birthday'
--
-- channel_preference values:
--   'email'                   — always email
--   'whatsapp'                — always whatsapp (cost-aware events only)
--   'instagram'               — IG only (works only if window is open)
--   'in_app_only'             — push + bell; no outbound channel
--   'respect_contact_pref'    — read contacts.preferred_channel first
--   'disabled'                — never send
--
-- `fallback_channel` is what the emitter falls back to when the primary
-- can't deliver (e.g., IG window expired → fallback to email).

CREATE TABLE IF NOT EXISTS shared.outbound_channel_policy (
  policy_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business             TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  event_key            TEXT        NOT NULL,
  channel_preference   TEXT        NOT NULL DEFAULT 'email'
                       CHECK (channel_preference IN
                              ('email','whatsapp','instagram','in_app_only',
                               'respect_contact_pref','disabled')),
  fallback_channel     TEXT
                       CHECK (fallback_channel IS NULL OR fallback_channel IN
                              ('email','whatsapp','instagram','in_app_only','disabled')),
  -- Free-text reason the CEO sets ("WhatsApp justified by recovery rate"),
  -- shown back in the policy editor so future-CEO knows why.
  rationale            TEXT,
  -- Per-event hard guardrail: if true, this event will *never* go
  -- WhatsApp regardless of contact preference. Useful as belt-and-braces
  -- around "marketing_blast" so a wrong contact pref can't unleash a
  -- WhatsApp marketing fee.
  block_whatsapp       BOOLEAN     NOT NULL DEFAULT false,
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  updated_by           UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, event_key)
);
CREATE INDEX IF NOT EXISTS idx_outbound_policy_business
  ON shared.outbound_channel_policy (business) WHERE is_active = true;
CREATE TRIGGER trg_outbound_policy_updated_at
  BEFORE UPDATE ON shared.outbound_channel_policy
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ── Seed the cost-discipline defaults for every active brand ─────
-- The CEO can edit any row from the Business Setup → Channel Policy
-- screen (PR 3 UI). These defaults reflect the agreed strategy:
--   • Receipts / invoices / order confirmations         → email
--   • Stage / production updates                        → in-app only
--   • Shipped / out-for-delivery                        → email + whatsapp fallback
--   • Delivery failed / payment overdue                 → whatsapp (recovery-positive)
--   • Marketing broadcasts                              → instagram (free) + email fallback
--                                                         (block_whatsapp = true)
--   • Welcome / birthday                                → email
--   • Customer-initiated DM reply                       → respect_contact_pref (auto by window)
INSERT INTO shared.outbound_channel_policy
  (business, event_key, channel_preference, fallback_channel, rationale, block_whatsapp)
SELECT bc.business_key, evt.event_key, evt.channel_preference, evt.fallback_channel,
       evt.rationale, evt.block_whatsapp
  FROM shared.business_config bc
  CROSS JOIN (VALUES
    ('order_confirmation',   'email',                 NULL,        'Transactional, customer expects a PDF receipt — email is free + reliable.',                                 false),
    ('order_paid_receipt',   'email',                 NULL,        'Same as above. Receipt belongs in their inbox.',                                                            false),
    ('invoice_issued',       'email',                 NULL,        'Needs the PDF attachment.',                                                                                 false),
    ('production_update',    'in_app_only',           NULL,        'Optional progress info; customer can check the storefront. Saves WhatsApp utility fees.',                  false),
    ('order_ready',          'email',                 NULL,        'Email + in-app banner is enough; not time-critical.',                                                       false),
    ('order_shipped',        'email',                 'whatsapp',  'Email primary; if customer has IG/WA window open we use that. WA only when window is open (free).',         false),
    ('out_for_delivery',     'whatsapp',              'email',     'Time-sensitive — driver may need contact. WhatsApp ₦11 is worth it.',                                       false),
    ('delivery_failed',      'whatsapp',              'email',     'Critical — recovery depends on reaching the customer fast.',                                                false),
    ('payment_reminder',     'whatsapp',              'email',     'Recovery rates 3-5x higher on WhatsApp vs email. ₦11 per send pays for itself many times over.',            false),
    ('layaway_reminder',     'whatsapp',              'email',     'Same as payment_reminder; the highest-leverage outbound automation we run.',                                false),
    ('marketing_blast',      'instagram',             'email',     'Marketing on Instagram + email only. WhatsApp marketing is blocked by hard guardrail (block_whatsapp).',    true),
    ('newsletter',           'email',                 NULL,        'Free, scales to thousands. Never WhatsApp.',                                                                true),
    ('campaign_launch',      'instagram',             'email',     'Same as marketing_blast.',                                                                                  true),
    ('welcome',              'email',                 NULL,        'Email captures their first impression as a record. Cheap, looks branded.',                                  false),
    ('birthday',             'email',                 NULL,        'Free birthday wishes; never burn WhatsApp credit on these.',                                                false),
    ('abandoned_cart',       'email',                 NULL,        'Email re-engagement; if conversion proves weak, CEO can switch to WhatsApp.',                               false),
    ('review_request',       'email',                 NULL,        'Post-delivery review nudge; not urgent, email is fine.',                                                    false),
    ('staff_invite',         'email',                 NULL,        'Internal — onboarding link, always email.',                                                                 false),
    ('stylist_assignment',   'whatsapp',              'email',     'Stylist needs to act quickly — worth a ₦11 ping.',                                                          false)
  ) AS evt(event_key, channel_preference, fallback_channel, rationale, block_whatsapp)
ON CONFLICT (business, event_key) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 3. Help Center — categories + articles                             ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.help_categories (
  category_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 TEXT        NOT NULL UNIQUE,
  name                 TEXT        NOT NULL,
  description          TEXT,
  icon                 TEXT,                                    -- lucide icon name (UI hint)
  sort_order           INTEGER     NOT NULL DEFAULT 0,
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_help_categories_updated_at
  BEFORE UPDATE ON shared.help_categories
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

CREATE TABLE IF NOT EXISTS shared.help_articles (
  article_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id          UUID        REFERENCES shared.help_categories (category_id) ON DELETE SET NULL,
  slug                 TEXT        NOT NULL UNIQUE,
  title                TEXT        NOT NULL,
  -- Short summary — used as tooltip & meta description.
  summary              TEXT,
  body_markdown        TEXT        NOT NULL,
  -- Who should see this article in the Help Center list.
  audience             TEXT        NOT NULL DEFAULT 'all'
                       CHECK (audience IN ('all','ceo','staff','stylist')),
  -- Module the article relates to — drives contextual-help deep links
  -- (e.g., the cost-info modal in Smartcomm links to articles where
  --  related_module = 'smartcomm').
  related_module       TEXT,
  -- Whether this article is mirrored to ai_knowledge_chunks for Praxis
  -- retrieval. Always true for the seeded set; CEO can flip to false
  -- on confidential / internal-only articles.
  praxis_indexed       BOOLEAN     NOT NULL DEFAULT true,
  tags                 TEXT[]      NOT NULL DEFAULT '{}',
  sort_order           INTEGER     NOT NULL DEFAULT 0,
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  view_count           INTEGER     NOT NULL DEFAULT 0,
  last_updated_by      UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_help_articles_category
  ON shared.help_articles (category_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_help_articles_module
  ON shared.help_articles (related_module) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_help_articles_audience
  ON shared.help_articles (audience) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_help_articles_tags
  ON shared.help_articles USING GIN (tags);
CREATE TRIGGER trg_help_articles_updated_at
  BEFORE UPDATE ON shared.help_articles
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- Seed categories
INSERT INTO shared.help_categories (slug, name, description, icon, sort_order) VALUES
  ('getting-started',  'Getting Started',         'First-day orientation and the shape of the Hub',         'Sparkles',       10),
  ('messaging',        'Messaging & Customer Care','How the unified inbox works, channels & costs',           'MessageSquare',  20),
  ('sales',            'Sales & Orders',           'Quick Sale, payment links, layaway, refunds',             'ShoppingCart',   30),
  ('catalogue',        'Catalogue & Services',     'Products, styled skins, service offerings',               'Package',        40),
  ('finance',          'Finance & Accounting',     'Money flow, gateways, reconciliation, reports',           'Wallet',         50),
  ('praxis',           'Praxis AI',                'How to ask Praxis for help and what she can do',          'Sparkles',       60),
  ('security',         'Security & Access',        'Who can see what, password & PIN, audit trail',           'ShieldCheck',    70)
ON CONFLICT (slug) DO NOTHING;

-- Seed the messaging articles. These are the cost-discipline explainers
-- the CEO + staff read, and the same body is mirrored to
-- ai_knowledge_chunks so Praxis can answer questions citing them.

INSERT INTO shared.help_articles (category_id, slug, title, summary, audience, related_module, body_markdown, sort_order, tags) VALUES
  ((SELECT category_id FROM shared.help_categories WHERE slug = 'messaging'),
   'how-our-messaging-works',
   'How our messaging really works (and why it''s cheaper than you think)',
   'A plain-English tour of the unified inbox: where DMs come from, who pays for what, and why customer-initiated chats cost us nothing.',
   'all',
   'smartcomm',
$$
# How our messaging really works

The Hub gives every business a **single inbox** that pulls Instagram DMs,
WhatsApp chats, email replies and your internal team chat into one
WhatsApp-Web-like screen.

## Three rules that govern everything

1. **A customer DMing us is always free.** Whether on Instagram or WhatsApp,
   when the customer messages us first, our replies for the next 24 hours
   are free and unlimited. No per-message charge, no monthly cap.

2. **Our system speaking first costs a little.** When the Hub sends an
   automatic update (like "your order shipped") to a customer who hasn't
   messaged us today, we pay a small per-message fee on WhatsApp (~₦11 for
   utility updates, ~₦88 for marketing). On Instagram and email, it's free.

3. **Channel choice is the cost lever.** Where we send a message matters
   more than what we send. The Hub is set up so transactional things
   (receipts, invoices, confirmations) go on email — free — and only the
   time-sensitive, recovery-positive moments (shipped, delivery failed,
   payment overdue) go on WhatsApp where the small fee pays for itself.

## Why the inbox feels like WhatsApp

We deliberately styled the inbox like a chat app rather than a ticket
system because that's how your customers think. You see one conversation
per customer, not three threads across three platforms. Pin the chats you
care about. Mute the ones you don't. Search across everything.

## Marketing lives outside the inbox

Marketing blasts (Black Friday discounts, new collection drops) **don't
go through the inbox by default**. They go through email newsletters and
Instagram posts — both free at any volume. WhatsApp marketing is blocked
by default precisely because at ₦88 per recipient a 500-customer blast
costs ₦44,000, and Instagram posts reach those same people for ₦0.

If you ever want a WhatsApp marketing blast to your VIP top-100, you can
turn it on for a single event from Business Setup → Channel Policy. The
guardrail prevents it from running by accident.
$$,
   10,
   ARRAY['messaging','cost','strategy']),

  ((SELECT category_id FROM shared.help_categories WHERE slug = 'messaging'),
   'why-cant-my-staff-start-a-whatsapp-chat',
   'Why can''t my staff start a WhatsApp chat with a customer?',
   'The Hub blocks system-initiated WhatsApp by default. Here''s exactly why, who can override it, and how the cost adds up if we don''t.',
   'ceo',
   'smartcomm',
$$
# Why can't my staff start a WhatsApp chat?

By default, your staff can **reply** to any inbound WhatsApp DM, but they
**cannot start a brand-new outbound WhatsApp conversation** with a
customer who hasn't messaged us recently. This is on purpose, not a bug.

## The reason in one line

When the customer starts a chat, every message is **free**. When we start
a chat, **every message** costs WhatsApp's per-message fee — even if it's
just one quick "hi". The block exists so a well-meaning rep can't cost
you ₦88,000 sending the same message to 1,000 customers from the inbox
in an afternoon.

## What "block" really means here

It's not a hard block — it's a **permission gate**. Three things are true:

1. The composer's "Send" button is hidden on threads where the WhatsApp
   24-hour window has expired. Free-form replies on closed windows aren't
   allowed by Meta anyway.
2. To send a WhatsApp template (the only way to open a new conversation
   from our side), a staff member needs the `can_send_template`
   permission. Default off for everyone except the CEO.
3. When the button is visible, it shows the live cost (e.g., "Send · ₦11")
   so whoever clicks it sees the price before pressing send.

## How you grant the permission

Go to **IAM & Security → Users → [their name] → Smartcomm Permissions**
and turn on **Can send WhatsApp template** per business. Some businesses
turn this on for their senior CS lead and one Pixie founder, and leave it
off for everyone else.

## What customers can still reach

- They can still **DM you** at any time — those replies stay free forever.
- They can still get receipts, invoices, tracking links and reminders —
  those go via email by default (free) and only escalate to WhatsApp for
  delivery-related events where reaching them fast matters.

## Numbers that make the trade-off real

If a rep sends a "hey, just checking in" WhatsApp template to 200
customers in an afternoon, that's 200 × ₦11 = **₦2,200** in WhatsApp
utility fees. If they accidentally categorise it as marketing, it's 200 ×
₦88 = **₦17,600** — for one afternoon. The permission gate stops this
class of mistake without preventing the rare, deliberate VIP reach-out.
$$,
   20,
   ARRAY['messaging','permissions','cost','whatsapp']),

  ((SELECT category_id FROM shared.help_categories WHERE slug = 'messaging'),
   'why-do-deliveries-go-by-whatsapp',
   'Why do delivery updates use WhatsApp but receipts use email?',
   'Different events have different return on investment. Here''s the matrix and the math.',
   'all',
   'smartcomm',
$$
# Why do delivery updates use WhatsApp but receipts use email?

Short answer: **a customer ignoring a tracking email costs us a support
chat asking "where's my order?". A customer ignoring a receipt email
costs us nothing.** So we pay for WhatsApp where ignoring it actually
hurts us, and stick with email where it doesn't.

## The full matrix (defaults, all editable)

| Event | Channel | Why |
|---|---|---|
| Order confirmed | Email | They just paid; they're not anxious. PDF receipt belongs in their inbox. |
| Payment received | Email | Same as above. |
| Invoice / Quotation | Email | Needs the attachment. |
| In production update | In-app only | Optional info; customer can check the storefront if curious. |
| Order ready | Email | Not time-critical. |
| Order **shipped** + tracking | Email primary; WhatsApp if their window is open | Stops the "where's my order?" inbound. |
| **Out for delivery** | **WhatsApp** | Driver may need to reach them; ₦11 well spent. |
| **Delivery failed** | **WhatsApp** | Recovery depends on speed. |
| Layaway / payment overdue | **WhatsApp** | Recovery rates are 3-5× higher on WhatsApp than email. ₦11 pays for itself many times over. |
| Marketing blast | Instagram + email | Both free. WhatsApp marketing is blocked by guardrail. |
| Welcome / birthday | Email | Free and warm. |

## What you can change

Every row above lives in **Business Setup → Channel Policy**. You can
flip any event to any channel without a developer. The CEO is in control
of every line of cost the Hub generates.

## What customers can override

If a customer says in the Online QR welcome form "I prefer email", the
Hub respects that — even for events the matrix says go WhatsApp. Their
voice always wins over our defaults.
$$,
   30,
   ARRAY['messaging','strategy','delivery','cost']),

  ((SELECT category_id FROM shared.help_categories WHERE slug = 'messaging'),
   'the-online-qr-welcome-form',
   'The "Online QR" welcome form: what it captures and why it matters',
   'A one-time link your team sends a new customer. Captures handle + address + preferences in 60 seconds.',
   'all',
   'smartcomm',
$$
# The Online QR welcome form

Every new customer who DMs us hits a bottleneck: we don't have their full
delivery address, their preferred channel, or their Instagram handle yet.
The old way to fix that was three back-and-forth messages. The Hub way
is one link.

## How it works

In any chat, tap **"Send Online QR"** in the composer. The Hub mints a
unique link — `pixiegirl.ng/welcome/{token}` — bound to the conversation.
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
$$,
   40,
   ARRAY['onboarding','contact','form','strategy']),

  ((SELECT category_id FROM shared.help_categories WHERE slug = 'messaging'),
   'the-24-hour-window',
   'The 24-hour window (what WhatsApp & Instagram call a "conversation")',
   'The single most important concept in messaging cost. A clock starts when the customer messages us — and resets every time they message again.',
   'all',
   'smartcomm',
$$
# The 24-hour window

Both WhatsApp and Instagram use the same idea: when a customer messages
you, a **24-hour clock starts**. For the next 24 hours, your team can
reply as much as you want, send as many photos and voice notes as you
want, **at no cost**.

## What happens when the clock runs out

After 24 hours of silence:

- **Free-form replies are not allowed.** Meta's API will reject them.
- The only way to message that customer again is via a pre-approved
  **template** (think SMS-style copy that you submitted to Meta in
  advance). Templates are charged per message:
  - **Utility templates** (order updates, tracking, payment reminders):
    ~₦11 each in Nigeria.
  - **Marketing templates** (promotions): ~₦88 each.
- If the customer messages us again later, a **fresh 24-hour window
  opens**, and we're back to unlimited free replies for 24 hours.

## The visual cue in the inbox

Every WhatsApp thread shows a small badge near the top of the
conversation:

- **🟢 Window open · 18h left** — free-form replies allowed for the next
  18 hours.
- **🟡 Window expires soon · 1h 12m** — last call for a free-form reply.
- **🔴 Window closed** — composer disables free text and shows the
  template picker instead (visible to staff with the right permission).

Instagram threads work the same way but the API allows a special
`HUMAN_AGENT` tag for genuine customer-service issue resolution outside
the window. The Hub uses it sparingly because Meta polices its use.

## Why this matters for your bill

Most of the cost concern in messaging boils down to one question: how
often do we initiate conversations versus reply to ones the customer
started? If 70% of our outbound is inside a window the customer just
opened, we pay near-zero. If we're constantly cold-pinging dormant
customers, we pay per message.

The Hub's automation matrix is built around this. Receipts go email (no
window concern). Tracking goes email primary, WhatsApp only if the
window is open. Payment reminders go WhatsApp because the recovery rate
makes the per-message fee worth it.
$$,
   50,
   ARRAY['messaging','window','cost','whatsapp','instagram']),

  ((SELECT category_id FROM shared.help_categories WHERE slug = 'messaging'),
   'what-marketing-channels-the-hub-uses',
   'Marketing: where the Hub sends broadcasts (and where it deliberately won''t)',
   'Email newsletters + Instagram posts are free at any scale. WhatsApp marketing is blocked unless you explicitly turn it on.',
   'ceo',
   'smartcomm',
$$
# Where the Hub sends marketing

The Hub's marketing pipeline ships with one principle: **never let
marketing run on a channel that charges per recipient unless you said
yes, recipient by recipient.**

## What runs free, by default

- **Email newsletter** — Cloudflare-routed inbound, free outbound via the
  SMTP you already have. Scales to thousands at zero per-message cost.
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
$$,
   60,
   ARRAY['marketing','cost','whatsapp','strategy'])
ON CONFLICT (slug) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 4. Mirror help articles into ai_knowledge_chunks for Praxis RAG    ║
-- ╚════════════════════════════════════════════════════════════════════╝
--
-- Same body, source_type='custom', sensitivity='public' so any user
-- (including the CEO talking to Praxis) can have their answers grounded
-- in these articles. The ai-embed worker picks new chunks up and embeds
-- them on its next sweep.

INSERT INTO shared.ai_knowledge_chunks
  (source_type, source_ref, business, title, content, token_count,
   sensitivity, content_hash, metadata)
SELECT
  'custom',
  'help_article:' || a.slug,
  NULL,                                              -- applies to all brands
  a.title,
  a.body_markdown,
  -- Rough token count: 1 token ≈ 4 characters. Refined post-embedding.
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
  -- Idempotent: skip if a chunk for this slug already exists.
  AND NOT EXISTS (
    SELECT 1 FROM shared.ai_knowledge_chunks k
     WHERE k.source_type = 'custom'
       AND k.source_ref  = 'help_article:' || a.slug
  );

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 5. SMS hardening                                                   ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Default the SMS toggle on notification_preferences off, and flip any
-- existing rows. The sms.service.js file is deleted in this PR; this
-- migration ensures no stored preference can re-enable it.

ALTER TABLE shared.notification_preferences
  ALTER COLUMN sms_enabled SET DEFAULT false;

UPDATE shared.notification_preferences
   SET sms_enabled = false
 WHERE sms_enabled = true;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 6. permission_module_keys — help_center                           ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.permission_module_keys (module_key, display_name, description, display_order) VALUES
  ('help_center',           'Help Center',                    'Guides, FAQs and contextual help',                         900),
  ('outbound_policy',       'Outbound Channel Policy',        'Per-event channel + cost guardrails for automations',      910)
ON CONFLICT (module_key) DO NOTHING;

-- Mirror to owner role full grants.
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT
  '11111111-1111-1111-1111-000000000001'::uuid,
  mk.module_key,
  a.action,
  'all'
FROM shared.permission_module_keys mk
CROSS JOIN (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export')) AS a(action)
WHERE mk.module_key IN ('help_center','outbound_policy')
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT COUNT(*) FROM shared.outbound_channel_policy;       -- 19 * brand_count
--   SELECT slug FROM shared.help_articles ORDER BY sort_order;  -- 6 messaging
--   SELECT source_ref FROM shared.ai_knowledge_chunks
--    WHERE source_type='custom' AND source_ref LIKE 'help_article:%';
-- ============================================================
