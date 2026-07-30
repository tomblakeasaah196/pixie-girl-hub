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

## 2. The pivotal decision: who is allowed to see it

This is the only genuinely architectural question, and it needs Tom's call before any build.

At LPC the monitor lives **inside the client's own admin app** ("Espace LPC" → Administration & RH
→ Journal d'Erreurs), visible to their DG. Here, Kaizen is deliberately walled off from client
staff:

- Operators live in `shared.kaizen_operators`, **separate** from `shared.users`
- Separate JWT secret + `aud: "kaizen"` claim — a platform token can never authenticate a Kaizen
  route (`src/modules/kaizen/README.md`)
- Served on its own subdomain, behind Cloudflare Access scoped to `@jbspraxis.com`
- `kaizen` is **not** in `src/shared/access/access.catalog.js` and has **no** admin-app route

So Pixie Girl staff have **zero visibility today**. Three ways to change that:

**Option 1 — read-only window in the admin app (recommended; matches LPC).**
New module key `system_monitor` in the access catalog + `apps/admin/src/lib/modules.ts` (group
`system`, next to `platform_settings` / `audit`), a new platform-authed read-only controller that
calls the existing Kaizen services, and one page with the four mandated states. Client IT sees
health, performance, error groups and can trigger/receive the digest — but **cannot** resolve,
ignore or reopen (that stays a JBS action), and gets a **redacted** view (see §4).
Requires: catalog + nav + `docs/PRAXIS_KNOWLEDGE_BASE.md` update in the same PR (CLAUDE.md rule).

**Option 2 — give their IT lead a Kaizen operator account.** Near-zero build. But it breaks the
JBS/client identity boundary, hands them resolve/ignore powers and full stacks, and Cloudflare
Access is currently `@jbspraxis.com`-only so the policy would have to be widened.

**Option 3 — digest only, no UI for them.** Cheapest (A alone). They receive the daily mail and
liaise from that; no console access. Good interim step, and it is a strict subset of Option 1.

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

## 5. Sketch of the build (for when we green-light)

Everything lands inside the existing module shape; no new module scaffold.

```
src/modules/kaizen/errors/
  errors.digest.js          NEW  build + send the digest (compose, attach, record)
  errors.export.js          EDIT csv builder; Africa/Lagos timestamps
  errors.repo.js            EDIT date window (from/to); sort=frequency; hourly histogram query
  errors.validator.js       EDIT from/to/sort on listQuery; digest config schema
  errors.controller.js      EDIT GET /stats/hourly; POST /digest/send-now; GET/PATCH /digest/config
src/jobs/schedulers/
  kaizen-error-digest.js    NEW  daily ~07:00 Africa/Lagos, under withCronLock
apps/kaizen/src/pages/
  ErrorsPage.tsx            EDIT date range, histogram, sort toggle, "Mail today's report"
  SettingsPage.tsx          EDIT digest config (to / cc / subject / note / schedule / on-off)
```

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

## 6. Decisions needed from Tom

1. **Who sees the console** — Option 1 (read-only window in the admin app), 2 (Kaizen operator
   account for their IT lead), or 3 (digest only, no UI)?
2. **Digest trigger** — automatic daily, on-demand button only, or both?
3. **Add the log-file reader (D)?** It's the only way to catch crashes that never reach the app,
   and it brings the "is logging still alive?" panel.
4. **Is Kaizen live on the VPS?** If not, finishing that deploy comes first.
5. **Per-brand or whole-platform?** Kaizen is deliberately platform-wide (not brand-scoped). A
   client-facing view inside the brand-scoped admin app raises the question of whether Faitlynhair
   staff should see Pixie Girl's errors. Recommend: platform-wide, gated on the new permission,
   with a clear "whole platform" label.
