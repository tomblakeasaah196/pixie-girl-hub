-- ============================================================
-- MIGRATION 000268 — Help Center content: Catalogue & Services
-- Pixie Girl Hub · V2.2 §6.6 (Catalogue) · §6.30 (Help Center)
--
-- Populates the existing 'catalogue' category (seeded empty in 000214)
-- with the full Catalogue set: overview, base vs styled products &
-- variants, the Cost Vault (field-level cost visibility), collections/
-- shades/bundles/services, USD repricing, and a FAQ.
--
-- Grounded in src/modules/catalogue + apps/admin/src/pages/catalogue:
-- tabs Styled / Base / Categories / Collections / Shades / Bundles /
-- Services / Config; base products + variants; styled-products with BOM,
-- colours, publish; cost-vault access/grants; usd-pricing reprice.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('catalogue', 'Catalogue & Services',
   'Base and styled products, variants, collections, shades, bundles and the Cost Vault.',
   'Package', 40)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'catalogue-overview',
  'How the Catalogue is organised',
  'Base products are the raw goods you buy; styled products are the finished, branded items you sell. Variants are the actual sellable SKUs under each.',
  $md$
## Two layers: Base and Styled

The **Catalogue** (sidebar → **Catalogue**, or `/catalogue`) separates what you
**buy** from what you **sell**:

- **Base** products — the raw goods (e.g. a bundle of raw hair). These are what
  Purchasing brings in and Stock counts.
- **Styled** products — the finished, branded items you actually sell (e.g. a
  styled, coloured wig). A styled product has a **bill of materials (BOM)** — the
  base products and work that go into it — which is what links styling and
  landed cost back to price.

## Variants are the real SKUs

Under a product sit **variants** — the specific sellable versions (length,
colour, cap size, density…). Stock counts *variants*, pricing is set on
*variants*, and a sale sells a *variant*. The product is the family; the variant
is the thing on the shelf.

## The tabs

- **Styled** / **Base** — the two product lists above.
- **Categories** / **Collections** — how you group products for browsing.
- **Shades** — the colour/shade system (feeds the shade finder).
- **Bundles** — sell several items together as one.
- **Services** — the in-house service offerings (styling, installs).
- **Config** — catalogue-wide settings.
$md$,
  'all', 'catalogue',
  ARRAY['catalogue','products','variants','base','styled','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'catalogue'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Products & variants ───────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'catalogue-products-and-variants',
  'Creating products, variants and styled skins',
  'Add a base product, give it variants, then build the styled product you sell — with its bill of materials and colourways.',
  $md$
## Base products first

Create a **base product** for a raw good, then add its **variants** (the
sellable dimensions). Variants are what Stock tracks and what Purchasing
reorders.

## Styled products (the things you sell)

A **styled product** is the finished item. It carries:

- a **bill of materials (BOM)** — the base products and work it consumes, so its
  **landed cost** can be computed,
- **colours / colourways** — the shade variants a customer can pick,
- **publish** state — a styled product is **published** to become visible on the
  storefront.

Styled products support **import/export** (a template to bulk-load them) and a
**trash/restore** flow so a deletion isn't final.

## The link to price and stock

Because a styled product knows its BOM, changes in base cost or styling feed
**Pricing** and **Production** (landed cost). And because everything ultimately
resolves to variants, **Stock** always knows what's actually sellable.
$md$,
  'all', 'catalogue',
  ARRAY['catalogue','products','variants','styled','bom','publish'], 20
FROM shared.help_categories c WHERE c.slug = 'catalogue'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Cost Vault ────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'catalogue-cost-vault',
  'The Cost Vault: who can see cost',
  'Cost, factory origin and margin are sensitive. The Cost Vault hides them from most roles and grants access deliberately, one person at a time.',
  $md$
## Why a vault

Cost price, factory origin and margin are exactly the fields you don't want
every staff member — or a screenshot — to expose. The **Cost Vault** is the
field-level control (RBAC layer 5) that keeps those numbers hidden unless
someone is explicitly granted access.

## How it works

- **My access** shows whether *you* can currently see cost fields.
- **Grants** (management) is where cost visibility is given to a specific person,
  and revoked when it's no longer needed.

When you lack access, cost/margin columns simply don't render — in the app and
in exports. It's enforced at the API, so it isn't a matter of hiding a button.

## The tie to pricing insights

Pricing's "selling below cost" insight needs cost to work — the Vault governs
*who can see* the numbers, not whether the system uses them internally. The
checks still run; the figures just stay masked for unprivileged roles.
$md$,
  'ceo', 'catalogue',
  ARRAY['catalogue','cost-vault','cost','margin','rbac','field-security'], 30
FROM shared.help_categories c WHERE c.slug = 'catalogue'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Collections, shades, bundles, services & USD reprice
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'catalogue-merchandising',
  'Collections, shades, bundles, services and USD repricing',
  'The merchandising tools: group products into collections, manage shades, sell bundles, list services, and reprice against the live USD rate.',
  $md$
## Collections & categories

**Categories** classify products; **Collections** are curated groupings
(seasonal, themed) used for browsing and campaigns. A product can sit in a
collection to be surfaced together.

## Shades

The **Shades** system manages colour options and feeds the shade finder, so
customers and staff pick from a consistent palette rather than free-typing
colours.

## Bundles

A **bundle** sells several items as one packaged offer. It's a catalogue object
in its own right so it can be priced and sold like a product.

## Services

The **Services** tab lists in-house service offerings (installs, colouring) that
Stylist Studio delivers and Sales can bill.

## USD repricing

For goods priced against the dollar, **USD pricing** can pull the **market
rate** and **reprice** affected items in one controlled action — with a
**preview** and an **undo** — so a naira-denominated catalogue stays aligned to
FX without hand-editing every price.
$md$,
  'ceo', 'catalogue',
  ARRAY['catalogue','collections','shades','bundles','services','usd','reprice'], 40
FROM shared.help_categories c WHERE c.slug = 'catalogue'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'catalogue-faq',
  'Catalogue FAQ',
  'Base vs styled, why cost is hidden, publishing to the storefront, deleting products, and where price is set.',
  $md$
## "What's the difference between Base and Styled?"

**Base** = the raw good you buy and count. **Styled** = the finished, branded
item you sell, built from base goods via its bill of materials. You purchase
base, you sell styled.

## "Why can't I see the cost of a product?"

The **Cost Vault** hides cost/margin/origin from roles without a grant. If you
need it for your job, ask an admin to grant Cost Vault access; otherwise it
stays masked (in exports too).

## "How do I make a product show on the storefront?"

**Publish** the styled product. An unpublished product is internal only; a
published one with no active, priced variant is flagged by Insights as
"visible but can't be bought", so make sure it has a sellable variant.

## "I deleted a product by mistake."

Products (and styled products) go to **trash**, not oblivion — use **restore**.
The trash view lists what's recoverable.

## "Where do I set the price?"

Price lives on the **variant** and is governed by the **Pricing** module
(margins, per-channel fees, floors). Catalogue defines *what* exists; Pricing
governs *what it costs*.
$md$,
  'all', 'catalogue',
  ARRAY['catalogue','faq','cost-vault','publish','trash','pricing'], 50
FROM shared.help_categories c WHERE c.slug = 'catalogue'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'catalogue'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
