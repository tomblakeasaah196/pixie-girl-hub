# Pixie Girl Hub — Backend

**Stack:** Node.js + Express + PostgreSQL 16 (+ pgvector) + Redis + Socket.io
**Status:** Skeleton scaffolding (V2.2 spec aligned, schema migrated)

This is the backend monorepo for the Pixie Girl Hub — a multi-entity ERP/CRM/E-commerce platform serving **Pixie Girl Global (PXG)** and **Faitlynhair (FLH)**.

---

## ⚠️ Building any frontend? Read the canon first (MUST READ)

The frontend look, feel, shell, and interaction are **client-approved and locked**. Before writing **any** frontend code (human or AI):

1. **`docs/FRONTEND_INSTRUCTION_MUST_READ.md`** — the **frontend SSOT / design canon** (palette, two-layer theming, shell, components, the mandatory **10-question gate** before any module). When it comes to styling, this file is final.
2. **`docs/frontend-demo/index.html`** — the **approved visual reference build** the canon describes (open in a browser).
3. **`client folder for hub-system/`** (on `main`) — the **engineering we clone and simplify**. Always confer with it.
4. **`docs/Frontend_Engineering_Guide_v2.2.md`** + **`docs/FRONTEND_SCREEN_REQUIREMENTS.md`** — per-module UI detail; **`docs/openapi.yaml`** + the migrations are field/endpoint truth.

A new chat building a module starts at the canon → asks the 10 questions → confers with hub-system + the migration/OpenAPI → builds to canon.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env
# (then fill in real values)

# 3. Provision database
npm run db:create
npm run db:migrate:shared
npm run db:bootstrap:pixiegirl
npm run db:bootstrap:faitlynhair

# 4. Seed initial data
npm run db:seed

# 5. Start dev server (with auto-reload)
npm run dev

# 6. Run tests
npm test
```

### Storefront Website (`apps/storefront`)

The customer-facing Storefront Website (TanStack Start / Nitro SSR) serves **both brands
from one process**, resolving brand per request from the Host header. Deploy details:
**`docs/STOREFRONT_DEPLOYMENT.md`**.

```bash
npm run storefront:install   # install storefront deps (apps/storefront)
npm run storefront:dev       # local dev (Vite, :3000, proxies /api → :7000)
npm run storefront:build     # production build → apps/storefront/.output
npm run storefront:start     # run the SSR server (PORT from env, prod default 3002)
```

In production it runs under PM2 as `pixie-girl-storefront` (see `ecosystem.config.js`).
It is **not** the Sales Campaign Landing (`apps/landing`, `sale.<brand>`).

---

## Project structure

```
hub-system-backend/
├── src/
│   ├── config/              # Environment, DB pool, Redis, Socket.io setup
│   ├── middleware/          # Auth, RBAC, brand-switcher, audit, error handler
│   ├── utils/               # Money, FX, dates, validation helpers
│   ├── services/            # Cross-module services (notifications, file storage, AI)
│   ├── jobs/                # Background jobs (cron, queue workers)
│   ├── routes/              # Top-level route mounting (api/v1/*)
│   ├── controllers/         # Shared/generic controllers
│   ├── validators/          # Joi/Zod schemas
│   ├── realtime/            # Socket.io rooms + event handlers
│   ├── ai/                  # Praxis AI agent, RAG pipeline, action catalogue
│   ├── workflows/           # Workflow engine (Module 6.27)
│   └── modules/             # One folder per spec module (37 modules)
│       ├── crm/             # 6.1 Customer Management
│       ├── sales/           # 6.2 Sales & Quotations
│       ├── pos/             # 6.3 Point of Sale
│       ├── storefront/      # 6.4 E-Commerce
│       └── ... (see full list in src/modules/)
├── migrations/              # 35 SQL migration files (15 shared + 20 templates)
│   └── template/            # Per-business templates substituted at bootstrap
├── scripts/                 # Bootstrap, db utility scripts
├── tests/                   # Unit, integration tests + fixtures
├── docs/                    # API docs, architectural decisions
├── media/                   # Self-hosted video & image storage (per V2.2 spec)
├── uploads/                 # Incoming user uploads (temp)
└── logs/                    # Application logs
```

### One module = one folder. Each module follows the same shape:

```
src/modules/<module-name>/
├── <module>.routes.js       # Route definitions (Express router)
├── <module>.controller.js   # HTTP handlers (request → response)
├── <module>.service.js      # Business logic (the meat)
├── <module>.repo.js         # Database queries (parameterised SQL only)
├── <module>.validator.js    # Input validation schemas
├── <module>.events.js       # Domain events emitted (for real-time + AI)
└── README.md                # Module-specific notes for developers
```

---

## Documentation

- [Architecture overview](docs/ARCHITECTURE.md) — how the pieces fit
- [Database schema](docs/SCHEMA.md) — 425 tables across `shared` + 2 brand schemas
- [API conventions](docs/API_CONVENTIONS.md) — versioning, errors, pagination
- [RBAC model](docs/RBAC.md) — 5-layer access control
- [Workflow engine](docs/WORKFLOWS.md) — Module 6.27 approval routing
- [AI/Praxis architecture](docs/AI_PRAXIS.md) — Action Catalogue, RAG, guardrails
- [Entity isolation](docs/ENTITY_ISOLATION.md) — PXG vs FLH data separation
- [Admin UI requirements](docs/ADMIN_UI_REQUIREMENTS.md) — for frontend pairing
- [Frontend screen requirements](docs/FRONTEND_SCREEN_REQUIREMENTS.md)
- [Praxis knowledge base](docs/PRAXIS_KNOWLEDGE_BASE.md) — whole-system navigation guide Praxis is trained on (see "Praxis knowledge base" governance below)
- [Deploy git auth](docs/DEPLOY_GIT_AUTH.md) — why a deploy can fail with `could not read Username for 'https://github.com'`, and how the VPS sync authenticates

---

## Conventions

### Coding

- **No ORM.** Direct `pg` queries with parameter binding. We control SQL.
- **No TypeScript** in this iteration; we use JSDoc + Zod for runtime typing.
- **Async/await everywhere.** No callbacks. No `.then()` chains.
- **Repositories are SQL only**, services are business logic, controllers are HTTP only.
- **No business logic in middleware** beyond auth/RBAC/audit/CORS.

### RBAC & module governance (keep permissions in sync)

The permission system is only trustworthy if its module list matches the modules
that actually exist. There is **one source of truth**:
[`src/shared/access/access.catalog.js`](src/shared/access/access.catalog.js)
`MODULES` — and it must always equal the distinct `requirePermission(module, …)`
keys enforced across `src/`. **Whenever you add or remove a feature, update the
RBAC in the same PR:**

1. **Adding a module** (any route gated on a new `requirePermission` key):
   - Add the key to `access.catalog.js` `MODULES`.
   - Map it in the admin nav so it hides from users without access:
     set the `permission` field on the module in
     [`apps/admin/src/lib/modules.ts`](apps/admin/src/lib/modules.ts).
   - **Seed it into the Praxis knowledge base** — add the module (route,
     permission, tabs, common tasks) to
     [`docs/PRAXIS_KNOWLEDGE_BASE.md`](docs/PRAXIS_KNOWLEDGE_BASE.md) in the
     **same PR** (see "Praxis knowledge base" governance below).
2. **Removing / renaming a module:**
   - Remove the old key from `access.catalog.js`.
   - Ship a migration that purges its rows from `shared.permissions`
     (see `migrations/000311_shared_rbac_module_reconcile.sql` for the pattern).
3. **Verify the two lists agree** — the catalog must equal:
   ```bash
   grep -rhoP 'requirePermission\(\s*"\K[a-z_]+' src/ --include="*.js" | sort -u
   ```
   `tests/unit/access/catalog.test.js` guards this; a stale catalog lets the
   Access matrix show modules that no longer exist and lets the nav leak links
   to modules a user can't open. **A feature isn't "done" until its permission
   is wired.**

   Current example: the **`goals`** module (group `workspace`) gates both
   `/api/v1/goals` and `/api/v1/notes` (Notes ride under `goals` — no separate
   key) for the AI Chief of Staff. The CoS agent itself (`/api/v1/cos/*`) is not
   a permission module — it's guarded by a `requireCeo` middleware and re-enters
   the real endpoints as the CEO, so RBAC re-applies. See `docs/RBAC.md` and
   `docs/AI_CHIEF_OF_STAFF.md`.

### Praxis knowledge base (keep it seeded)

Praxis answers "how do I… / where do I…" questions from a single trained
document: [`docs/PRAXIS_KNOWLEDGE_BASE.md`](docs/PRAXIS_KNOWLEDGE_BASE.md). It is
**generated from the live codebase** — the admin route map
([`apps/admin/src/router.tsx`](apps/admin/src/router.tsx)), the nav catalogue
([`apps/admin/src/lib/modules.ts`](apps/admin/src/lib/modules.ts)), and the RBAC
catalog ([`src/shared/access/access.catalog.js`](src/shared/access/access.catalog.js)).
If the code changes but the doc doesn't, Praxis starts handing users **dead links
and wrong instructions**. So the doc is a first-class deliverable, not an
afterthought.

**Whenever a change affects how a user navigates or acts, seed it into the
knowledge base in the SAME PR.** A change is "user-facing" (and therefore
requires a knowledge-base update) if it does any of:

- adds, removes, renames, or **re-routes** a page (anything in `router.tsx`);
- adds/removes a **module** or changes its group/permission (`modules.ts`,
  `access.catalog.js`);
- adds/removes/renames a **tab** or a primary **action button** ("New X",
  "Create X") inside a module;
- changes a **task flow** the doc describes (e.g. how a cash request is raised,
  approved, or settled);
- adds a new **public link** shape (`/o/<slug>`, `/sign/<token>`, …).

Pure backend refactors, tests, styling, and copy tweaks that don't change
navigation or task steps do **not** need a knowledge-base update.

**Seeding is automatic on deploy — you just keep the doc current.** The file is
in the RAG ingest manifest (`scripts/ai-ingest-docs.js` `MANIFEST`), so every
production deploy runs `npm run ai:reindex` (see `.github/workflows/ci.yml`),
which re-chunks `docs/PRAXIS_KNOWLEDGE_BASE.md` and re-embeds only the changed
chunks into `shared.ai_knowledge_chunks`. **Merge to `main` → Praxis re-learns
the update.** So the whole job is: **edit the doc in the same PR as the code**.

1. **Edit `docs/PRAXIS_KNOWLEDGE_BASE.md`** — update the affected module section
   (route, permission, tabs, common tasks) **and** the "How do I…" task index and
   glossary if the wording changed. Keep links as in-app paths (`/cash-requests`).
2. **Sanity-check every link resolves** to a real route:
   ```bash
   # paths referenced in the doc — each must exist in router.tsx (or be a public/param route)
   grep -oE '`/[a-z0-9/-]+`' docs/PRAXIS_KNOWLEDGE_BASE.md | tr -d '`' | sort -u
   ```
3. **New doc file?** If you split navigation knowledge into a *new* markdown,
   add it to `MANIFEST` in `scripts/ai-ingest-docs.js` too — the ingest only
   embeds whitelisted files, so an un-listed doc is invisible to Praxis.
4. **Need it live before the next deploy?** The automatic path runs at deploy
   time. For an immediate refresh without deploying, either run
   `npm run ai:reindex` on the VPS, or upload the file in-app at **AI Control →
   Knowledge & Training** (`/ai-control/training`) — that ingests it straight
   away (once per business).

Rule of thumb: **a user-facing change isn't "done" until the knowledge base doc
reflects it** — the same bar as "a feature isn't done until its permission is
wired." Because the doc is in the ingest manifest, keeping the doc right is all
it takes; the deploy re-seeds Praxis for you.

### Naming

- Files: `kebab-case.js` or `snake_case.js` (consistent within a module)
- DB tables: `snake_case` (already done in migrations)
- Functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`

### Errors

- Always throw `AppError` (or subclass) with `code`, `httpStatus`, `userMessage`
- Never leak SQL errors / stack traces to clients
- All errors logged through Pino with request correlation ID

### Real-time

- Brand-scoped rooms: `brand:{pixiegirl|faitlynhair}:<resource>`
- User-scoped: `user:{uuid}:<resource>`
- See [src/realtime/rooms.js](src/realtime/rooms.js) for the canonical list

---

## Spec compliance

This codebase implements **Pixie Girl Hub Product Description V2.2**.

Schema is at **425 tables** (107 shared + 2 × 159 per-brand) with all V2.2 invariants enforced. See `migrations/CHANGELOG.md` for the full evolution.

**Pending V2.2 amendments** (not yet in schema, see `docs/CONFORMANCE_GAPS.md`):

- Module 6.32 Cash Request & Disbursement
- Installment payment model (payment_model column + abandonment cron)
- Streak Stars + Hair Quiz tables
- UGC ingestion pipeline (replacing video embed model)
- RLS decision pending
- Several smaller spec mismatches catalogued

---

## Contact

JBS Praxis — backend team lead.
