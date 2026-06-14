# Run / Test Order

Run on a real machine or CI — **not** the dev sandbox (its file mount truncates
fresh files, which breaks `node`/`jest`/`git`). Prereqs:

- Copy `.env.example` → `.env` and fill `DB_*`, `JWT_SECRET`, `SESSION_SECRET`,
  `ENCRYPTION_KEY` (the rest can stay default).
- Postgres (pgvector image) + Redis running.
- `DB_USER` should be a **non-superuser** role for RLS to actually apply (see §1.4).

> Env-var-prefixed commands below use bash/git-bash syntax. On **PowerShell** use
> `$env:RUN_DB_TESTS="1"; npm run test:integration` instead of the inline form.

## 1. Static checks (no DB)

```
npm ci
npm run lint
npm run test:unit
```

`test:unit` is the verified suite (money, payroll, geofence, RBAC vocab, bundles,
password reset, Praxis query agent) — should be fully green with no DB.

## 2. Provision the database

```
npm run db:create
npm run db:migrate:shared
npm run db:bootstrap:pixiegirl
npm run db:bootstrap:faitlynhair
npm run db:verify
```

## 3. Create the first admin (CEO / owner)

```
npm run db:create-admin -- --email you@example.com --password 'Secret123' --name "Faith" --business pixiegirl
```

(or just `npm run db:create-admin` and answer the prompts). The `--` passes the
flags through npm.

## 4. Smoke test + DB-backed integration tests

```
npm run smoke
RUN_DB_TESTS=1 npm run test:integration
```

Integration suites (opt-in via `RUN_DB_TESTS=1`): GL balances, the §3 access
matrix, and entity isolation (provisions a throwaway non-superuser role to prove
RLS filters). `smoke` also prints per-role permission counts and bootstrapped
schemas.

## 5. Whole suite at once (unit + integration)

```
RUN_DB_TESTS=1 npm test
```

## 6. Optional / credential-gated

```
npm run check:integrations          # report which external integrations are configured (no network calls)
npm run rag:reembed                 # build the Praxis RAG corpus — needs EMBEDDINGS_PROVIDER + EMBEDDINGS_API_KEY
psql "$DATABASE_URL" -f scripts/rls/force-rls.sql      # close the table-owner RLS bypass (review first; staging)
psql "$DATABASE_URL" -f scripts/dedup/contacts-unique.sql   # inspect duplicate contacts before adding the unique index
```

## 7. New-business provisioning (verify the generic bootstrap)

```
node scripts/bootstrap-business.js --key watches --display-name "Hub Watches" --legal-name "Hub Watches Ltd" --prefix WTC
npm run db:verify
```

It should create a `watches` schema with the full table set + seeded document
numbering/COA/fiscal period, and appear active in `shared.business_config`.

## 8. Boot end-to-end (manual)

```
npm start              # API server (terminal 1)
npm run workers:start  # queues + crons (terminal 2)
# then: GET http://localhost:7000/health   -> { ok: true }
```

## Reset between runs

```
npm run db:reset       # drop + recreate; then repeat from §2
```

---

### What "green" looks like

- §1 lint clean, all unit tests pass.
- §2 `db:verify` reports the expected table counts for both brands.
- §4 `smoke` PASSES; the three integration suites pass (GL balanced, Sales Rep
  denied accounting/payroll, a brand context sees only its own rows).
- §3 you can log in as the CEO and reach both brands.
