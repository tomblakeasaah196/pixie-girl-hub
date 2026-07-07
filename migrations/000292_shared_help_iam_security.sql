-- ============================================================
-- MIGRATION 000292 — Help Center content: IAM & Security
-- Pixie Girl Hub · V2.2 §6.26 (IAM) · §6.30 (Help Center)  [PR3]
--
-- Populates the existing (previously-empty) 'security' category with the
-- full IAM & Security set: overview, users & access, the audit log &
-- security events, sessions & MFA, access reviews, and a FAQ.
--
-- Grounded in src/shared/iam + apps/admin/src/pages/Iam*: tabs Dashboard /
-- Users & Access / Audit Log / Security Events / Sessions & Devices /
-- Access Reviews / MFA-TOTP; stats, user provisioning, sessions,
-- my-sessions, audit, reviews, TOTP setup/status.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

-- The 'security' category already exists (000214). Upsert is a safe no-op.
INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('security', 'Security & Access',
   'Who can sign in and see what — users, sessions, MFA, the audit log and access reviews.',
   'ShieldCheck', 70)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'iam-overview',
  'What IAM & Security covers',
  'The security control centre: who has access, what they did, where they''re signed in, and periodic reviews to keep it all tight.',
  $md$
## What it is

**IAM & Security** (sidebar → **IAM & Security**, or `/iam-security`) is the
security control centre — who can get in, what they can do, what they've done, and
the health of it all.

## The tabs

- **Dashboard** — security health cards and a live security-events feed.
- **Users & Access** — provision staff and external users, invite, deactivate,
  admin-reset a password.
- **Audit Log** — the append-only record of every state-changing action (with
  filter and CSV/Excel export).
- **Security Events** — a filtered lens on the audit log for security-relevant
  events.
- **Sessions & Devices** — active sign-ins, with admin and self-service revoke.
- **Access Reviews** — periodic attestation: approve, revoke or flag access.
- **MFA / TOTP** — self-service two-factor enrolment.

## How it relates to roles

IAM manages **identities and sessions**; **Org & Workflow** manages **roles and
permissions** (what those identities may do). Roles here deep-link across to Org &
Workflow. Together they answer "who is this, and what are they allowed to do?"
$md$,
  'ceo', 'iam_security',
  ARRAY['iam','security','overview','access'], 10
FROM shared.help_categories c WHERE c.slug = 'security'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Users & access ────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'iam-users-and-access',
  'Managing users and access',
  'Provision staff and external users, invite them, reset a password, and deactivate access the moment someone leaves.',
  $md$
## Provisioning users

On **Users & Access** you add **staff** and **external** users, assign their
role, and **invite** them (they set their own credentials). Access is a role plus
an identity — the role decides what they can do (see Org & Workflow).

## The security actions

- **Invite** — bring someone in with a secure signup link.
- **Admin reset** — reset a user's password if they're locked out.
- **Deactivate** — cut off access immediately when someone leaves or a threat
  appears. This is the single most important security action — do it the moment
  it's needed.

## Why offboarding matters

A leaver with live access is a standing risk. Deactivating here revokes their
ability to sign in, and **Sessions & Devices** lets you kill any session they
still have open — so access ends when the relationship does.
$md$,
  'ceo', 'iam_security',
  ARRAY['iam','users','invite','deactivate','reset'], 20
FROM shared.help_categories c WHERE c.slug = 'security'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Audit log & security events ───────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'iam-audit-and-events',
  'The audit log and security events',
  'Every state-changing action is recorded, append-only, filterable and exportable — the record that makes the whole Hub accountable.',
  $md$
## The audit log

The **Audit Log** records **every state-changing action** in the Hub — who did
what, when, to which record, with before/after where relevant. It's
**append-only**: entries can't be edited or deleted, which is exactly what makes
it trustworthy as a record.

You can **filter** it (by user, module, action, date) and **export** to CSV/Excel
for review or compliance.

## Security events

**Security Events** is a filtered view of the log for security-relevant activity —
sign-ins, permission changes, deactivations, resets. It's where you look when you
need to answer "did anything suspicious happen?"

## Why it matters everywhere

Throughout the Hub you'll read "this is audited" — an approval, a stock
adjustment, a price change. This is where those trails land. The audit log is what
turns "we have controls" into "and here's the proof they were followed."
$md$,
  'ceo', 'iam_security',
  ARRAY['iam','audit','security-events','append-only','export'], 30
FROM shared.help_categories c WHERE c.slug = 'security'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Sessions, MFA & access reviews ────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'iam-sessions-mfa-reviews',
  'Sessions, two-factor and access reviews',
  'See and revoke sign-ins, turn on two-factor for yourself, and run periodic reviews so access never quietly sprawls.',
  $md$
## Sessions & devices

**Sessions & Devices** shows where accounts are signed in. You can **revoke** a
session — an admin can kill anyone's, and you can end your own from anywhere
(useful if you lost a device). Revoking forces a fresh sign-in.

## MFA / TOTP

**MFA / TOTP** lets you enrol **two-factor authentication** for yourself — an
authenticator code on top of your password. It's the single biggest upgrade to
your account's security; turn it on.

## Access reviews

**Access Reviews** are periodic attestations: someone reviews who has what access
and **approves**, **revokes** or **flags** each one, with an export for the
record. It's the discipline that stops permissions **sprawling** — access granted
for a one-off and never removed. Praxis Insights flags a review **open past its
due date** so the review itself doesn't get forgotten.
$md$,
  'ceo', 'iam_security',
  ARRAY['iam','sessions','mfa','totp','access-reviews'], 40
FROM shared.help_categories c WHERE c.slug = 'security'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'iam-faq',
  'IAM & Security FAQ',
  'IAM vs Org & Workflow, offboarding, lost device, editing the audit log, and why access reviews matter.',
  $md$
## "IAM or Org & Workflow — where do I manage access?"

**IAM** manages **identities, sessions and security** (who they are, sign-ins,
MFA, audit). **Org & Workflow** manages **roles and permissions** (what they may
do). You set the role there, the person here.

## "Someone left — what do I do?"

**Deactivate** them in Users & Access and **revoke** any open sessions in Sessions
& Devices. That ends their access immediately, everywhere.

## "I lost my phone / laptop."

Sign in elsewhere and **revoke** the session on that device from **Sessions &
Devices** (or ask an admin). Change your password and, if you had MFA, re-enrol.

## "Can the audit log be edited to hide something?"

No — it's **append-only** by design. Entries can't be changed or deleted, which is
what makes it a real record rather than an editable list.

## "Why bother with access reviews?"

Because access **sprawls** — granted for a reason, then forgotten. Periodic
reviews catch that, and Praxis flags a review left **overdue** so the check itself
doesn't lapse.
$md$,
  'ceo', 'iam_security',
  ARRAY['iam','faq','offboarding','sessions','audit','reviews'], 50
FROM shared.help_categories c WHERE c.slug = 'security'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles WHERE related_module='iam_security';
-- expected: 5 rows
-- ============================================================
