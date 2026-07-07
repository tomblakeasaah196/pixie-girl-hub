-- ============================================================
-- MIGRATION 000293 — Help Center content: Documents & Signatures
-- Pixie Girl Hub · V2.2 §6.22 (Documents) · §6.30 (Help Center)  [PR3]
--
-- Grounded in src/shared/documents + apps/admin/src/pages/documents:
-- documents list/download, doc types (document/invoice/receipt/contract/
-- agreement/image/export/id_document), record links, e-sign (signer PIN,
-- public /sign/:token page).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('documents', 'Documents & Signatures',
   'The filing cabinet — store, organise, link and download documents, and get contracts e-signed.',
   'FolderArchive', 73)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'documents-overview',
  'What Documents does',
  'One filing cabinet for everything — invoices, contracts, IDs, exports — each linked to the record it belongs to and searchable.',
  $md$
## What it is

**Documents** (sidebar → **Documents**, or `/documents`) is the Hub's filing
cabinet. Instead of files scattered across chats and drives, everything lives here
— typed, linked to the record it belongs to, and searchable.

## Document types

Files are classified so you can find them: **document**, **invoice**, **receipt**,
**contract**, **agreement**, **image / media**, **export**, **ID document** and
**other**. Filter by type to jump straight to what you need.

## Linked to records

A document can be **attached to a record** — a contact, a deal, an order, an
employee. That's what makes it more than storage: the contract sits *on* the
stylist, the ID *on* the staff member, the agreement *on* the partner. Open the
record and its documents are right there.

## Where it connects

Modules that produce documents (invoices from Invoicing, contracts from HR and
the Stylist Programme, exports from anywhere) file them here, so the filing cabinet
fills itself as you work.
$md$,
  'all', 'documents',
  ARRAY['documents','filing','overview','types'], 10
FROM shared.help_categories c WHERE c.slug = 'documents'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Storing & retrieving ──────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'documents-storing-and-retrieving',
  'Storing, finding and downloading documents',
  'Upload a file, type it, link it to the right record, then filter and download whenever you need it.',
  $md$
## Storing

Upload a file, give it a **type**, and (optionally) **link it to a record**. Good
typing and linking at upload time is what makes retrieval instant later — a few
seconds now saves a hunt in three months.

## Finding

Filter by **type** and by the **record** it's attached to. Because everything is
classified and linked, you find the contract for a specific partner or the ID for
a specific staff member without scrolling through a pile.

## Downloading

**Download** any document you have permission to see. Permissions apply — sensitive
documents (IDs, contracts) follow the same access rules as the rest of the Hub, so
storing them here is safer than a shared drive, not riskier.
$md$,
  'all', 'documents',
  ARRAY['documents','upload','filter','download','link'], 20
FROM shared.help_categories c WHERE c.slug = 'documents'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. E-signatures ──────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'documents-esign',
  'Getting a document e-signed',
  'Send a contract for signature and the signer opens a secure link, confirms with a PIN, and signs — no printing or scanning.',
  $md$
## E-sign

For contracts and agreements, the Hub can get a document **e-signed** rather than
printed, signed and scanned. You send it for signature and the signer receives a
secure link.

## The signer experience

The signer opens a **public signer page** (a tokenised `/sign` link — no account
needed) and confirms their identity with a **PIN** before signing. The PIN on the
signature means it's the intended person, not just whoever opened the link.

## Why it's here

Contracts flow from **HR** (employment) and the **Stylist Programme** (partner
agreements). Signing them in the Hub keeps the signed copy filed against the right
record automatically — the agreement and the person it binds stay together.

## Note

E-sign is capability-flagged and depends on the signing backend being enabled for
your deployment; where it's on, it's the fastest way to close a contract.
$md$,
  'ceo', 'documents',
  ARRAY['documents','esign','signature','contract','pin'], 30
FROM shared.help_categories c WHERE c.slug = 'documents'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'documents-faq',
  'Documents FAQ',
  'Why file here vs a drive, linking to records, who can see a document, and e-sign availability.',
  $md$
## "Why file here instead of a shared drive?"

Because documents here are **typed, linked to records and permission-controlled**.
A contract sits on the partner it binds; an ID is only visible to those allowed to
see it. A shared drive gives you none of that.

## "How do I attach a document to a customer or order?"

**Link it to the record** at upload (or later). It then shows on that record, so
the file and the thing it's about stay together.

## "Who can see a sensitive document?"

Permissions apply — IDs and contracts follow the Hub's access rules, so storing
them here is controlled, not open. If you can't see one, that's your permission
scope.

## "Can I get a contract signed without printing it?"

Yes, where **e-sign** is enabled — send it, the signer opens a secure link and
signs with a PIN, and the signed copy is filed automatically. Availability depends
on your deployment's signing backend.
$md$,
  'all', 'documents',
  ARRAY['documents','faq','link','permissions','esign'], 40
FROM shared.help_categories c WHERE c.slug = 'documents'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles WHERE related_module='documents';
-- expected: 4 rows
-- ============================================================
