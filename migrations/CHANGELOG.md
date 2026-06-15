# Schema Changelog — Pixie Girl Hub Shared Migrations

Tracks edits made to the shared migrations after the initial draft. Each
entry names the SOURCE (which V-of-spec drove the change), the FILES
edited, and a precise WHAT/WHY.

The intent of editing in place (rather than appending patch migrations)
is so that a clean checkout of `migrations/` is the complete, current
truth for the database. A first-time deployment never has to apply
patches; only the in-order `.sql` files.

---

## 2026-06-15 — Products: Base/Styled, Cost Vault, pre-order, AI drafting

**Source:** V2.2 §6.4/§6.24 audit gaps P0-6 (3-tier Base→Styled catalogue),
P0-7 (pre-order / production timeline), P0-1 (cost field-privacy), plus the
owner's "only Faith sees true cost & supplier" requirement.

**Phase 1 — data model (this entry):**

- **P0-6** `template/000016` — **NEW `styled_products`** table: a
  storefront-facing "Styled" skin over exactly one base product (`products`,
  which stays the only stock-bearing record). Many styled per base; no stock
  of its own; final price = base + `style_addon_price_ngn`; lifecycle
  `draft→live→archived` with AI-draft provenance columns. Added nullable
  `product_images.styled_id` so a styled skin can carry its own gallery.
- **P0-1** `template/000016` — **NEW `product_variant_cost_vault`**: true
  landed cost + supplier identity, AES-256-GCM encrypted at the app layer
  (`encryption.service`). `products.cost_price_ngn`/`min_price_ngn` are now
  DEPRECATED (left NULL; redacted regardless). `template/000038` — vault
  added to the `hub_basic` sensitive-table exclusion list.
- **P0-1** `000117_shared_cost_vault_grants.sql` (**NEW**) — owner-controlled
  per-USER vault access list, modelled on `ai_access_grants`. Visibility is
  nobody-by-default except the owner (is_ceo); only the owner writes it.
- **P0-7** `template/000016` — `products` gains `preorder_enabled`,
  `expected_ready_date`, `production_lead_days` for the production-framed
  out-of-stock fallback ("In production · ready ~{date}").
- `000015` — seeded AI feature flag `products_ai_drafting` (draft-only).
- `000103` — catalogue `publish` action (owner/admin/manager) for the
  styled draft→live workflow.

Existing dev brand schemas (pixiegirl, faitlynhair) must be re-bootstrapped
(`npm run db:reset` then bootstrap) to pick up the new per-brand tables;
`000117` applies to the shared schema via `db:migrate:shared`.

## 2026-06-04 — V2.2 conformance pass

**Source:** `Final_PixieGirl_Hub_Product_Description_v2_2__3_.html`
(authoritative V2.2, full module-by-module audit)

A complete conformance pass against the final V2.2 spec, organised into
three buckets. Three architectural decisions were locked in first:
RLS = full (Option A); E-signature = full workflow tables;
Cash Request = shared table with `business` discriminator.

### Bucket A — cheap spec mismatches

- **A-1** `template/000035` — loyalty tier thresholds corrected to V2.2
  values (0 / 500 / 2,000 / 5,000 lifetime points). Were 20× too high.
- **A-2 / A-9** `000008`, `000015` — stylist tier dictionary
  `shared.stylist_tier_keys` seeded Certified → Pro → Elite; comment on
  `stylist_partners.current_tier_key` updated.
- **A-3** `template/000034` — `fn_kpi_weights_sum_to_100` CONSTRAINT
  TRIGGER (DEFERRABLE) blocks any active-KPI weight set that doesn't
  total exactly 100. Live-tested: rejects a 5th KPI pushing the sum to 110.
- **A-4** `template/000020` — POS `client_idempotency_key` + partial
  UNIQUE index `(terminal_id, client_idempotency_key)` to stop
  double-charge on network retry.
- **A-5** `000010` — `shared.customer_wishlists` (contact_id, business,
  soft-FK variant_id, snapshots, lifecycle) + GRANT to `hub_storefront`.
- **A-6 / C-4** `000002`, `template/000019/000020/000022` — all
  `strive_connect` references replaced with `opay` (Strive Connect is
  not in V2.2).
- **A-7** `template/000035` — Payment Processing Fees split into 9
  per-gateway × per-currency COA sub-accounts (5510–5518).
- **A-8** — verified cancellation defaults already correct (3 hr free /
  50% custom non-refundable); no change.

### Bucket B — missing spec features

- **B-1** `000100_shared_cash_request.sql` — **NEW Module 6.32 Cash
  Request & Disbursement.** Four shared tables (cash_requests +
  state_history + documents + settlements), 8-state status pill, mandatory
  `bank_transaction_id` at disbursement (CHECK), append-only state log via
  trigger, CEO-threshold config in business_config. Live-tested the full
  4-stage workflow PXG-CR-0001: pending_finance → pending_ceo → approved →
  disbursed (correctly blocked without bank_transaction_id, succeeded with).
- **B-2** `000002`, `template/000016/000019/000034` — installment payment
  model. `payment_model` ('layaway' | 'deposit_triggered' |
  'full_payment_only') on products + variant overrides; sales_orders
  lifecycle fields (required_deposit_ngn, deposit_met_at, fully_paid_at,
  abandoned_at, last_payment_at); sales_order_payments manual-transfer +
  idempotency fields; `fn_sales_order_recompute_paid` rewritten to set the
  sticky timestamps; `fn_validate_manual_payment` guard. Live-tested the
  3-stage manual-payment gate.
- **B-9** `000002` — `payment_gateway_fees` JSONB in business_config
  (Paystack/Opay 1.5% capped ₦2k, Nomba 0.5%, Stripe 3.4%+$0.30 uncapped).
- **B-3** `template/000036` — **Streak Stars.** earn_rules, tiers, ledger
  (append-only), customer_streak_state (trigger-maintained). Tier ladder
  Starlet → Rising Star → Shining Star → Supernova → Galaxy
  (100/200/400/700★ → 10/15/20/25% lifetime discount). Live-tested
  auto-promotion 50★ → 110★ (Rising Star) → 810★ (Galaxy 25%).
- **B-4** `template/000036` — **Hair Quiz** ("Find your style"): quizzes,
  questions, responses; links to a star-award rule + CRM lead capture.
  Seeded a 5-question starter quiz.
- **B-7** `template/000036` — storefront analytics: sessions, page_views,
  funnel_events (view → ATC → checkout → complete).
- **B-5** `template/000037` — **UGC pipeline + self-hosted video.**
  media_assets (canonical self-hosted store) + ugc_ingestion_queue
  (IG/TikTok capture → FFmpeg → moderation). `product_videos` migrated off
  the embed model: source CHECK now only `direct_upload` / `ugc_ingested`,
  `media_asset_id` NOT NULL FK, embed_url/external_ref deprecated.
- **B-6** `template/000019` — Public Order Form: sales_channel CHECK
  extended with public_form / facebook / tiktok / intercompany.
- **B-8** `template/000037` — Curated Delivery Letter + Install QR Hub:
  delivery_letter_templates (+ default seed with 7 layout blocks) and
  delivery_letter_renders (QR reuses public_tracking_token).
- **B-10** `000101_shared_esignature.sql` — **full e-signature workflow.**
  signature_requests + signers (exactly-one-of user/contact/external CHECK)
  - tamper-evident audit_events (append-only, hash-chained). documents gains
    signing_state + frozen_at + a frozen-doc lock trigger.

### Bucket C — architectural

- **C-1** `000200_shared_rls.sql` — **Row-Level Security (Option A).**
  `shared.current_business()` / `shared.current_user_id()` GUC helpers;
  generator enables RLS + a `brand_isolation` policy on every shared table
  with a `business` column (**63 policies**); custom dual-visibility policy
  for intercompany (seller_brand OR buyer_brand); `pixie_app` role
  (no BYPASSRLS). Live-tested: CEO/no-GUC sees both brands; per-brand
  context sees only its own rows.
- **C-2** `template/000038` — field-level privacy: 6 restricted views per
  brand hiding cost_price / factory cost / salary; roles hub_full /
  hub_basic / hub_payroll with a grant matrix that denies hub_basic the
  base sensitive tables.
- **C-3** `000202_shared_soft_fk_reconciliation.sql` — soft_fk_registry +
  reconciliation_runs + findings + 2 helper functions; 8 critical
  cross-schema soft-FK pairs registered for the nightly orphan sweep.

### Net schema delta

| Layer                    | Before  | After   |
| ------------------------ | ------- | ------- |
| shared base tables       | 107     | 119     |
| pixiegirl base tables    | 159     | 173     |
| faitlynhair base tables  | 159     | 173     |
| **total base tables**    | **425** | **465** |
| restricted views / brand | 0       | 6       |
| shared RLS policies      | 0       | 63      |
| soft-FK registrations    | 0       | 8       |

### App-layer follow-ups (TODO, documented not coded)

- `withBrand(brand, fn)` helper in `src/config/database.js` that runs
  `SET LOCAL app.current_business` per transaction.
- Cron `src/jobs/schedulers/soft-fk-reconciliation.js` to call
  `fn_soft_fk_reconciliation_start/finish`.
- Cron for layaway abandonment + reminders (reads the B-2 partial index).
- The signing UX (signature pad, PDF sealing) + UGC FFmpeg worker.
- Set `pixie_app` LOGIN + password out-of-band; point the app's DB user
  at it so RLS actually engages (superuser bypasses RLS).

---

## 2026-05-26 — V2.2 alignment

**Source:** `PixieGirl_Hub_Product_Description_V2__2_.html`
(V2.2 of the Product Description, received 2026-05-26)

### Summary of the spec delta

V2.2 added five concrete refinements over V2.1:

1. **Module 6.11 (HR & Payroll)** — Faitlyn employment-handbook detail:
   probation tracking, leave balances (annual / public holidays /
   "Special Event Days" day-off-in-lieu), non-solicitation window,
   summary-dismissal trigger log, sale-channel on commissions,
   weighted performance appraisal (Customer Feedback 40% / Sales
   Conversion 25% / Work Quality 20% / Cleanliness 15%).
2. **Module 6.24 (Production)** — the Faitlyn "Service Job Tracker"
   (digitises the Hair Assignment Register), with a 5-item service
   taxonomy (Installation / Revamping / Colour Creation /
   Customization / Packing), each priced and tracked individually
   for itemised intercompany styling invoices.
3. **Module 6.27 (Org & Workflow Builder)** — dotted-line reporting
   (information only, no approval authority), deputy pattern
   (a role inheriting "most of the CEO's operational capacities"),
   amount-thresholded approvals (manager approves up to N, escalates
   above).
4. **Module 6.30 (AI Insights)** — auto-generated weekly reports
   (replacing the manual Saturday 8 PM Zoho/Sheet ritual).
5. **Section 8 (Technology) — NEW deep-dive AI pages (8.1–8.5)**:
   - Thin-server stack: DeepSeek (LLM) + Groq Whisper API
     (transcription) + OpenAI text-embedding-3-small (embeddings) +
     pgvector
   - Three vendors → three encrypted, CEO-controlled API keys
   - **Future-proofing the embeddings**: dedicated table keyed to
     source records, with `embedding_model` + `embedding_version`,
     source text retained alongside the vector
   - Permission-scoped + entity-scoped RAG retrieval **before**
     similarity ranking (data-leak prevention)
   - Action catalogue gains `entity_scope` and explicit `is_write`

### Files edited in place

| File                          | What changed                                                                                                                                                                                                                                                                                                                                            | Why                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `000003_shared_people.sql`    | `staff_profiles`: added probation*\*, annual_leave*_, public*holiday*_, special*event_days*_, non*solicit*_, dismissal_triggers_log                                                                                                                                                                                                                     | Module 6.11 — Faitlyn HR fields                                                                                              |
| `000003_shared_people.sql`    | `staff_profiles`: added 2 partial indexes (probation ending, non-solicit active)                                                                                                                                                                                                                                                                        | Common HR queries from spec                                                                                                  |
| `000003_shared_people.sql`    | `leave_requests`: extended `leave_type` CHECK to include `special_event_in_lieu`, `public_holiday`, `bereavement`                                                                                                                                                                                                                                       | Module 6.11 leave types                                                                                                      |
| `000003_shared_people.sql`    | `org_positions`: added `reports_to_position_id` (solid-line FK), `is_deputy` flag, `deputy_capacities[]`, `approval_threshold_ngn`                                                                                                                                                                                                                      | Module 6.27 — deputy pattern + thresholds                                                                                    |
| `000003_shared_people.sql`    | **NEW table** `org_position_dotted_lines`                                                                                                                                                                                                                                                                                                               | Module 6.27 — dotted-line reporting (info-only, never used for approval routing)                                             |
| `000003_shared_people.sql`    | `workflow_definitions` comment: expanded JSON shape to document amount thresholds, deputy fallback, dotted-line non-routing                                                                                                                                                                                                                             | Module 6.27 — clarification for engineers                                                                                    |
| `000012_shared_ai.sql`        | `ai_action_catalogue`: **removed inline `embedding vector(1536)` column**, added `title`, `entity_scope` (pxg/flh/both/any), `is_write` boolean; dropped `idx_ai_actions_embedding` (moves to new table)                                                                                                                                                | V2.2 §8.1 (embeddings in dedicated table) + §8.3 (entity_scope, is_write)                                                    |
| `000012_shared_ai.sql`        | `ai_knowledge_chunks`: **removed inline `embedding vector(1536) NOT NULL`**; added `required_permissions[]`, `sensitivity`, `contains_field_tags[]`, `content_hash`; widened source_type CHECK to include `action_catalogue` and `action_example`                                                                                                       | V2.2 §8.4 (permission-scoped retrieval BEFORE similarity ranking) + §8.1 (dedicated embeddings table)                        |
| `000012_shared_ai.sql`        | **NEW table** `shared.ai_embeddings` (the dedicated embeddings store) — soft FKs by `(source_table, source_id, source_sub_key)`, columns for `embedding_model`, `embedding_version`, `embedding_dim`, retained `source_text`, denormalised `business` + `required_permissions[]` + `sensitivity` for filter-before-rank, `is_stale` flag for migrations | V2.2 §8.1 ("a future move off vector(1536) becomes a controlled migration, with no data loss and no core-schema disruption") |
| `000012_shared_ai.sql`        | **NEW table** `shared.ai_vendor_credentials` — encrypted multi-vendor API key store; cost tables (per-1k input/output tokens, per-audio-minute); per-vendor monthly caps                                                                                                                                                                                | V2.2 §8.1 ("three vendor keys, stored encrypted, CEO-controlled, AI Control meters per-vendor usage")                        |
| `000012_shared_ai.sql`        | `ai_usage_ledger`: added `audio_seconds` column; clarified `provider` semantics                                                                                                                                                                                                                                                                         | V2.2 §8.1 (Groq Whisper bills per minute, needs separate tracking)                                                           |
| `000012_shared_ai.sql`        | `ai_usage_daily`: added `vendor` to the unique key; added `audio_seconds` aggregate                                                                                                                                                                                                                                                                     | Per-vendor live spend meter on AI Control dashboard                                                                          |
| `000014_shared_triggers.sql`  | `fn_ai_usage_rollup()` updated to include `vendor` and `audio_seconds` in the daily aggregate                                                                                                                                                                                                                                                           | Matches the schema change above                                                                                              |
| `000015_shared_seed_data.sql` | Changed `praxis_voice` default_provider from `self_whisper` to `groq`, default_model unchanged                                                                                                                                                                                                                                                          | V2.2 §8.1 (Groq Whisper API replaces self-hosted)                                                                            |
| `000015_shared_seed_data.sql` | Added 3 new feature flags: `insights_weekly_report`, `insights_service_match`, `embeddings`                                                                                                                                                                                                                                                             | Module 6.30 weekly report auto-gen; service-job anti-pocketing; embeddings as a costed feature                               |
| `000015_shared_seed_data.sql` | Seeded `shared.ai_vendor_credentials` with the 3 launch vendors and current public per-token pricing                                                                                                                                                                                                                                                    | Bootstrap the multi-vendor metering                                                                                          |

### Schema-wide impact summary

- Table count: shared schema went from **101 → 104 tables**
  (added: `org_position_dotted_lines`, `ai_embeddings`, `ai_vendor_credentials`)
- Dropped columns: `ai_action_catalogue.embedding`, `ai_knowledge_chunks.embedding`
- The pgvector ivfflat index moved from being two per-source indexes
  to one unified index on `ai_embeddings.embedding`. The retrieval
  pattern is now: filter by business/permissions/sensitivity in the
  WHERE clause, ORDER BY cosine distance, LIMIT N.

### Still in the per-business templates (next files to be built)

The V2.2 changes that land in the per-business `template/*.sql.template`
files (NOT in shared) are noted here for tracking:

1. **`000018_business_payroll.sql.template`** — `commission_earned`
   table needs a `sale_channel` column (Instagram / Website / WhatsApp
   / Walk-in) per V2.2 §6.11; performance appraisal tables
   (`performance_cycles`, `performance_scores` with weighted KPIs).
2. **`000015_business_production.sql.template`** — the Faitlyn Service
   Job Tracker (`service_jobs`, `service_types` taxonomy with cost +
   turnaround + colour recipe).
3. **`000023_business_dashboards_reports.sql.template`** — saved
   weekly report templates (Sales report, Customer report) backing
   the auto-generation in `insights_weekly_report`.

These are planned for the per-business template build, not patches.

### Validation

All 16 shared migrations apply cleanly with `ON_ERROR_STOP=1` against
PostgreSQL 16 + pgvector 0.6. End-to-end test confirms:

- Embedding model versioning (two versions side-by-side, stale flag)
- Permission-scoped retrieval (array containment filter before
  vector similarity)
- All 12 spot-checks of V2.2 features pass.

---

## 2026-05-25 — Initial shared schema build

**Source:** `PixieGirl_Hub_Product_Description_V2__1_.html` (V2.1).

Initial 15-file migration set built. See the per-file headers for
scope. No prior changelog entries.
