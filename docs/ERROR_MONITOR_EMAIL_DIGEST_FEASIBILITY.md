# Feasibility — client-facing error monitor + daily error e-mail digest

**Status:** feasibility assessment only. Nothing built. **Date:** 2026-07-30
**Trigger:** an equivalent module ("Journal d'Erreurs") shipped for another client (Espace LPC,
PHP/MySQL) — screenshots reviewed. Ask: can the same thing work here, plus "mail the day's
downloaded errors to a configurable address as an attachment with a short note",
defaulting to `tom.asaah@jbspraxis.com`, cc `tomblakeasaah@gmail.com`, editable.

---

## Verdict

**Highly feasible, and most of it is already built.** This repo already carries a far deeper
monitoring stack than the LPC module — the **Kaizen** ops console (`src/modules/kaizen/`,
`apps/kaizen/`, Phases 0–5 per `docs/KAIZEN_BUILD_STATUS.md`). Error capture, fingerprint
grouping, PII redaction, resolve/ignore/reopen lifecycle, Markdown export, health probes,
per-route p50/p95/p99 performance rollups, backups, restore drills and e-mail alerting all
exist today.

So this is **not a new module**. It is three additions to an existing one:

| # | Addition | Size |
| - | -------- | ---- |
| A | E-mail digest — attach the day's error export, configurable recipients/cc/note | ~1 day |
| B | Small gaps in the existing errors surface — date window, hourly histogram, sort-by-frequency, local timezone | ~0.5 day |
| C | A **client-facing read-only window** so Pixie Girl's own IT/DG can see it (today Kaizen is JBS-Praxis-only) | ~1.5–2 days |
| D | *(optional)* Log-file reader — the one thing LPC does that Kaizen structurally cannot | ~1–1.5 days |
| E | *(optional)* Plain-language "what this error means" explanations | ~0.5 day static |

Minimum useful slice (A + B, Kaizen-only, no client access): **~1.5 days.**
Full LPC parity + client window: **~4–6 days.**

---

## 0. Decisions locked (2026-07-30, Tom)

1. **Kaizen is deployed and in active use** on the VPS. No deploy work needed — Phase 1 below
   ships value the moment it merges.
2. **Client-facing surface: yes** — a read-only page inside the admin app (Option 1 in §2).
   Their IT/DG get visibility; resolve / ignore / reopen stay JBS-only.
3. **Log-file reader: yes** (item D) — including the "is logging still alive?" panel.

Two smaller calls taken as sensible defaults rather than sent back as questions:

4. **Digest trigger: both** — the daily scheduler *and* a "Mail today's report" button. The button
   is needed to test the scheduler anyway, so it's free.
5. **Scope: platform-wide, clearly labelled.** Kaizen is deliberately not brand-scoped, and
   `kaizen_error_groups` has no brand column (only occurrences do), so brand-filtering the group
   list would be misleading. The client page shows whole-platform data with an explicit label.

**Total: ~5 days across three independently deployable phases.** See §5.

**No new tables are strictly required.** `shared.kaizen_settings` (key/value JSONB, migration
`000321`) already stores config exactly like `alerts.recipients` does. One small ledger table
for digest sends is recommended but optional.

---

## 1. Feature-by-feature map: LPC → Pixie Girl Hub

| LPC "Journal d'Erreurs" | Here today | Gap |
| --- | --- | --- |
| Reads server `error_log` files, groups by message + file + line | **Different (better) architecture** — captured in-app at 4 points into `shared.kaizen_error_groups`, grouped by fingerprint (`errors.fingerprint.js`) | Structured, richer (request_id, route, brand, opaque user ref, HTTP status). But it only sees errors that reach the app — see §3 |
| Window control (64 KB tail) | n/a — DB-backed, not file-tailed | Only relevant if we add D |
| 24h total / unique signatures / total in window | `occurrence_count`, group count | **No date window** on the list/export query (`errors.repo.js:94`) |
| Log size tile | n/a | Comes with D |
| "État de la journalisation" — warns when no log writes in N hours, per-file size + last write, disk free | Disk free exists (`health.service.js` `probeDisk`). The "is logging itself alive?" panel does **not** | Comes with D |
| Errors-per-hour bar chart (24h) | Data exists (`kaizen_error_occurrences.occurred_at`); no endpoint | Small addition (B) |
| Level badge + count + file:line + first→last seen | Severity, count, first/last seen, route pattern, status lifecycle — all present, richer | No `file:line` as a first-class field (we carry route + stack instead) |
| Plain-language explanation of each error | Not present | Optional E — and with Praxis/LLM available we can do better than LPC's static map |
| Filter box / level filter | `status`, `severity`, `source`, `q` (`errors.validator.js`) | Present |
| Sort most recent / most frequent | Hard-coded `ORDER BY last_seen_at DESC` | Add `sort=frequency` (B) |
| "Cacher" (hide) | `ignore` / `resolve` / `reopen`, all audited | Present, better |
| Download | `GET /api/v1/kaizen/errors/export` → Markdown attachment; button wired in `apps/kaizen/src/pages/ErrorsPage.tsx` | Present |
| **Mail the day's errors as an attachment + note, configurable** | **Not built** | **A — the real new work** |
| — | Kaizen also has: health probes, p50/p95/p99 per route, backups, weekly restore drills, alert rules with dedupe | We are ahead of LPC here, not behind |

---

## 2. Who is allowed to see it — **decided: Option 1**

At LPC the monitor lives **inside the client's own admin app** ("Espace LPC" → Administration & RH
→ Journal d'Erreurs), visible to their DG. Here, Kaizen is deliberately walled off from client
staff:

- Operators live in `shared.kaizen_operators`, **separate** from `shared.users`
- Separate JWT secret + `aud: "kaizen"` claim — a platform token can never authenticate a Kaizen
  route (`src/modules/kaizen/README.md`)
- Served on its own subdomain, behind Cloudflare Access scoped to `@jbspraxis.com`
- `kaizen` is **not** in `src/shared/access/access.catalog.js` and has **no** admin-app route

So Pixie Girl staff have **zero visibility today**. Three ways to change that — **Option 1 chosen**:

**✅ Option 1 — read-only window in the admin app (chosen; matches LPC).**
New module key `system_monitor` in the access catalog + `apps/admin/src/lib/modules.ts` (group
`system`, next to `platform_settings` / `audit`), a new platform-authed read-only controller that
calls the existing Kaizen services, and one page with the four mandated states. Client IT sees
health, performance, error groups and can trigger/receive the digest — but **cannot** resolve,
ignore or reopen (that stays a JBS action), and gets a **redacted** view (see §4).
Requires: catalog + nav + `docs/PRAXIS_KNOWLEDGE_BASE.md` update in the same PR (CLAUDE.md rule).

*Option 2 — a Kaizen operator account for their IT lead.* Rejected: breaks the JBS/client identity
boundary, hands them resolve/ignore powers and full stack traces, and needs the Cloudflare Access
policy widened beyond `@jbspraxis.com`.

*Option 3 — digest only, no UI.* Not the destination, but note it is a **strict subset** of
Option 1 — which is why Phase 1 below delivers exactly that, and Phase 3 adds the page on top.

---

## 3. Architecture note: we should probably do both kinds of capture

Kaizen captures errors **in-app** (`errors.capture.js`, wired into the error handler, process-level
handlers, and the BullMQ `failed` listener). That is strictly better data than scraping a log file
— but it has a blind spot: **anything that never reaches the app's error handler.**

Not captured today: PM2 restart loops, boot/startup failures, OOM kills, segfaults, native crashes,
nginx-level 502s, and anything a dependency writes straight to stderr. LPC's crude file-tail
*does* catch those, and its "no log writes in 8.7 h — either the app served no failing requests or
logging has stopped" panel is exactly the self-check we lack. That panel is the single most
valuable idea to copy.

PM2 already writes what we'd read (`ecosystem.config.js`): `logs/error.log`, `logs/out.log`, plus
`landing-`, `storefront-`, `stylist-` variants under `/var/www/pixie-girl-hub/logs/`.

⚠️ **Related finding, independent of this feature: there is no logrotate config anywhere in the
repo** (no `logrotate`, no `pm2-logrotate` in `ops/` or the deploy docs). Those four apps' logs grow
unbounded on the VPS. Worth fixing regardless of what we decide here — and it's the reason LPC's
"log size" tile earns its place.

---

## 4. Risks and constraints

1. **Leaking internals to client staff.** Stack traces expose file paths, SQL, table names;
   occurrence `context` can hold semi-sensitive values despite `errors.redact.js` `scrub()`.
   → If we do Option 1, the client view must be group-level only: title, severity, count, route,
   first/last seen, status. **No stack, no context, no request bodies.** Enforce it in the
   controller, not the UI.
2. **Log-file reading (only if D).** Paths must come from env (`KAIZEN_LOG_PATHS`), never from user
   input — otherwise it's a path-traversal read primitive. Tail a bounded window (LPC uses 64 KB);
   never read whole files. nginx logs under `/var/log/nginx/` need group perms or ACLs — recommend
   leaving them out of v1.
3. **E-mail deliverability.** `email.service.js` `send()` already supports `attachments`
   (`resolveAttachments`, line ~243), and `alerts.service.js` is the working precedent. But SMTP is
   brand-scoped; a daily attachment from the brand's transactional sender to a Gmail address is a
   plausible spam-folder candidate. Run `npm run smtp:doctor` and consider a dedicated ops sender.
4. **Retention limits the "day" window.** The hourly maintenance tick prunes occurrences at
   **30 days / 200 per group** (`kaizen-maintenance-tick.js`). Today's digest is always safe;
   back-dated digests beyond 30 days would be group-level only.
5. **Export cap.** `listGroupsForExport` caps at 1000 groups — fine for a day, worth noting.
6. **Timezone.** `errors.export.js` hard-codes UTC. LPC shows local (Africa/Douala); ours should
   read Africa/Lagos. `date-fns-tz` is already a dependency.
7. **Attachment format.** Current export is Markdown — ideal for pasting into a fix ticket or
   feeding to Claude, less so for a DG skimming on a phone. Suggest sending **both** a `.md` and a
   flat `.csv`, or adding a small HTML summary in the mail body with the file attached.
8. **Is Kaizen actually deployed?** `docs/KAIZEN_BUILD_STATUS.md` still lists the deploy checklist
   as outstanding ("origin IP still needed from Tom"). **If Kaizen isn't live on the VPS yet, that
   is the cheapest first step by a wide margin** — it makes the existing 80% visible before we
   write a line of new code.

---

## 5. Build plan — three independently deployable phases

Everything lands inside the existing Kaizen module shape. No new backend module scaffold; the one
new *platform* module is the RBAC/nav key for the client page in Phase 3.

### Phase 1 — digest + errors-surface gaps (~1.5 days)

Ships the whole ask minus the client page. Deployable on its own, and since Kaizen is already live
it's visible immediately.

```
src/modules/kaizen/errors/
  errors.digest.js          NEW  build + send the digest (compose, attach, record run)
  errors.export.js          EDIT csv builder; Africa/Lagos timestamps (drop hard-coded UTC)
  errors.repo.js            EDIT date window (from/to); sort=frequency; hourly histogram query
  errors.validator.js       EDIT from/to/sort on listQuery; digest config schema
  errors.controller.js      EDIT GET /stats/hourly; POST /digest/send-now; GET+PATCH /digest/config
src/jobs/schedulers/
  kaizen-error-digest.js    NEW  daily 07:00 Africa/Lagos, under withCronLock
src/jobs/worker.js          EDIT register the scheduler
apps/kaizen/src/pages/
  ErrorsPage.tsx            EDIT date range, hourly histogram, sort toggle, "Mail today's report"
  SettingsPage.tsx          EDIT digest config (to / cc / subject / note / send time / on-off)
migrations/
  0003XX_shared_kaizen_digest_runs.sql   NEW (small, optional-but-recommended send ledger)
```

### Phase 2 — log-file reader + logging health (~1.5 days)

The blind-spot fix from §3. Kaizen-only for the raw tail (see the security note below).

```
src/modules/kaizen/logs/
  logs.service.js           NEW  bounded tail, parse Pino JSON lines w/ raw fallback, group
  logs.controller.js        NEW  GET /logs/health, GET /logs/tail
apps/kaizen/src/pages/
  LogsPage.tsx              NEW  "État de la journalisation" equivalent + grouped tail
  OverviewPage.tsx          EDIT logging-alive tile
ops/
  pm2-logrotate.md          NEW  fix the unbounded-log finding from §3
```

- Paths from env only: `KAIZEN_LOG_PATHS` (comma list, defaulted from `ecosystem.config.js`),
  `KAIZEN_LOG_TAIL_BYTES` (default `65536` — matches LPC's 64 KB window).
- The client **selects a file by key/index, never by path**. No path ever crosses the wire.
- Read with `createReadStream` from `size - tailBytes`; never load a whole file.
- Production logs are Pino JSON lines → parse as JSON, fall back to the raw line for PM2 prefixes
  and native crash output (which is exactly the stuff we're here to catch).
- ⚠️ **Raw log tail stays JBS-only.** Unredacted stderr can contain anything — a connection string
  inside a stack, a token in a dependency's error dump. The client page (Phase 3) gets the
  *logging-health* panel (alive / size / last write / disk free), not the log contents.

### Phase 3 — client-facing read-only page (~2 days)

```
src/shared/access/access.catalog.js   EDIT new module key `system_monitor` (group: system)
src/modules/kaizen/client/
  client-view.controller.js  NEW  platform-authed, read-only, redacted projection
  client-view.service.js     NEW  calls existing errors/health/perf/logs services
src/routes/index.js          EDIT mount inside the platform api router
apps/admin/src/lib/modules.ts        EDIT nav entry, permission: "system_monitor"
apps/admin/src/router.tsx            EDIT route /system-monitor
apps/admin/src/pages/system-monitor/ NEW  page + four mandated states
docs/PRAXIS_KNOWLEDGE_BASE.md        EDIT ← required in the same PR (CLAUDE.md rule)
```

- Guarded by `authMiddleware` + `requirePermission("system_monitor", "view")`. CEO bypasses.
- **Read-only enforced in the controller, not the UI** — no resolve/ignore/reopen route exists on
  this surface at all.
- **Redacted projection, also enforced server-side:** title, severity, count, route pattern,
  first/last seen, status. No stack, no occurrence `context`, no request bodies (§4.1).
- Frontend follows the design canon — run the 10-question gate in
  `docs/FRONTEND_INSTRUCTION_MUST_READ.md` first; tokens not hexes; loading / empty / error+retry /
  permission-denied on every panel.
- Also needs: seed the new permission rows, and label the page "whole platform" per decision #5.

**Suggested order: 1 → 2 → 3.** Phase 1 alone satisfies the original request (the daily mail to
`tom.asaah@jbspraxis.com`, cc `tomblakeasaah@gmail.com`); 2 and 3 widen coverage and audience.

**Config** goes in `shared.kaizen_settings` under `errors.digest` — no migration needed:

```json
{
  "enabled": true,
  "to": ["tom.asaah@jbspraxis.com"],
  "cc": ["tomblakeasaah@gmail.com"],
  "subject": "Pixie Girl Hub — error report {date}",
  "note": "Attached is today's error report from the Hub.",
  "send_at": "07:00",
  "timezone": "Africa/Lagos",
  "formats": ["md", "csv"],
  "skip_when_empty": true
}
```

Defaults exactly as requested, fully editable from the Settings screen — same pattern as
`alerts.recipients` (`settings.service.js`), which already reads/writes this store.

Optional tiny migration if we want an audit trail of sends:
`shared.kaizen_digest_runs (run_id, sent_at, window_start, window_end, group_count, recipients, status, error)`.
Recommended — it answers "did the client actually get Tuesday's report?" without digging in mail logs.

`skip_when_empty` matters: a zero-error day should send nothing (or a one-line "all clear"),
otherwise the daily mail becomes noise and gets filtered.

---

## 6. Still open

All five scope questions are settled in §0. What remains is operational, and none of it blocks
Phase 1:

1. **Which role(s) get `system_monitor` view?** Presumably the DG/CEO plus whoever acts as their IT
   contact. Needs a name or a role so the permission gets seeded to something real (Phase 3).
2. **Digest send time** — plan is 07:00 Africa/Lagos. Confirm, or name another hour.
3. **SMTP deliverability check before we rely on the digest.** A daily attachment from the brand's
   transactional sender to a Gmail address is a plausible spam-folder candidate. Run
   `npm run smtp:doctor` on the VPS; if SPF/DKIM is shaky for that recipient pair, consider a
   dedicated ops sender (§4.3).
4. **Zero-error days** — plan is `skip_when_empty: true` with no mail at all. If you'd rather have a
   daily "all clear" as a heartbeat (proof the digest itself is still running), say so — it's a
   one-line flag either way.
