# Catalogue — Verification Checklist (Faitlynhair)

PR: **#125** · branch `claude/awesome-gates-yvhhpx`

Tick every box on a live Faitlynhair instance. This is the "done once and for
all" sign‑off — the build is code‑complete + unit‑tested, but the **live‑DB
import of your real file** can only be proven here, where the database lives.

Legend: ☐ = to verify · 💡 = expected result · ⚠ = watch out

---

## 0. Apply the change (one time)

- [ ] Pull the branch and install: `npm install` (root) and `cd apps/admin && npm install`
- [ ] Apply the migration to the brand schema: run `repair-business-schema` for **faitlynhair**
      💡 it applies 000045 (base link + size ladder), **000046 (USD price columns)**, **000047 (collections hold styled products)**
- [ ] Apply the shared migration **000231** (service USD columns) via the normal migrate step
- [ ] Confirm the size ladder is now **S 0 / M 0 / L 15000 / XL 25000**
      `SELECT size_code, premium_ngn FROM faitlynhair.styled_size_tiers ORDER BY display_order;`
- [ ] Confirm the base link column exists
      `SELECT 1 FROM information_schema.columns WHERE table_schema='faitlynhair' AND table_name='styled_product_variants' AND column_name='base_product_id';`
- [ ] Confirm the USD columns exist (10 across the brand schema)
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='faitlynhair' AND column_name LIKE '%_usd' ORDER BY 1,2;`
- [ ] Confirm collections now target styled products
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='faitlynhair' AND table_name='product_collection_members' AND column_name IN ('styled_id','product_id');`
      💡 `styled_id` present; `product_id` is_nullable = YES
- [ ] Backend up (`npm run dev`), admin up (`cd apps/admin && npm run dev`), log in to Faitlynhair

---

## 1. The model (smoke test before bulk import)

- [ ] **Styled** tab loads with the four states (loading / empty / error / data)
- [ ] Create one styled product by hand → add 1 colour → generate variants for
      2 sizes + 2 lace → 💡 a variant **table** appears: Colour · Size · Lace · SKU · Retail · Override · Active
- [ ] Set an **Override** price on one variant → save → 💡 Retail shows the override
- [ ] Switch its lace → 💡 the lace shows per row; price is the row's own price (not a single anchor)
- [ ] Delete the test product (Trash) → 💡 it disappears and the name is freed

---

## 2. Import / Export round‑trip ⭐ (the core deliverable)

### 2a. Template
- [ ] Styled tab → **Template** → 💡 downloads `.xlsx` with **one sheet** + a read‑only **Reference** sheet
- [ ] Header row is exactly:
      `Styled Name* · Base Product* · Colour* · Hex · Lace · Size* · Retail Price (NGN)* · Compare-at Price (NGN) · Default Colour? · Collections (comma) · Bundles (comma) · Status · Short Description · Slug · Image URLs (comma)`
- [ ] `Base Product`, `Lace`, `Size` cells offer **dropdowns** sourced from the Reference sheet
      ⚠ Base Product names must match your seeded base products **exactly**

### 2b. Import your real file
- [ ] Prepare the sheet from your price list — **one row per variant** (colour × lace × size), price per row
- [ ] **Import** → 💡 summary shows `created` / `updated`, and an **info** line per product (e.g. "72 variants for All Classic")
- [ ] 💡 You end up with **11 products** (Side‑Shaved curls folded into Jamila/Lerato/Zuri as agreed)
- [ ] Open **All Classic** → 💡 9 colours, lace 13×4 **and** 6×6, sizes S/M/L/XL
- [ ] ⚠ Any row whose Base Product / Size / Colour didn't resolve appears under "skipped / failed" with the reason — fix and re‑import (re‑import **updates**, never duplicates)

### 2c. Price spot‑checks (must match your Naira price list)
- [ ] All Classic · Classic Brown · **6×6** · L → 💡 **₦380,000**
- [ ] All Classic · Classic Black · **13×4** · XL → 💡 **₦414,000**
- [ ] Jamila Rae · Black · **13×6** · S → 💡 **₦465,000** (13×4 S = ₦425,000 — lace changes the price)
- [ ] Signature Pixie · **Spicy Copper** · 13×4 · XL → 💡 **₦460,000** (Black XL = ₦450,000 — the +₦10k colour)
- [ ] Nala Sleek Bounce · 13×4 · S → 💡 **₦595,000**
- [ ] Any colour at the same lace+size → 💡 same price (colour is flat except the few above)

### 2d. Export = re‑import (round‑trip)
- [ ] Styled tab → **Export** → 💡 downloads the **same column shape** as the template
- [ ] Re‑**Import** that exact file → 💡 all rows report **updated**, **0 created**, **0 failed**
- [ ] 💡 Product count, prices, colours and lace are **unchanged** after the round‑trip
- [ ] (Cross‑brand) Export from Faitlynhair → import into **Pixie Girl** → 💡 same catalogue appears

---

## 3. Full CRUD — every tab

For each: **Create → Read (list+detail) → Update → Delete** all work and persist after refresh.

- [ ] **Styled** — create / edit name, description, colours, variants, prices / delete (+ Trash & Restore)
- [ ] **Base** — open a base → **Details** card edits name/texture/lace/length and saves; **Delete base** works (→ Trash) ⚠ do **not** disturb seeded bases
      💡 the base page no longer shows "Add to collection" (bases never join collections)
- [ ] **Collections** — create; click a card → editor opens → rename, **add & remove styled products**, delete; Template/Export/Import
      ⚠ the product picker lists **styled** products only
- [ ] **Bundles** — create; click "Edit & manage products" → rename, change pricing (NGN+USD), **add & remove base products**, delete; Template/Export/Import
- [ ] **Services** — create; **Edit** (full form) and **Delete**; Template/Export/Import
- [ ] **Categories** — (if enabled in Config) create / **edit** / delete
- [ ] **Config** — edit size ladder, head‑size guide, Categories toggle; save persists

## 3a. USD pricing (set manually, never auto‑converted)

- [ ] **Base variant** modal has Naira **and** US Dollar fields for storefront + wholesale
- [ ] **Styled** detail has Naira + USD for retail and compare‑at; the variant table has an **Override ₦** and **Override $** column
- [ ] **Bundle** fixed price takes Naira + USD; card shows USD under NGN when set
- [ ] **Service** create/edit takes a USD base price
- [ ] Leaving a USD field blank stores nothing (no phantom $0); the price simply shows NGN only

## 3b. Bundle discount model (owner‑confirmed)

- [ ] **Fixed bundle price** — one flat price for the whole bundle
- [ ] **% off the bundle total** — e.g. 10% scales with the component subtotal
- [ ] **Fixed ₦ off the bundle** — stays **flat** (e.g. ₦30k) no matter how many products are added
      💡 the editor spells each of these out in plain language under the model picker

---

## 4. Storefront experience (the customer view)

- [ ] Exactly **11 products** show (not 248)
- [ ] Open a product → tap the gallery → 💡 you can move image‑to‑image and see other **colours**
- [ ] Pick a **colour** → 💡 price stays the same for most, updates if that colour costs more
- [ ] Pick a **lace** → 💡 price updates (e.g. 6×6 cheaper, 13×6 dearer)
- [ ] Pick a **size** → 💡 S = M, L +₦15k, XL +₦25k
- [ ] Add to cart → 💡 the exact variant (colour + lace + size) is the line item

---

## 5. Permissions & money

- [ ] A non‑privileged role cannot see cost/wholesale; controls they lack are hidden
- [ ] All money renders via `MoneyText` (NGN, 2dp) — no raw numbers
- [ ] Publish: imported products start as **draft** → publish makes them live (separate, intentional step)

---

## 6. Known notes (not bugs)
- Imported styled products land as **draft** by design — bulk‑publish when ready.
- `Lace` labels normalise to a code internally (`HD6x6 Center` → `HD6X6CENTER`); the pretty label is kept and re‑exported, so the round‑trip is stable.
- Pre‑existing, unrelated test failures live in `landing_studio/defaults`, `auth/password-reset`, `smartcomm/order-capture` (they fail on the base branch too — env config, not this change).

---

## Sign‑off
- [ ] Sections 1–5 all green on Faitlynhair
- [ ] Round‑trip (2d) is byte‑clean (export re‑imports with 0 created / 0 failed)
- [ ] Owner accepts → merge PR #125
