# Praxis AI — Insights Deep Review & Build Plan

**Date:** 2026-07-04
**Reviewer scope:** Praxis AI as a whole, focused on the **Insights** layer
(V2.2 §6.30) and how it must surface on **pages and dashboards**.
**Spec anchors:** Product Description V2.2 §6.29 (Praxis Agent), §6.30 (AI
Insights & Briefings), §6.31 (AI Control), §8.1–8.5 (thin-server, orchestrator,
action catalogue, RAG).

---

## 0. TL;DR — the one-paragraph verdict

The **backend insights engine is 70% there and well-architected**; the
**frontend insights experience is ~15% there**. Tier-1 detection, the 7
category tables, the full acknowledge/resolve/dismiss lifecycle API, the
detector cron, and a deterministic daily briefing all exist and are clean. But
insights reach the user only as **two count badges on the Command Center**, and
the "View" button **dead-ends on the KPI dashboard, which has no insight list**.
There is **no Insights page, no route, no nav entry, no drill-down, and no way
to acknowledge/resolve/dismiss from the UI** — even though every one of those
endpoints already ships. Two of the seven categories (**margin, attendance**)
have **no producer at all**, Tier-2 AI narration is **deterministic-only** (no
LLM pass wired), and insight events are **not pushed to realtime**. The build
is mostly *surfacing and wiring what already exists*, not green-field work.

---

## 1. What the spec says the deliverable is (§6.30 / §6.31)

Direct from the Product Description:

> The insights layer surfaces **trends, anomalies, and recommendations on the
> dashboard**. It is built in two tiers…
> **Tier 1 — Deterministic rules** … These render as **live dashboard cards,
> badges, and a notification feed, and fire event-triggered alerts for urgent
> items** rather than waiting for a daily run.
> **Tier 2 — AI narration** … Praxis reads the summarised tier-1 findings … and
> writes the CEO a short, plain-language **Praxis Briefing**.
> Also: **auto-generated weekly reports** (replacing the Zoho/Sheet ritual).
> **OUT → dashboard insight cards · notification feed · daily Praxis Briefing.**
> **DEGRADES:** if AI is throttled/off, tier-1 cards keep working — only the
> prose briefing pauses.

§6.31 (AI Control) adds that the CEO must control: **per-category feature
toggles**, **insight frequency** (realtime/daily/weekly/off), **usage caps**,
and a **live spend meter**.

**So the target deliverable, expressed as surfaces:**

| # | Spec surface | Where it should live |
|---|---|---|
| S1 | Live **insight cards** (per category, with numbers + severity) | Every relevant domain dashboard + a dedicated Insights center |
| S2 | **Badges** (open/urgent counts) | Command Center, sidebar, module headers |
| S3 | **Notification feed** for urgent items | Bell / notifications inbox + realtime toast |
| S4 | **Event-triggered alerts** (not just the daily run) | Realtime push on detection |
| S5 | Drill-down → **list + acknowledge/resolve/dismiss** | Insights center + inline on domain cards |
| S6 | **Daily Praxis Briefing** (AI narration) | Command Center widget + Praxis + briefing history |
| S7 | **Weekly auto-reports** | Dashboard → Reports tab |
| S8 | **AI Control**: category toggles, frequency, spend meter | AI Control module |

---

## 2. Current state — BACKEND (evidence-based)

### 2.1 Data model — solid, complete (`migrations/000012_shared_ai.sql`)

17 `shared.ai_*` tables. For insights specifically, **7 concrete Tier-1 tables**,
one per category, all sharing the same lifecycle shape
(`open → acknowledged → resolved → dismissed`, `severity`, a **partial-unique
`suppression_key` while open** so a sweep never double-raises):

`ai_insight_stock_alerts`, `ai_insight_margin_breaches`,
`ai_insight_invoice_alerts`, `ai_insight_intercompany_alerts`,
`ai_insight_attendance_anomalies`, `ai_insight_approval_queue_alerts`,
`ai_insight_service_match`.

Tier-2: `ai_briefings` (+ `ai_briefing_insight_refs` for
paragraph→alert links — **currently unused**).

**Verdict:** schema is production-grade and needs no change to ship the UI.

### 2.2 Tier-1 detectors — **5 of 7 categories actually produce data**

`src/modules/ai_insights/insights.service.js` runs a detector sweep
(`runDetectorSweep`, cron `ai-insights-sweep` **every 30 min**, `worker.js:227`):

| Category | Producer | Status |
|---|---|---|
| **stock** | `src/jobs/schedulers/low-stock.js` (separate cron, twice daily) → `insights.raise` | ✅ Live |
| **invoice** | `detectInvoices` (overdue AR from `invoices`) | ✅ Live |
| **intercompany** | `detectIntercompany` (stale `intercompany_transactions`) | ✅ Live |
| **approval** | `detectApprovals` (stale `workflow_instances`) | ✅ Live |
| **service_match** | `detectServiceMatch` + `detectIntercompanyServiceJobs` (anti-pocketing, Flow-1) | ✅ Live |
| **margin** | — only `raise()`/`raiseMargin()` ingest hook; **nothing calls it** | ❌ **No producer** |
| **attendance** | — only `raise()`/`raiseAttendance()` ingest hook; **nothing calls it** | ❌ **No producer** |

> Verified: `grep` for callers of `raiseMargin`/`raiseAttendance` across
> `src/modules/pricing`, `src/modules/production`, `src/shared/attendance`,
> `src/shared/hr_payroll` returns **nothing**. The tables + hooks exist; the
> detectors were never written. Those two dashboard cards will always read zero.

**Fix owners per spec:** margin ← Pricing Engine (§6.25) / Production landed
cost (§6.24); attendance ← geofenced clock events (§6.11.1,
`staff_clock_events` + `geofences`).

### 2.3 Lifecycle API — **complete, and completely unused by the UI**

`src/modules/ai_insights/insights.routes.js` (mounted `/api/v1/insights`,
permission key `ai_insights`):

- `GET /insights/summary` — open/urgent counts per category **(the only endpoint the frontend calls)**
- `GET /insights/:category` — paged list (status/severity filters)
- `GET /insights/:category/:id` — one insight
- `POST /insights/:category/:id/acknowledge`
- `POST /insights/:category/:id/resolve` (reason)
- `POST /insights/:category/:id/dismiss`
- `POST /insights/sweep` — manual trigger

Every write is audited (`insights.service.js:56-123`). **This is a finished API
with no consumer beyond the summary counts.**

### 2.4 Tier-2 briefing — **deterministic only, LLM pass not wired**

`src/jobs/schedulers/ai-briefing.js` (daily, 07:00 Lagos) composes the briefing
as **plain templated text from the open-counts** — `provider: 'deterministic',
model: 'rules', cost 0`. That is a *correct and intentional* Tier-1 baseline
(it degrades gracefully), **but the Tier-2 AI narration the spec describes is
not implemented**: no code reads the summary and calls the LLM to write "what
changed, what it means, what to do next." The schema is ready for it
(`ai_usage_ledger.call_type = 'insight_narration'`, `ai_briefing_insight_refs`)
— it's just not built.

### 2.5 Realtime / events — **emitted but not delivered**

`insights.events.js` emits `sweep.completed` and lifecycle events, but **nothing
in `src/realtime/` subscribes them** (verified). The module's own README lists
"Wire events to Socket.io rooms" as an open TODO. So spec item **S4
(event-triggered alerts) and live-updating cards are not delivered** — the UI
would only see new insights on manual refetch.

### 2.6 Praxis chat agent (§6.29) — **strong, largely built**

Not the focus, but relevant context. `praxis.orchestrator.js` is a genuine
turn: governance gate → RAG retrieve (pgvector `ai_embeddings`) → LLM with **two
tool families** (the `ai_enabled` action catalogue for writes + the read-only
`query-agent` for live KPIs) → **writes materialise an `ai_pending_actions` row;
nothing executes without human confirmation** → every step traced to
`ai_run_steps` with real token cost. Gated by `PRAXIS_ORCHESTRATOR_ENABLED` +
a configured vendor; otherwise a graceful stub. This is better-designed than
most production AI features. The one insights-relevant miss: **the Query Agent
catalogue (`query-catalogue.js`) has no `insights_*` query**, so a CEO can't ask
Praxis "what needs my attention today?" and get the tier-1 findings.

---

## 3. Current state — FRONTEND (evidence-based)

### 3.1 The entire insights UI today = two widgets on the Command Center

`apps/admin/src/pages/CommandCenter.tsx`:

- **`InsightsAlertBar`** (lines 324-368): shows *"N urgent insights need
  attention · M other open"* from `GET /insights/summary`. Its only action is
  **`navigate("/dashboard")`**.
- **`BriefingWidget`** (lines 370-447): renders `latest_briefing.briefing_text`
  from `GET /dashboards/overview`, links to `/praxis`.

`useCommandCenter.ts` types the full 7-category `InsightSummary` and a
`urgentCount`/`openCount` helper — **but consumes only the totals**.

### 3.2 The dead-end

`InsightsAlertBar` → **`/dashboard`** → `DashboardPage.tsx`. That page is the
**domain-KPI rollup** (overview + 9 domains + global + reports). It renders **no
insight list, no insight cards, and no acknowledge/resolve controls.** So the
CEO clicks *"3 urgent insights"* → lands on revenue KPIs → **cannot see which
invoices, which stock, which service jobs** are flagged, and cannot act. This is
the single most visible gap.

### 3.3 No route, no page, no nav module

- `router.tsx`: **no `/insights` route** (searched — absent).
- `stores/nav.ts` + `lib/modules.ts`: **no `insights` module** in the catalogue
  (verified: `NO insights module in nav catalogue`). There is `praxis` and
  `ai-control`, but nothing for the insights surface.
- No `apps/admin/src/lib/insights-api.ts`. The rich lifecycle API has **zero
  client bindings**.

### 3.4 AI Control — half-built (`ai-control/AiControlPage.tsx`)

Landing shows 4 tiles: **Brand Voice** ✅ and **Vendors & Models** ✅ are built;
**Spend & budget** and **Feature flags & access** are **`ready: false`
("soon")**. So the spec's **per-category insight toggles, insight frequency
control, and live spend meter (S8) are not in the UI** — the backend governance
exists (`/ai-governance/usage/meter` is wired in `ai-governance-api.ts`), the
screens are not.

### 3.5 What *is* well-built on the AI front

- **Praxis chat**: `PraxisPage`, `ChatThread`, **`PendingActionCard`** (the
  §6.29 human-in-the-loop confirm/reject gate, with expiry countdown),
  `PraxisDrawer` (joins the `ai_pending` realtime room). The prior review's
  D-1 ("`/praxis` falls to placeholder") is **resolved**.
- **CRM AI cards** (`crm/shared/AiInsightCard.tsx`): deal summary, next actions,
  churn explainer — a *good pattern to reuse* for insight cards.
- **Dashboard shell**: 4 states (skeleton/empty/error/permission-denied),
  period picker, realtime freshness pill — the scaffolding insight cards need.

---

## 4. Gap map — "every insights aspect on pages and dashboards"

This is the core of the request: for each spec surface, where it must live and
what's missing.

| Surface | Target (spec) | Now | Gap to close |
|---|---|---|---|
| **Command Center — alert bar** | Urgent badge that routes to a real list | Badge routes to KPI dashboard (dead-end) | Point at new `/insights`; keep counts |
| **Command Center — briefing** | AI-narrated daily briefing | Deterministic text only | Wire Tier-2 LLM pass (§6.30) |
| **Insights Center (new page)** | Per-category cards + list + ack/resolve/dismiss + severity filter + drill to source record | **Does not exist** | Build page, route, nav module, API client |
| **Domain dashboards** | Each domain shows its own insight cards (stock card on Stock domain, AR card on Finance, etc.) | None | Add an `InsightStrip` to `DomainView` keyed by domain→category |
| **Module headers** | Badge on Stock / Invoicing / Service Jobs / Approvals when that module has open insights | None | Badge from `/insights/summary[category]` |
| **Notification feed** | Urgent insights appear in the bell + realtime toast | Not wired | Subscribe `insights.events` → notifications + Socket.io |
| **Realtime cards** | Cards update live on detection (event-triggered) | Refetch-only | Wire `insights.events` → `brand:{brand}:insights` room; client invalidates |
| **Praxis chat** | "What needs attention?" answers from tier-1 | No insights query | Add `insights_open` to `query-catalogue.js` |
| **AI Control** | Per-category toggle + frequency + spend meter | 2 tiles "soon" | Build governance + budget screens |
| **Reports** | Weekly auto-report | Backend `weekly-reports.js` exists; UI `ReportsView` exists | Verify wiring; connect briefing refs |
| **Detectors** | 7 categories produce | 5 produce | Build margin + attendance detectors |

---

## 5. How to build — phased plan

Ordered by **user-visible value per unit effort**. Phases 0–2 are the
high-leverage core (surface what already exists); 3–6 complete the spec.

### Phase 0 — Stop the dead-ends (0.5 day, no new backend)

1. `useCommandCenter.ts` / `CommandCenter.tsx`: route the alert-bar "View" to
   `/insights` (created in Phase 1). Interim: deep-link to the dashboard domain
   with the highest urgent count.
2. Delete or de-scope the two empty categories from the Command Center summary
   math **until** their detectors ship, so "open count" isn't inflated by
   always-zero cards. (Or leave — they read zero harmlessly.)

### Phase 1 — Insights Center page + client (2–3 days) ← **biggest win**

The endpoints already exist; this is pure frontend + nav.

1. **`apps/admin/src/lib/insights-api.ts`** — bind `summary`, `list(category)`,
   `get`, `acknowledge`, `resolve`, `dismiss`, `sweep`. TanStack Query keys
   include the active brand (canon rule). Mutations invalidate `["insights", …]`.
2. **`apps/admin/src/pages/insights/InsightsPage.tsx`** —
   - Header with total open/urgent + "Run sweep" (permission-gated `edit`).
   - **Category strip**: 7 cards (stock/margin/invoice/intercompany/attendance/
     approval/service_match) showing open + urgent, severity-toned, from
     `/insights/summary`. Reuse the `AiCard`/`KpiTile` visual language.
   - **List panel**: filter by category + status + severity; each row shows the
     human context (e.g. invoice #, ₦ amount via `MoneyText`, days overdue,
     severity pill) and **Acknowledge / Resolve (with reason) / Dismiss**
     actions inline. Four states (skeleton/empty/error/permission-denied).
   - **Drill link** to the source record (invoice → `/invoicing/:id`, stock →
     `/stock`, service_match → `/service-jobs/:id`).
3. **Route** in `router.tsx`: `{ path: "insights", element: <InsightsPage /> }`.
4. **Nav**: add an `insights` entry to `lib/modules.ts` (label "Insights",
   permission `ai_insights.view`) so it appears in the App Grid + sidebar.
5. Point Phase-0's alert bar at `/insights`.

*Acceptance:* CEO clicks the urgent badge → sees the actual flagged items →
acknowledges/resolves one → count decrements live.

### Phase 2 — Insights on the dashboards + realtime (2–3 days)

1. **`DomainView` insight strip**: map domain → category
   (`stock`→stock, `finance`→invoice+margin, `operations`→approval+service_match,
   `hr`→attendance, `intercompany`→intercompany) and render an `InsightStrip`
   card at the top of each domain that has open items, linking into the Insights
   Center pre-filtered.
2. **Realtime (backend)**: subscribe `insights.events` in `src/realtime/` →
   emit to `brand:{brand}:insights` on `sweep.completed` + each lifecycle
   change; also fan urgent detections into the **notification feed** so the bell
   lights up (spec S3/S4). Client: join the room; invalidate the insights query
   keys on message.
3. **Module header badges**: small count badge on Stock/Invoicing/Service
   Jobs/Approvals headers from the summary.

### Phase 3 — Complete detector coverage (1–2 days, backend)

1. **Margin detector** (`insights.service.detectMargins`): read Pricing/Production
   cost vs floor; raise `margin_below_floor` / `negative_margin` /
   `price_below_intercompany_min`. Add to `runDetectorSweep` + a producer call
   from the pricing publish path.
2. **Attendance detector** (`detectAttendance`): read `staff_clock_events` vs
   `geofences` for `off_site_clock_in`, plus missed clock-in/out from the HR
   attendance sweep; raise into `ai_insight_attendance_anomalies`. Hook into the
   existing `hr-attendance-sweep` cron (`worker.js`, 23:30 Lagos).

### Phase 4 — Tier-2 AI narration (1–2 days, backend + small UI)

1. New `insights.briefing.service` (or extend `ai-briefing.js`): when the AI
   feature flag `insights_briefing` is on **and** budget allows, feed the
   summarised counts (never raw rows — §8.4/§6.31 cost rule) to the LLM via
   `llm.service`, write prose into `ai_briefings` with real
   `call_type: 'insight_narration'` usage, and populate `ai_briefing_insight_refs`
   so the UI can link a paragraph to its alerts. **Keep the deterministic text
   as the fallback** (hard-cap / disabled / vendor-down → Tier-1 prose).
2. Briefing history surface: `GET /dashboards/briefings` already exists — add a
   small "Briefings" view (list + read state) or fold into the Insights Center.

### Phase 5 — AI Control: toggles, frequency, spend meter (2–3 days, frontend)

Flip the two "soon" tiles to real screens against the existing governance API:

1. **Feature flags & access**: per-category insight toggles
   (`insights_stock` … `insights_service_match`, `insights_briefing`), access
   grants, per-user caps.
2. **Insight frequency**: realtime/daily/weekly/off selector feeding the
   briefing scheduler.
3. **Spend & budget**: soft/hard caps + the live spend meter
   (`/ai-governance/usage/meter` is already wired in `ai-governance-api.ts`).

### Phase 6 — Weekly reports polish (1 day)

Backend `weekly-reports.js` + `ReportsView` exist. Verify the auto-report
content matches the §6.30 template (new leads by channel, quotes, orders
confirmed/fulfilled, deals lost with reasons, complaints/resolutions, open
follow-ups) and that "staff review & confirm" is a real state.

---

## 6. Effort & sequencing

| Phase | Value | Effort | Depends on |
|---|---|---|---|
| 0 — dead-ends | High | 0.5d | — |
| 1 — Insights Center | **Highest** | 2–3d | 0 |
| 2 — dashboard cards + realtime | High | 2–3d | 1 |
| 3 — margin/attendance detectors | Medium | 1–2d | — (parallel) |
| 4 — Tier-2 narration | Medium | 1–2d | vendor configured |
| 5 — AI Control screens | Medium | 2–3d | — (parallel) |
| 6 — weekly reports | Low | 1d | — |

**Critical path to "insights are real for the CEO": Phase 0 → 1 → 2** (≈1 week).
Everything else is parallelisable.

## 7. Risks & notes

- **Don't inflate counts** with the two dead categories until Phase 3 ships.
- **Cost discipline (§6.31):** Tier-2 must read summaries, never raw rows, and
  must respect the hard cap — Tier-1 cards must never blank when AI pauses. The
  deterministic briefing is the safety net; keep it.
- **Permission scope:** the Insights Center and cards must be
  permission-aware (`ai_insights.view`) and entity-scoped (`X-Brand-Context`);
  intercompany insights are cross-brand (no `business` column) — handle that
  category's scoping explicitly (the repo already special-cases it).
- **Reuse, don't reinvent:** the dashboard's 4-state shell, `AiCard`, `KpiTile`,
  `MoneyText`, and the Query/TanStack patterns cover 80% of the UI plumbing.

## 8. Appendix — key files

**Backend:** `src/modules/ai_insights/{insights.service,insights.repo,insights.routes}.js`,
`src/jobs/schedulers/{ai-insights-sweep,ai-briefing,low-stock,weekly-reports}.js`,
`migrations/000012_shared_ai.sql`, `src/modules/praxis_ai/*`,
`src/modules/dashboards/dashboards.service.js`.
**Frontend:** `apps/admin/src/pages/CommandCenter.tsx`,
`apps/admin/src/hooks/useCommandCenter.ts`,
`apps/admin/src/pages/dashboard/*`, `apps/admin/src/pages/ai-control/*`,
`apps/admin/src/components/praxis/*`, `apps/admin/src/lib/ai-governance-api.ts`.
**Missing (to create):** `apps/admin/src/lib/insights-api.ts`,
`apps/admin/src/pages/insights/InsightsPage.tsx`, `/insights` route + nav module,
margin/attendance detectors, Tier-2 narration service, realtime insights subscriber.
