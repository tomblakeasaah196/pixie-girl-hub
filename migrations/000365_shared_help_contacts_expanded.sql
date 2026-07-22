-- ============================================================
-- MIGRATION 000365 — Help Center content: Contacts & Directory (full rewrite)
-- Pixie Girl Hub · V2.2 §6.12 (Contacts) · §6.30 (Help Center) · §6.31 (Praxis)
--
-- Replaces the thin 4-article Contacts set (seeded in 000284) with a detailed,
-- accurate set that covers EVERY part of the module as it actually ships:
--   • the directory screen — stakeholder tabs, search/filter/views, KPIs
--   • the stakeholder model (Clients · Employees · Suppliers · Subscribers ·
--     Stylist Partners · Ambassadors) and how each is created
--   • every way to add a contact (Quick Add, full form, onboarding, QR, import)
--   • bulk import/export (the guided pick-type → template → preview → confirm
--     engine) and the owner-only export
--   • the 360° profile — summary strip + the full type-aware tab set
--   • timeline & logging activity, addresses, tags & segments, milestones
--   • how Contacts links to CRM / Sales / Invoicing / HR / Procurement
--   • visibility & permissions (contact-type scope, cross-business directory)
--
-- Grounded in src/shared/contacts + apps/admin/src/pages/contacts + router.tsx.
-- shared.contacts is GLOBAL (one record shared by both businesses); tags,
-- segments and commercial stats (LTV, orders, churn, priority) are per-business.
--
-- Idempotent: upserts on (slug) so re-running refreshes content in place, and
-- the Praxis RAG mirror for these articles is rebuilt at the end so the AI never
-- serves stale copies.
-- ============================================================

-- Ensure the category exists (also seeded by 000284) and is current.
INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('contacts', 'Contacts & Directory',
   'The one shared directory of everyone the businesses deal with — clients, employees, suppliers, subscribers, stylist partners and ambassadors — with a 360° profile, tags, segments, milestones and bulk import/export.',
   'Contact', 64)
ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  updated_at  = now();

-- ── 1. Overview (sort 10) ────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-overview',
  'Contacts: the one directory the whole Hub shares',
  'Everyone the businesses deal with lives here once — clients, employees, suppliers, subscribers, partners — and every other module reads the same record.',
  $md$
## What Contacts is

**Contacts** (sidebar **People → Contacts**, or `/contacts`) is the **single
directory** of every person and organisation the businesses deal with. The rule
is *one record per person*: Sales, CRM, Invoicing, Purchasing, HR, Messaging,
Retention and Marketing all read the **same** contact, so nothing is re-typed and
no two modules disagree about someone's phone number.

## Everyone is here, by role

A contact carries one or more **types** (called *stakeholders*):

- **Clients** (customers you sell to)
- **Employees** (your staff — onboarded through HR)
- **Suppliers** (vendors you buy from)
- **Subscribers** (newsletter sign-ups)
- **Stylist Partners** (the stylist programme, PXG)
- **Ambassadors** (an *overlay* — a client or fan who promotes you)

One record can hold **several** types at once — a client who also supplies you is
a single contact tagged both, not two records.

## What a contact holds

- core details (name, phone, WhatsApp, email, socials, addresses),
- **tags** and **segments** for grouping and targeting,
- a **360° profile** with a **timeline** of every interaction,
- a **summary** (lifetime value, orders, last activity, churn risk),
- and live links to their orders, invoices, deals, loyalty and more.

## One directory, two businesses

The directory is **shared across both businesses** (Pixie Girl Global and Faitlyn
Hair) — a customer who buys from both is one record. What is **per-business** is
the commercial picture on top: **tags, segments, priority tier and the stats**
(lifetime value, orders, churn) are calculated for the business you're currently
in. Switch the business at the top-left and those numbers change; the person does
not.

## Why one directory matters

Change a customer's number **once** and it's correct in Sales, Messaging and
Invoicing at the same time. Duplicate or siloed contacts are how businesses text
the wrong number and lose history — the shared directory is the fix.
$md$,
  'all', 'contacts',
  ARRAY['contacts','directory','overview','shared','stakeholders'], 10
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id    = EXCLUDED.category_id,
  title          = EXCLUDED.title,
  summary        = EXCLUDED.summary,
  body_markdown  = EXCLUDED.body_markdown,
  audience       = EXCLUDED.audience,
  related_module = EXCLUDED.related_module,
  tags           = EXCLUDED.tags,
  sort_order     = EXCLUDED.sort_order,
  praxis_indexed = true,
  is_active      = true,
  updated_at     = now();

-- ── 2. Directory screen & navigation (sort 20) ───────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-directory-navigation',
  'Finding your way around the directory',
  'The stakeholder tabs, search, priority filter, list/cards views, the KPI strip, and how to open a contact.',
  $md$
## The tab bar — one tab per stakeholder

Across the top of `/contacts` is a row of tabs. Each one filters the directory to
a single stakeholder type:

- **All** — everyone.
- **Clients** · **Employees** · **Suppliers** · **Subscribers** — filtered by
  contact type.
- **Stylist Partners** and **Ambassadors** — these read from their own programme
  lists (the stylist programme and the ambassador overlay), not the plain
  contacts table, so they show programme-specific columns.

Opening a tab is the fastest way to work one audience at a time.

## Search, filter and views

- **Search** matches name, phone, email and company — type any of them.
- **Priority** filters to **VIP / Regular / New**.
- The **list / cards toggle** (top-left, under the title) switches between a
  dense table and visual cards. Your choice is remembered next time.
- Results are **paged** (25 at a time) — use the pager at the bottom.

## The KPI strip

Two quick metrics sit above the list: **Total** (how many of this stakeholder
you have) and **New this month**. They update with the active tab and the
business you're in.

## Opening a contact

Click any row (or card) to open that person's full **360° profile** at
`/contacts/<id>`. VIP clients show a small star beside their name; type badges
show every role a contact plays.

## Adding & sharing

- The round **+ (Power Plus)** button top-right is *every way to add a contact*
  in one place — see **Adding contacts**.
- The **QR** button beside it reveals two self-onboarding codes (Walk-in and
  Online) a customer can scan to add themselves — see **Adding contacts**.
$md$,
  'all', 'contacts',
  ARRAY['contacts','directory','navigation','tabs','search','filter','view'], 20
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 3. Stakeholder types (sort 25) ───────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-stakeholder-types',
  'Clients, employees, suppliers, subscribers, partners & ambassadors',
  'What each stakeholder type means, how each is created, and why one contact can be several types at once.',
  $md$
## The stakeholder model

Contacts serves several *kinds* of person from one directory. Each has its own
tab, its own profile tabs, and its own way of being created.

| Type | Who they are | How to create |
|---|---|---|
| **Client** | Someone you sell to | Quick Add or the full form |
| **Employee** | Your staff member | **Onboarding wizard** (`/contacts/staff/new`) — sets role, schedule & pay in HR |
| **Supplier** | A vendor you buy from | Quick Add or the full form |
| **Subscriber** | A newsletter sign-up | Quick Add, the full form, or the Online QR |
| **Stylist Partner** | A stylist in the programme (PXG) | Set up through the **Stylist** programme |
| **Ambassador** | A client/fan who promotes you | **Promote** an existing client from their profile |

## One person can be several types

Contact type is a **list**, not a single value. A client who starts supplying you
is the **same record** carrying both *Client* and *Supplier* — their history stays
in one place. When you bulk-import someone who is already on file, the Hub adds
the new type to the existing record instead of creating a duplicate.

## Ambassadors are an overlay

*Ambassador* isn't a separate record — it's a badge on top of any contact (the
`is_ambassador` flag). Promote a client to ambassador from their profile to start
tracking their commission and attribution; they keep their client tabs **and**
gain the Ambassador tab.

## Employees are special

Employees are created through the **full onboarding wizard**, not Quick Add,
because an employee needs an HR profile (role, work schedule, salary, staff
login) — not just a directory entry. Their employment details live in **HR**; the
contact record is the shared identity the rest of the Hub uses.
$md$,
  'all', 'contacts',
  ARRAY['contacts','types','clients','suppliers','employees','subscribers','stylists','ambassadors'], 25
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 4. Adding contacts (sort 30) ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-adding-contacts',
  'Every way to add a contact',
  'Quick Add, the full guided form, employee onboarding, walk-in and online QR self-signup, and bulk import — and when to use each.',
  $md$
## The + (Power Plus) button

The round **+** button (top-right of `/contacts`) gathers every way to add a
contact into one sheet. What it offers adapts to the tab you're on.

## Quick Add — fast capture

**Quick Add** takes just **name, phone and source** — perfect for capturing
someone at the counter or on a call in a couple of seconds. You can always open
their profile later and fill in the rest. (Not available for employees.)

## The full form — every field

The **full guided form** captures everything: names, company, gender, birthday,
phone/WhatsApp/email, social handles, country, priority, source, business
identifiers (TIN/CAC for suppliers), and notes. It opens **pre-typed** to the tab
you're on — open it from the **Clients** tab and it starts as a client. Fields
adjust to the type (clients get socials & birthday; suppliers get TIN/CAC).

## Onboard an employee

On the **Employees** tab, **+** opens the **onboarding wizard**
(`/contacts/staff/new`) — it creates the contact **and** the HR profile (role,
work schedule, salary) and can send the staff login. Use this, not Quick Add, for
team members.

## QR self-onboarding

The **QR** button reveals two codes customers scan to add **themselves** — no
typing for you:

- **Walk-in QR** — show it at the counter; the customer fills a short form.
- **Online QR** — share it in a bio or post for online sign-ups.

## Bulk import

To load many people at once (an existing customer list, a supplier sheet), use
**Import** in the add sheet's **Data tools** — see **Bulk import & export**.

## Which should I use?

- One person, in a hurry → **Quick Add**.
- One person, full detail → **full form**.
- A team member → **employee onboarding**.
- Let customers add themselves → **QR**.
- Hundreds at once → **bulk import**.
$md$,
  'all', 'contacts',
  ARRAY['contacts','add','quick-add','onboarding','qr','walk-in','create'], 30
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 5. Bulk import & export (sort 35) ────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-bulk-import-export',
  'Bulk import & export (clients, suppliers, partners, subscribers)',
  'Pick a record type, download its template, preview every row, then confirm — plus the owner-only CSV export.',
  $md$
## Importing in bulk

Open **Import** from the **+** add sheet (**Data tools**). It's a guided flow, the
same shape as the Catalogue's product import:

1. **Pick the record type** — **Clients**, **Suppliers**, **Retail partners**,
   **Stylists** or **Subscribers**. Each has its **own** columns.
2. **Download that type's template** — a CSV with the right headers and one sample
   row. Fill it in Excel or any spreadsheet app.
3. **Upload** the filled `.csv` or `.xlsx`. The Hub reads it **in your browser**
   and shows a **preview** of every row, marking each **Ready** or **to fix** —
   nothing is saved yet.
4. **Confirm** to create them. You get a per-row summary: how many were created,
   how many were already on file, and any errors.

## What the import does for you

- **No duplicates.** A row whose **phone or email** already exists is **skipped**,
  and the type is added to the existing person instead of making a second record.
- **Names are matched loosely**, so small header spelling differences are fine.
- Every contact needs a **name** and at least a **phone or email**.
- Up to **5,000 rows** per file — split larger lists.
- Fill in **Address Line 1** (and city/area) to also save a default delivery
  address in the same import.

## Employees are not bulk-imported

Employees onboard through HR (role, schedule, pay, login), so they're not one of
the import types. Add them via the employee onboarding wizard
(`/contacts/staff/new`).

## Exporting (owner only)

**Export** (in the same Data tools) is **restricted to the owner / CEO**. Pick the
records (clients, suppliers, or both) and a date range, and it downloads a **CSV**
you can open in Excel. Everyone else won't see the button, and the server blocks
it too.

## Templates on their own

Just want the layout? Use **Template** to download any type's CSV without starting
an import.
$md$,
  'all', 'contacts',
  ARRAY['contacts','import','export','csv','excel','bulk','template','preview'], 35
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 6. The 360° profile & its tabs (sort 40) ─────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-profile-and-timeline',
  'The 360° contact profile and its tabs',
  'The header actions, the summary strip, and the full type-aware tab set — Overview, Activity, Deals, Preferences, Crowns, Employment and more.',
  $md$
## Opening a profile

Click any contact to open their profile at `/contacts/<id>`. The header shows
their avatar, **priority** and **type** badges (and an Ambassador badge if they
are one), plus three actions:

- **Message** — pick a channel (WhatsApp / Instagram / Email) and it opens the
  conversation in **Messaging** to reply and send from there.
- **Call** — dials the number on your device.
- **Edit** — opens the full form to change any field.

## The summary strip

Just under the header, four tiles give the commercial picture at a glance:
**Lifetime value**, **Orders**, **Last activity**, and **Churn risk**. These are
calculated for the **business you're in**.

## The tabs adapt to who they are

The tab row changes with the contact's type(s):

**Everyone gets:**
- **Overview** — all their details, plus their **tags** and **notes**.
- **Activity** — the timeline of interactions (see *Timeline & activities*).
- **Tasks** — to-dos linked to this contact (add with a due date, tick off).
- **Calendar** — events scheduled with them.
- **Addresses & tags** — delivery/billing addresses (see *Addresses*).
- **Notes** — a free internal note field.
- **Documents** — upload/download files attached to the contact.
- **Audit** — every change made to the record, and by whom.

**Clients also get:**
- **Deals** — their CRM opportunities and stages.
- **Invoices** — invoices issued to them (links into Invoicing).
- **Concierge** — a VIP-care panel: tier, churn risk, lifetime value, loyalty
  points, birthday and hair preferences, with a one-tap WhatsApp.
- **Preferences** — their hair preferences (textures, colours, lengths, lace) and
  head **measurements**.
- **Crowns** — their loyalty standing (points/tier in the unified loyalty
  programme).

**By type:**
- **Employment** (employees) — a summary that deep-links into **HR** for role,
  schedule, attendance, salary and documents.
- **Purchasing** (suppliers) — deep-links into **Procurement** for POs and bills.
- **Subscription** (subscribers) — newsletter status, with a link to Email
  campaigns.
- **Programme** (stylist partners) — their programme status, certifications,
  payouts and assignments.
- **Ambassador** (ambassadors) — commission and attribution.

If a tab isn't relevant to a contact, it simply isn't shown.
$md$,
  'all', 'contacts',
  ARRAY['contacts','profile','tabs','360','deals','preferences','loyalty','crowns','concierge'], 40
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 7. Timeline & activities (sort 50) ───────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-timeline-activities',
  'The timeline and logging activities',
  'The running history of every interaction, split into Commercial, Engagement and Internal — and how to log a call or visit.',
  $md$
## The timeline

The **Activity** tab on a profile is the running history of everything that has
happened with that person, newest first. It's split into three views:

- **Commercial** — orders, payments and deals.
- **Engagement** — messages, calls, visits and other outreach.
- **Internal** — tags, system notes and record changes.

Most of it fills in **automatically** as the person orders, is messaged, or moves
through a deal — so anyone opening the contact sees the whole story instead of
starting cold.

## Log an activity

On the **Engagement** view, use **Log** to record something that happened
off-system — a phone call, a walk-in visit, a note about a conversation. Capture
the type, an outcome, and any detail. Logged activities join the timeline and
count toward **Last activity** in the summary strip.

## Why it matters

The timeline is what makes the directory a memory, not just a phone book. A
teammate who has never spoken to a customer can pick up exactly where the last
person left off.
$md$,
  'all', 'contacts',
  ARRAY['contacts','timeline','activity','log','history','engagement'], 50
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 8. Addresses (sort 55) ───────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-addresses',
  'Addresses on a contact',
  'Keep delivery and billing addresses on file so Logistics can deliver and Invoicing can bill without re-typing.',
  $md$
## Where addresses live

Open a contact and go to **Addresses & tags**. You can save as many addresses as
you like and add a new one with **Add Address**.

## What each address holds

- a **type** — delivery, billing, office, home or other,
- the street lines, area, city, state and country,
- an optional **landmark** and **Google Maps** link / coordinates (a mini map
  preview shows when coordinates are set),
- a **Default** flag (the one used first for delivery), and a **Verified** mark.

## Why it matters downstream

- **Logistics** quotes and books delivery to the customer's address.
- **Invoicing** bills to the billing address.

Getting the address right **once** here saves errors on every future order — no
one re-types it, and a verified default is what automations reach for.
$md$,
  'all', 'contacts',
  ARRAY['contacts','addresses','delivery','billing','logistics','map'], 55
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 9. Tags & segments (sort 60) ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-tags-segments-import',
  'Tags and segments',
  'Group people with colour-coded tags (managed and merged in Settings), and build reusable segments for targeting in Marketing and Retention.',
  $md$
## Tags — quick, free-form labels

**Tags** are labels you stick on contacts (VIP, wholesale, lapsed, "owes
balance"). Add and remove them from a contact's **Overview** tab, each with its
own colour. Tags are the fast way to group people without a rigid structure, and
they're **per business**.

### Managing tags in one place

Go to **Settings → Contact Tags** (`/settings/contact-tags`) to manage every tag
at once: **rename**, **recolour**, **delete**, and — most useful — **merge** two
tags into one. Merging is how you tidy accidental duplicates ("VIP" and "vip")
without losing the contacts on either.

## Segments — reusable audiences

A **segment** is a defined group of contacts (for example, "clients who bought in
the last 90 days"). Unlike a tag you stick on by hand, a segment is a saved
audience you build once and **reuse** — chiefly in **Marketing** and
**Retention** to target campaigns and journeys. Segments are per business.

## Tag or segment — which?

- Use a **tag** to *describe* a contact ("wholesale", "fragile-scalp").
- Use a **segment** to *target* a group you'll message again and again.

## Keep it clean

Because every module reads this directory, messy tags and duplicate contacts
spread everywhere. Merging tags, de-duplicating, and consistent segments are small
habits that keep Sales, Messaging and Marketing accurate.
$md$,
  'all', 'contacts',
  ARRAY['contacts','tags','segments','merge','settings','marketing','retention'], 60
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 10. Milestones (sort 70) ─────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-milestones',
  'Milestones — birthdays & anniversaries',
  'See who has a birthday or anniversary coming up, filter and reach them on WhatsApp, and feed Retention outreach.',
  $md$
## What Milestones shows

**Milestones** (Contacts → **Milestones**, or `/contacts/milestones`) lists the
meaningful dates coming up across your directory — **birthdays**, **wedding
anniversaries** and **business anniversaries** — so you never miss a chance to
reach out.

## Using it

- Choose the **window** (e.g. the next 7 or 30 days).
- **Filter** to everyone, just birthdays, or just VIPs.
- Milestones are grouped by month, and each shows how soon it is ("Today! 🎉",
  "Tomorrow", "In 5 days").
- Tap **WhatsApp** on a person to reach them straight away.

## Where the dates come from

Birthdays come from a contact's **Date of Birth** — set it on the full form or
via **Edit**. If you only know the day and month (not the year), that's fine; the
Hub shows the day and month and still reminds you. These same dates are the hooks
**Retention** and **Marketing** use to time automatic outreach.
$md$,
  'all', 'contacts',
  ARRAY['contacts','milestones','birthday','anniversary','retention','reminders'], 70
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 11. How Contacts links to the rest of the Hub (sort 80)
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-connected-modules',
  'How Contacts connects to Sales, CRM, HR and more',
  'The directory is the hub every module points at — deals, invoices, orders, purchasing, employment and loyalty all hang off the contact.',
  $md$
## One record, many modules

A contact is the anchor the rest of the Hub attaches to. From a profile you can
jump straight to the module that owns each part of the relationship:

- **CRM** — a client's **Deals** move through pipeline stages; the **Concierge**
  and **Preferences** tabs feed VIP care. Open the CRM module at `/crm`.
- **Sales & Invoicing** — orders and **Invoices** issued to a client show on the
  profile and link into Sales/Invoicing.
- **HR** — an **employee's** role, schedule, attendance and pay live in HR; the
  Employment tab links there.
- **Procurement** — a **supplier's** purchase orders and bills live in
  Purchasing; the Purchasing tab links there.
- **Retention & Loyalty** — the **Crowns** tab shows loyalty standing; segments
  and milestones drive win-back and reward journeys.
- **Messaging** — **Message** on the profile opens the conversation on WhatsApp,
  Instagram or Email.

## Preferences & measurements (clients)

For clients, the **Preferences** tab captures the hair details that make service
personal — preferred textures, colours, lengths and lace — plus **head
measurements** for custom units. Stylists and sales staff read these so a
returning client doesn't have to explain themselves twice.

## The takeaway

You rarely *finish* a job inside Contacts — you start it here (the identity and
history) and the specialised module (Sales, CRM, HR, Procurement) does the work,
all pointing at the same person.
$md$,
  'all', 'contacts',
  ARRAY['contacts','crm','sales','invoicing','hr','procurement','loyalty','preferences'], 80
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 12. Visibility & permissions (sort 90) ───────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-visibility-permissions',
  'Who can see and do what in Contacts',
  'The contacts permission, limiting a role to certain contact types, owner-only export, and how the directory is shared across both businesses.',
  $md$
## The contacts permission

Seeing and using Contacts is gated by the **contacts** permission, with the usual
actions: **view, create, edit, delete** and **export**. If Contacts isn't in your
sidebar, your role doesn't include it — an admin grants it in **Org & Workflow**
or **IAM & Security**.

## Limiting a role to certain types

A role can be restricted to specific **contact types** — for example,
supplier-facing staff can be given **suppliers only**, hiding the client book.
Set this per role under **Org & Workflow → (role) → Contact visibility**. It
applies everywhere: the directory, search, profiles and even bulk import all
respect it, so a role can't import a type it isn't allowed to see.

## Record scope

Beyond type, a role's **record scope** can be **all**, **team** or **own** — that
decides whether someone sees every contact, only their team's, or only the ones
assigned to them.

## Export is owner-only

The bulk **Export** to CSV is restricted to the **owner / CEO**. Everyone else
won't see the button, and the server enforces it too.

## Shared across both businesses

The directory itself is **global** — one contact record is shared by Pixie Girl
Global and Faitlyn Hair, so a customer who buys from both is a single person. What
is **per-business** is the layer on top: **tags, segments, priority and the
stats** (lifetime value, orders, churn) reflect the business you're currently in.
A contact can also be limited to specific businesses when needed.
$md$,
  'all', 'contacts',
  ARRAY['contacts','permissions','visibility','rbac','export','scope','entity'], 90
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ── 13. FAQ (sort 200) ───────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-faq',
  'Contacts FAQ',
  'One record vs many, duplicates, tags vs segments, importing a list, who the directory includes, and the cross-business question.',
  $md$
## "Do clients, employees and suppliers all live here?"

Yes — Contacts is the **one directory** for everyone. A person is a single record
whatever roles they play (client, supplier, employee, subscriber, stylist
partner), and each module reads the parts it needs.

## "Is my customer list shared between the two businesses?"

The **directory is shared** — a customer who buys from both Pixie Girl Global and
Faitlyn Hair is one record. But the **tags, segments, priority and stats** you see
are for the **business you're currently in**. Switch it at the top-left to see the
other side.

## "I think there are duplicate contacts."

Search before adding, and use **Settings → Contact Tags → Merge** to fold
duplicate tags. When you **bulk import**, a row whose phone or email already
exists is skipped (the type is added to the existing person), so imports don't
create duplicates.

## "Tag or segment — what's the difference?"

A **tag** is a simple label you stick on a contact. A **segment** is a defined
group you reuse for targeting in Marketing/Retention. Tags **describe**; segments
**target**.

## "How do I bring in my existing list?"

Use **Import** (in the **+** add sheet → Data tools): pick the record type,
download its template, fill it in, upload to preview, then confirm. See **Bulk
import & export**.

## "How do I add an employee?"

Employees go through the **onboarding wizard** (`/contacts/staff/new`), not Quick
Add — it sets up their HR profile (role, schedule, pay) as well as the contact.

## "Why can't I export?"

Export is **owner/CEO only**. If you need a copy, ask the owner to run it.

## "If I edit a contact here, does it change everywhere?"

Yes — that's the point of a shared directory. Update once and Sales, Messaging,
Invoicing and the rest all see the corrected record.
$md$,
  'all', 'contacts',
  ARRAY['contacts','faq','duplicates','tags','segments','import','export','businesses'], 200
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO UPDATE SET
  category_id = EXCLUDED.category_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown, audience = EXCLUDED.audience,
  related_module = EXCLUDED.related_module, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order,
  praxis_indexed = true, is_active = true, updated_at = now();

-- ============================================================
-- Refresh the Praxis RAG mirror for Contacts so the AI never serves stale copies.
-- The generic mirror (000287/000299) only inserts articles it hasn't seen; an
-- UPDATE to an existing slug would leave the old chunk behind. Rebuild just the
-- Contacts chunks from the current article bodies.
-- ============================================================
DELETE FROM shared.ai_knowledge_chunks k
USING shared.help_articles a
WHERE k.source_type = 'custom'
  AND k.source_ref  = 'help_article:' || a.slug
  AND a.related_module = 'contacts';

INSERT INTO shared.ai_knowledge_chunks
  (source_type, source_ref, business, title, content, token_count,
   sensitivity, content_hash, metadata)
SELECT
  'custom',
  'help_article:' || a.slug,
  NULL,                                              -- applies to all brands
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
WHERE a.related_module = 'contacts'
  AND a.praxis_indexed = true
  AND a.is_active     = true;

-- ============================================================
-- Verify
--   SELECT slug, sort_order FROM shared.help_articles
--    WHERE related_module = 'contacts' ORDER BY sort_order;  -- expected: 13 rows
--   SELECT count(*) FROM shared.ai_knowledge_chunks
--    WHERE source_ref LIKE 'help_article:contacts%';         -- expected: 13
-- ============================================================
