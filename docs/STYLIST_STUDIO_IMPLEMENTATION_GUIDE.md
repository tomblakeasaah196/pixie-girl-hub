# Stylist Studio — Implementation Guide (4 PRs, 2 engineers)

> Operations module for Faitlyn's in-house styling: sell services, assign wigs to
> stylists, track time/materials/references, QC, dispatch, and **never lose a wig**.
> This guide is the contract. Two engineers work in parallel on separate branches.
> Build to the schema + API contract in §3–§4 so PRs don't block each other.

---

## 1. Decisions locked (from strategy sessions)

| # | Decision |
|---|---|
| Module name | **Stylist Studio** (in-house). Rename `service_jobs` → `stylist_studio`. The external `stylist_programme` is untouched. |
| Service-sale rail | Extend `sales_order_lines` to carry services/styled — one order → payment-link → checkout path. |
| Job auto-open | Only when an order line is a **styled product or a service** (not plain wig sales). |
| POS | **Deleted.** Already disabled in routes/registry. Replaced by the **Quick Sale Form** with item types: Base · Styled · Bundle · **Service**. Keep card-terminal (Nomba) charge + cash + void/refund as Quick-Sale payment options; drop the POS session/cash-drop ceremony. |
| Customer's own wig | Lightweight `customer_assets` record (intake photo, condition, check-in/out). |
| Style spec | Production DNA on the styled product (default service type, recipe, default BOM, turnaround, SOP) — travels into every job. |
| Recipe reuse | Recipe is a shared library object; many styled products reference one `recipe_id`. |
| References | Typed `service_job_references` (image / audio / video_link / text / creative_freedom). |
| Time | Session log (`service_job_time_logs`, start/stop, multi-session). |
| Materials | Default BOM on style + per-job actuals. Discrete items deduct exact units; chemicals = checklist + existing monthly reconciliation. |
| State machine | `pending → assigned → in_progress → returned_for_qc → qc_passed → ready_for_dispatch → handed_to_sales → completed`; plus `rework`, `on_hold`, `rejected`, `cancelled`. |
| Rework | Ops decides each time: same stylist (default) or reassign. |
| Notifications | In-app + push. |
| Pricing | Styled order → styling already paid, **no customer billing** (internal cost only). Own-wig → priced from Services catalogue (seed the price list). |
| Delivery | Auto-create logistics shipment on `ready_for_dispatch`, with promised-vs-actual SLA. |
| Stylist view | Workspace task (the nudge) + "My Studio Jobs" (where work is logged). |
| Wig accountability | **Quantity-based** ledger (no QR). `OUT − RETURN = currently held`; per-stylist balances; missing-wig flag when `OUT` has no `RETURN` past **7 days** (configurable). |

---

## 2. Parallelization & branch strategy

Two engineers, four PRs, separate branches off `main`:

```
PR1  Schema & migrations          → Engineer A   branch: feat/studio-schema      (merges FIRST)
PR2  Stylist Studio backend       → Engineer A   branch: feat/studio-backend
PR3  Sell-a-service + Quick Sale  → Engineer B   branch: feat/studio-commerce
     + POS teardown
PR4  Frontend (all surfaces)      → Engineer B   branch: feat/studio-frontend
```

**How they stay unblocked**

- **PR1 lands first** (schema only, fast, low-risk). A authors it day 1; B reviews and merges same day.
- After PR1 merges, **PR2 and PR3 run fully in parallel** — they touch disjoint files (A in `src/modules/stylist_studio/` + ledger; B in `src/modules/sales/` + new `quick_sale` + POS deletion). Near-zero conflict surface.
- **PR4** depends on PR2 + PR3 endpoints. B starts it against the frozen **API contract (§4)** while A finishes PR2, then integrates. PR4 merges last.
- The **schema (§3) and API (§4) contracts are frozen in this doc** so neither engineer waits on the other's implementation — they code to the contract.

**Merge order:** PR1 → (PR2 ∥ PR3) → PR4.

**Conflict-avoidance rules**
- Only **PR1** edits migrations. PR2/PR3 never add columns — if they need one, they request it into PR1 before PR1 merges.
- `src/routes/index.js` is edited by **PR2** (mount `stylist-studio`, unmount `service-jobs`) **and** PR3 (mount `quick-sale`, delete commented POS lines). Split by line region; coordinate a single rebase. This is the only shared backend file.
- `apps/admin/src/lib/modules.ts` and `router.tsx` are **PR4 only**.

---

## 3. Schema contract (PR1 owns; everyone codes to it)

Brand tables use `migrations/template/*.sql.template` with `{{BUSINESS}}` substitution (new files numbered after `000063`). Shared tables/seeds use `migrations/*.sql` (after `000244`).

### 3.1 Rename service_jobs → stylist_studio (logical)
Keep the **tables** `service_jobs` / `service_types` (don't rename DB tables — too much blast radius). Rename only the **module** and **permission key**:
- Module dir `src/modules/service_jobs/` → `src/modules/stylist_studio/` (files `stylist-studio.*`).
- Permission key `service_jobs` → `stylist_studio` in `migrations/000207_shared_access_matrix_seed.sql` via a **new** shared migration that updates `shared.access_matrix` rows (owner/full, ops_mgr/partial_team, tech_stylist/full, finance/partial_team).
- Route mount `/api/v1/service-jobs` → `/api/v1/stylist-studio`.

### 3.2 Styled product production DNA  (brand template)
`ALTER TABLE {{BUSINESS}}.styled_products ADD`:
- `default_service_type_id UUID REFERENCES service_types(service_type_id)`
- `default_recipe_id UUID REFERENCES chemical_recipes(recipe_id)`
- `standard_turnaround_days SMALLINT`
- `sop_steps JSONB`  — ordered checklist `[{step, text}]`

New `{{BUSINESS}}.styled_product_bom`:
```
bom_id UUID PK, styled_id UUID FK styled_products ON DELETE CASCADE,
kind TEXT CHECK (kind IN ('discrete','chemical')),
variant_id UUID NULL FK product_variants,   -- discrete items (lace, nets…)
chemical_name TEXT NULL,                     -- chemicals
default_quantity NUMERIC(12,2) NULL,         -- discrete only
display_order SMALLINT, created_at, updated_at
```

### 3.3 Service jobs expansion  (brand template — ALTER service_jobs)
Extend status CHECK to:
`('pending','assigned','in_progress','on_hold','returned_for_qc','qc_passed','rework','ready_for_dispatch','handed_to_sales','completed','rejected','cancelled')`
Add columns:
- `assigned_at, returned_at, qc_at, ready_at, handed_at TIMESTAMPTZ`
- `qc_by UUID FK users`, `rework_count SMALLINT DEFAULT 0`
- `reserved_variant_id UUID FK product_variants`  — the base wig locked to this job
- `sla_due_at TIMESTAMPTZ`  — promised delivery
- `styled_id UUID FK styled_products`  — provenance when opened from a styled order
- `shipment_id UUID`  — set on dispatch (logistics)
- `customer_asset_id UUID`  — set for own-wig jobs

### 3.4 New child tables  (brand template)
```
service_job_time_logs(log_id PK, job_id FK service_jobs ON DELETE CASCADE,
  stylist_user_id UUID FK users, started_at, ended_at NULL,
  duration_minutes INT GENERATED/derived, note TEXT, created_at)

service_job_materials(material_id PK, job_id FK service_jobs ON DELETE CASCADE,
  kind TEXT CHECK ('discrete','chemical'),
  variant_id UUID NULL, chemical_name TEXT NULL,
  quantity NUMERIC(12,2) NULL,            -- discrete only
  stock_deducted BOOLEAN DEFAULT false, stock_movement_id UUID NULL,
  logged_by UUID FK users, created_at)

service_job_references(reference_id PK, job_id FK service_jobs ON DELETE CASCADE,
  ref_type TEXT CHECK ('image','audio','video_link','text','creative_freedom'),
  doc_id UUID NULL,        -- image/audio uploads (shared.documents)
  url TEXT NULL,           -- video_link
  body TEXT NULL,          -- text note
  created_by UUID FK users, created_at)

wig_custody_ledger(entry_id PK, job_id FK service_jobs ON DELETE SET NULL,
  event TEXT CHECK ('out','return','dispatched','write_off'),
  quantity INT NOT NULL DEFAULT 1,
  stylist_user_id UUID NULL FK users,
  location TEXT NULL, reason TEXT NULL,
  created_by UUID FK users, created_at)

customer_assets(asset_id PK, owner_contact_id UUID FK shared.contacts,
  asset_tag TEXT UNIQUE,                  -- 'FLH-CA-0001'
  intake_photo_doc_id UUID NULL, condition_note TEXT,
  status TEXT CHECK ('in_our_possession','in_service','returned_to_owner','lost')
        DEFAULT 'in_our_possession',
  service_job_id UUID NULL, checked_in_at, checked_out_at, created_by, created_at)
```

### 3.5 Sales order line — service support  (brand template — ALTER sales_order_lines)
- `service_offering_id UUID` (soft ref to `shared.service_offerings`)
- `styled_id UUID FK styled_products`
- `line_kind TEXT CHECK ('product','styled','bundle','service') DEFAULT 'product'`
(`service_job_id` already exists.)

### 3.6 Seeds  (shared migration)
Seed `shared.service_offerings` for FLH with the agreed price list (Colour & Styling + Installation). Seed default `service_types` if missing. Add a `studio_config` brand row for the **missing-wig threshold days (default 7)**.

### 3.7 POS teardown  (shared + template migration)
- New template migration: `DROP TABLE IF EXISTS {{BUSINESS}}.pos_* CASCADE`.
- New shared migration: delete `pos` rows from `shared.access_matrix`.

---

## 4. API contract (PR2/PR3 implement; PR4 codes to this)

**Stylist Studio (PR2)** — base `/api/v1/stylist-studio`, permission `stylist_studio`:
```
GET    /jobs?status=&assigned_to=me&overdue=         list / filters
GET    /jobs/:id                                     full job + brief + logs + materials
POST   /jobs/:id/assign            {stylist_user_id} → assigned, reserve+deduct base, ledger OUT, notify
POST   /jobs/:id/start                               → in_progress, opens time session
POST   /jobs/:id/pause | /resume                     time session control
POST   /jobs/:id/materials         {kind,variant_id|chemical_name,quantity} discrete deducts stock
DELETE /jobs/:id/materials/:mid
POST   /jobs/:id/references         {ref_type,doc_id|url|body}
POST   /jobs/:id/return                              → returned_for_qc, ledger RETURN, notify ops
POST   /jobs/:id/qc                 {result:pass|rework, quality_rating, notes, reassign_to?}
POST   /jobs/:id/dispatch                            → ready_for_dispatch, create shipment, ledger DISPATCHED
POST   /jobs/:id/hand-to-sales                       → handed_to_sales
GET    /accountability                               per-stylist balances + overdue list
GET    /accountability/ledger?job_id=&stylist=       raw movements
POST   /accountability/write-off   {job_id,reason}   approval-gated
```
**Styled product DNA (PR2 or PR4-backed):** `GET/PATCH /catalogue/styled/:id/production` (service type, recipe, turnaround, SOP, BOM CRUD).

**Commerce (PR3):**
```
GET  /api/v1/services                          services catalogue (admin)
POST /api/v1/quick-sale                        {line_kind, ref_id, customer, payment|payment_link, own_wig?}
POST /api/v1/customer-assets                   check-in (intake photo, condition)
POST /api/v1/customer-assets/:id/check-out
```
Service/styled lines flow through existing `sales.createOrder` → `order.deposit_met` → auto-open job (PR2 subscriber, filtered to styled/service lines).

---

## 5. PR breakdown

### PR1 — Schema & migrations  · Engineer A · `feat/studio-schema` · merges first
**Scope:** everything in §3. Migrations only + the permission-key rename seed. No business logic.
**Files:** new `migrations/template/0000{64+}_*.sql.template`, new `migrations/0002{45+}_*.sql`, edit nothing in `src/` except none.
**Acceptance:** `npm run db:migrate:*` clean on a fresh DB; `npm run db:verify` passes; new tables present in both brand schemas; access_matrix shows `stylist_studio`, no `pos`.
**Tests:** migration smoke (`npm run smoke`).

### PR2 — Stylist Studio backend  · Engineer A · `feat/studio-backend`
**Scope:** rename module; implement the full state machine + endpoints in §4; reservation + stock deduction on assign; time sessions; materials (discrete deduct, chemical checklist); references; QC + rework; **accountability ledger** service + missing-wig detection job; **notifications** (in-app + push) on assign/return/qc/rework; dispatch → logistics shipment + SLA; auto-open subscriber filtered to **styled/service** lines; styled-product DNA inheritance into new jobs; styled DNA CRUD.
**Files:** `src/modules/stylist_studio/*` (from `service_jobs`), `src/routes/index.js` (mount), `src/jobs/` (overdue-wig scheduler), wire `src/services/notifications.service.js`. Update trigger usage in `migrations` is PR1's job — PR2 only reads.
**Acceptance:** full Journey A states reachable via API; assigning deducts + writes ledger OUT; return/dispatch update balances; overdue job surfaces in `/accountability`; styled order opens a DNA-filled job, plain order does not.
**Tests:** unit (state machine, ledger math, BOM deduction), integration (assign→return→qc→dispatch→balances reconcile).

### PR3 — Sell-a-service + Quick Sale + POS teardown  · Engineer B · `feat/studio-commerce`
**Scope:** `line_kind` on order lines + service/styled order creation; services catalogue endpoint + seed wiring; `customer_assets` check-in/out; **Quick Sale** module (`src/modules/quick_sale/`) with Base/Styled/Bundle/Service item types, payment + payment-link, own-wig check-in; payment options = card-terminal (Nomba) charge + cash + void/refund (lifted from POS service into a shared payments helper); **delete** `src/modules/pos/`, remove commented POS lines in `src/routes/index.js`.
**Files:** `src/modules/sales/*`, new `src/modules/quick_sale/*`, `src/modules/service_catalogue/*` (seed/list), new `src/modules/<...>/customer-assets.*` (or under stylist_studio — coordinate with A; default: under quick_sale), delete `src/modules/pos/`.
**Acceptance:** a Service line can be sold → order → payment link → on payment, a job opens (via PR2 subscriber); own-wig check-in creates a `customer_assets` row; no `pos` reference remains (`grep -ri pos src/ apps/` clean except unrelated words).
**Tests:** unit (order-line kind pricing), integration (service sale → deposit_met → job opened; quick-sale cash + link paths).

### PR4 — Frontend  · Engineer B · `feat/studio-frontend` · merges last
**Scope:** Stylist Studio cockpit (job list/board, assign drawer, QC screen); **My Studio Jobs** (Style Brief, timer, materials checklist, photos); **Accountability dashboard** (balances + overdue + nudge); **Quick Sale Form** service item type + own-wig check-in; styled product **Production tab** (DNA + BOM + recipe picker); Services catalogue tab; Workspace notification surfacing. Remove POS from `modules.ts`/`router.tsx`.
**Files:** `apps/admin/src/pages/stylist-studio/*`, `apps/admin/src/pages/workspace/*` (studio jobs), quick-sale page, catalogue styled production tab, `lib/modules.ts`, `router.tsx`.
**Design canon:** follow `docs/FRONTEND_INSTRUCTION_MUST_READ.md` (Maroon Noir, glassmorphism, MoneyText, four states, `X-Brand-Context`, TanStack keys, permission-aware). Build against §4 API contract; mock until PR2/PR3 land.
**Acceptance:** all four screen-states per page; entity-scoped; permission-aware (stylist sees only own jobs; ops sees all + accountability); matches the journey's UI previews.

---

## 6. Open assumptions to confirm
1. **POS payments:** keep card-terminal (Nomba) charge + cash + void/refund inside Quick Sale; drop session/cash-drop. (Assumed yes.)
2. **Missing-wig threshold:** 7 days, configurable in `studio_config`. (Assumed yes.)
3. **Customer-asset module home:** placed under `quick_sale` (check-in happens at the counter). Move under `stylist_studio` if you'd rather Ops own it.

---

## 7. Definition of done (all PRs)
- `npm run lint && npm test` green; integration tests where noted.
- No `pos` references remain.
- Journey A and Journey B runnable end-to-end on a seeded DB.
- Accountability always reconciles: `Σ OUT − Σ RETURN − Σ DISPATCHED = on-floor`; overdue wig raises a flag with job + stylist named.
