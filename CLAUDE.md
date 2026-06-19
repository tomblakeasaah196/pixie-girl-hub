# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pixie Girl Hub — a multi-entity ERP/CRM/E-commerce platform serving two Nigerian companies (Pixie Girl Global + Faitlynhair) from one codebase. Single Node.js backend (Express + PostgreSQL 16 + Redis + Socket.io) with a React admin frontend. No ORM — raw parameterised SQL throughout. 425 tables across 3 schemas (`shared`, `pixiegirl`, `faitlynhair`). Implements the Pixie Girl Hub Product Description V2.2 spec.

## Commands

### Backend (root)

```bash
npm install                        # install backend deps
npm run dev                        # start backend with nodemon (port from .env, default 7000)
npm start                          # production start
npm test                           # all unit tests (Jest)
npm run test:unit                  # unit tests only
npm run test:integration           # integration tests (requires RUN_DB_TESTS=1 + live DB)
npx jest tests/unit/utils/money.test.js          # run a single test file
npx jest tests/unit/utils/money.test.js -t "name" # run a single test by name
npm run lint                       # eslint src/
npm run lint:fix                   # eslint autofix
npm run format                     # prettier
npm run smoke                      # smoke test (needs live DB + migrations)
npm run workers:start              # BullMQ worker process
```

### Database provisioning (sequential)

```bash
npm run db:create
npm run db:migrate:shared
npm run db:bootstrap:pixiegirl
npm run db:bootstrap:faitlynhair
npm run db:seed
npm run db:verify                  # confirms 425 tables
npm run db:repair                  # rebuild missing brand tables
npm run user:create-admin          # create admin user
```

### Admin frontend (`apps/admin/`)

```bash
cd apps/admin && npm install
npm run dev                        # Vite dev server on http://localhost:5173
npm run build                      # tsc -b && vite build
npm run lint                       # eslint ts,tsx
```

The Vite dev server proxies `/api/*` and `/media/*` to `localhost:7000` (the backend). Override with `VITE_API_PROXY_TARGET`.

### Hub-system reference client (`client folder for hub-system/`)

This is the **engineering reference** — a full-featured client to clone and simplify. Port 3000. Has its own `package.json`. Path aliases: `@/`, `@components/`, `@pages/`, `@hooks/`, `@services/`, `@stores/`, `@utils/`, `@lib/`, `@assets/`, `@types/`, `@typedefs/`.

## Architecture

### Backend module pattern

Every module lives in `src/modules/<name>/` with a fixed file shape:

- `<mod>.routes.js` — Express router, mounted under `/api/v1/<module>`
- `<mod>.controller.js` — thin HTTP handlers (req/res only, no business logic)
- `<mod>.service.js` — business logic, transactions, event emission, audit
- `<mod>.repo.js` — parameterised SQL only; honours permission scope (`all`/`team`/`own`)
- `<mod>.validator.js` — Zod input schemas
- `<mod>.events.js` — domain events (Socket.io + AI + audit subscribe to these)

Controllers never call repos directly. Services never touch `req`/`res`. Repos never emit events.

### Request lifecycle

```
HTTP → helmet/cors/compression/request-id → authMiddleware (JWT → req.user)
→ brandContextMiddleware (X-Brand-Context → req.brand) → requirePermission (→ req.permission_scope)
→ validator (Zod parse) → controller → service (transaction + repo + events + audit) → JSON response
```

### Data isolation

Three PostgreSQL schemas in one database. `shared.*` (107 tables) holds identity, contacts, audit, AI, intercompany, access matrix, workflows. `pixiegirl.*` and `faitlynhair.*` (159 tables each) are identical in structure, completely separate in data. Every query uses `req.brand` to select the schema. No RLS yet — isolation is enforced at the application layer via brand context middleware.

### Cross-module services (`src/services/`)

Shared infra: storage, email, WhatsApp, SMS, PDF, encryption, LLM, embeddings, media processing, payment gateways (Paystack/Opay/Nomba/Stripe), FX rates, numbering (document sequences).

### Workflow engine (`src/workflows/`)

Data-driven approval routing via `workflow_definitions` → `workflow_instances` → `workflow_decisions`. Used by expenses, purchasing, sales discounts, pricing changes, intercompany, campaigns. Supports thresholds, multi-stage, timeouts, deputies, escalation.

### AI layer (`src/ai/`)

Praxis AI agent: LLM orchestrator + RAG pipeline + action catalogue. Permission-inheriting — the AI can only do what the requesting user can do. Usage metered per brand.

### Background jobs (`src/jobs/`)

BullMQ queues + node-cron schedulers. Run in a separate worker process (`npm run workers:start`) or in-process during dev.

### Real-time (`src/realtime/`)

Socket.io with Redis adapter. Rooms: `brand:{pixiegirl|faitlynhair}:<resource>`, `user:{uuid}:<resource>`. Events flow from `<mod>.events.js` → Socket.io rooms (controllers never emit directly).

## Frontend architecture (admin app)

### Design canon (mandatory — read `docs/FRONTEND_INSTRUCTION_MUST_READ.md`)

Before building any frontend module, you **must** run the 10-question gate defined in the canon. The three companions to always open together:

1. `docs/FRONTEND_INSTRUCTION_MUST_READ.md` — design system SSOT
2. `docs/frontend-demo/index.html` — approved visual reference
3. `client folder for hub-system/` — engineering reference to clone and simplify

Field/endpoint truth: migration SQL → `docs/openapi.yaml` → `docs/Frontend_Engineering_Guide_v2.2.md`.

### Key rules

- **Palette "Maroon Noir"**: dark default with deep-red accent `#690909`. Two-layer theming (Layer A = platform skin, Layer B = business tint). Never inline a hex, font, or radius — use CSS variable tokens.
- **Glassmorphism** on all overlays, dropdowns, drawers, menus.
- **Typography**: Playfair Display (headings/numerals), Montserrat (body), JetBrains Mono (money figures).
- **Entity scope on every API call** via `X-Brand-Context` header and TanStack Query keys.
- **Money via `MoneyText`** component — NGN-based, never recompute history with live FX rate.
- **Permission-aware rendering** — hide controls the user lacks permission for; the API enforces.
- **Four states on every screen**: loading skeleton, empty (with CTA), error (with retry), permission-denied.
- **Workflow-gated writes** submit to `workflow_instances`, not target tables; show the approval chain before submit.
- **Mobile-first**, then desktop. PWA standards.

### State management

- **Client state**: Zustand stores (`auth`, `business`, `ui`, `nav`)
- **Server state**: TanStack Query v5 (entity-scope in every query key; mutations invalidate)
- **Auth tokens**: access token in memory, refresh in httpOnly cookie — never localStorage

### Path alias

`@/` maps to `apps/admin/src/` (configured in `vite.config.ts` and `tsconfig.json`).

## Conventions

- **No ORM.** Direct `pg` queries with parameter binding.
- **No TypeScript on backend**; JSDoc + Zod for runtime typing. Frontend is TypeScript.
- **Async/await everywhere.** No callbacks, no `.then()` chains.
- **Errors**: throw `AppError` with `code`, `httpStatus`, `userMessage`. Never leak SQL/stack traces.
- **Naming**: files `kebab-case.js` or `snake_case.js` (consistent within module), DB tables `snake_case`, functions `camelCase`, constants `SCREAMING_SNAKE_CASE`.
- **Money**: use `decimal.js` for arithmetic, always 2dp, strings in API payloads.
- **IDs**: UUIDv4 everywhere. Dates: ISO 8601.
- **Logging**: Pino with request correlation ID (`X-Request-Id`).

## Key documentation

- `docs/ARCHITECTURE.md` — system design, request lifecycle, security
- `docs/SCHEMA.md` — all 425 tables
- `docs/API_CONVENTIONS.md` — REST contract, headers, errors, pagination, money format
- `docs/RBAC.md` — 5-layer access (entity → module → action → record → field)
- `docs/WORKFLOWS.md` — workflow engine internals
- `docs/AI_PRAXIS.md` — Praxis AI agent, RAG, guardrails
- `docs/ENTITY_ISOLATION.md` — schema-per-business design
- `docs/CONFORMANCE_GAPS.md` — pending V2.2 spec items
- `docs/FRONTEND_SCREEN_REQUIREMENTS.md` — per-module UI detail
- `docs/Frontend_Engineering_Guide_v2.2.md` — screens, tables, states per module
- `docs/openapi.yaml` — full OpenAPI spec (413KB)
- `docs/PRODUCTION_READINESS_AND_ARCHITECTURE_AUDIT.md` — comprehensive audit

## RBAC model (5 layers)

1. **Entity** — which business (PXG/FLH) the user can access
2. **Module** — which of the 37 modules they can see
3. **Action** — view/create/edit/delete/approve/export per module
4. **Record** — scope: `all` (everything), `team` (their team), `own` (their records)
5. **Field** — cost, salary, factory origin hidden from non-privileged roles

CEO role bypasses permission checks. 23 seeded system roles; custom roles are creatable. Middleware: `requirePermission(module, action)` sets `req.permission_scope`.

## Migrations

15 shared migrations in `migrations/` + 20 brand-template migrations in `migrations/template/` (placeholder `__SCHEMA__` substituted at bootstrap). Migrations run as a one-shot pre-deploy job, never auto on boot.
