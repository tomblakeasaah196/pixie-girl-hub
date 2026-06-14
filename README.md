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

---

## Conventions

### Coding

- **No ORM.** Direct `pg` queries with parameter binding. We control SQL.
- **No TypeScript** in this iteration; we use JSDoc + Zod for runtime typing.
- **Async/await everywhere.** No callbacks. No `.then()` chains.
- **Repositories are SQL only**, services are business logic, controllers are HTTP only.
- **No business logic in middleware** beyond auth/RBAC/audit/CORS.

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
