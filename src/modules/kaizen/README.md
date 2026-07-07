# Kaizen module (backend)

JBS Praxis maintenance / operations console for Pixie Girl Hub, served at
`kaizen.pixiegirlglobal.com`. See the full spec in
`docs/KAIZEN_MAINTENANCE_DASHBOARD_IMPLEMENTATION_GUIDE.md`.

## Access boundary (important)

Kaizen operators live in `shared.kaizen_operators` — **completely separate**
from the client's platform users (`shared.users`). Kaizen uses a **distinct JWT
secret** (`KAIZEN_JWT_SECRET`) and an `aud: "kaizen"` claim, so a platform token
can never authenticate a Kaizen route and vice-versa. There is **no internal
RBAC** — every active operator is a full admin — but every mutation is
audit-logged (`shared.kaizen_audit_log`) and destructive actions are guarded.

The router is mounted **outside** the brand-scoped `api` router in
`src/routes/index.js` (no `X-Brand-Context` required).

## Phase 0 (this PR)

- Migration `000301_shared_kaizen_operators.sql` — operators, invites, sessions,
  audit log.
- `auth/` — login, refresh (rotating), logout, `me`, change-password, and
  invite acceptance. Access token (30 min) in the JSON body; refresh token in an
  httpOnly/Secure/SameSite=Strict cookie scoped to `/api/v1/kaizen/auth`.
- `operators/` — list, invite-by-email (emails the link **and** returns it as a
  copy-paste fallback), guarded disable.
- `GET /system/summary` — small live snapshot for the Overview screen.
- Seed script: `node scripts/kaizen-create-operator.js` (password via
  env/prompt — never committed; `must_change_password` forces a rotation).

## Later phases (not in this PR)

Errors (capture + fingerprint + resolve/auto-reopen), health, performance,
backups (rclone/restic) + restore drills, alerts. The frontend already lays
these out as "coming soon".

## Endpoints (Phase 0)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/v1/kaizen/auth/login` | — | email + password → access token + refresh cookie |
| POST | `/api/v1/kaizen/auth/refresh` | refresh cookie | rotate tokens |
| POST | `/api/v1/kaizen/auth/logout` | — | revoke session |
| POST | `/api/v1/kaizen/auth/accept-invite` | — | `{ token, password }` → activate |
| GET | `/api/v1/kaizen/auth/me` | operator | current operator |
| POST | `/api/v1/kaizen/auth/change-password` | operator | `{ current_password, new_password }` |
| GET | `/api/v1/kaizen/operators` | operator | list operators |
| POST | `/api/v1/kaizen/operators/invite` | operator | `{ email, display_name? }` |
| POST | `/api/v1/kaizen/operators/:id/disable` | operator | `{ confirm: true }` (guarded) |
| GET | `/api/v1/kaizen/system/summary` | operator | version/node/uptime/operator |
