# hub-system vs pixie-girl — File-by-File Comparison

**Goal.** Use `hub-system` as a robustness reference to solidify pixie — **not** to copy it.
This document is the evidence base for `SOLIDIFICATION_PLAN.md`: it maps every module and
shared folder in both systems, scans every file for objective robustness signals, and
records the deltas per area.

**Method.**

1. Full file census of `modules/` + `shared/` in both systems.
2. Whole-tree signal scan (idempotency, row-locking, money-float) — every file.
3. Emit/subscriber census across all 40 pixie service files + 11 subscribers.
4. Targeted reads of core infra + representative services in each cluster.

---

## Part 1 — Domain coverage map

### Modules present in both (counterparts)

| Domain            | hub-system                                          | pixie-girl                                             | Coverage note                                                                 |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Accounting        | accounting (+journal, reconciliation, reports svcs) | accounting (+bank.\*, events, subscribers)             | Parity; pixie adds bank-rec module + event hooks                              |
| Sales             | sales                                               | sales                                                  | Parity                                                                        |
| POS               | pos (+receipt, session svcs)                        | pos                                                    | Parity; pixie has `client_idempotency_key` (migration) — hub added same later |
| Invoicing         | invoicing                                           | invoicing (+subscribers)                               | Parity                                                                        |
| Stock             | stock (+movements, valuation svcs)                  | stock (+subscribers)                                   | Both trigger/movement based; see §3                                           |
| Catalogue         | catalogue (+template)                               | catalogue                                              | Parity                                                                        |
| CRM               | crm                                                 | crm                                                    | Parity                                                                        |
| Purchasing        | purchasing (+public.routes)                         | purchasing (+payables.service)                         | Parity; pixie splits payables                                                 |
| Expenses          | expenses                                            | expenses                                               | Parity                                                                        |
| Logistics         | logistics (+sign/)                                  | logistics (+tracking.routes, subscribers)              | Parity; pixie e-sign lives in shared/documents                                |
| Dashboards        | dashboards                                          | dashboards                                             | Parity                                                                        |
| Loyalty/Retention | loyalty                                             | retention (loyalty + referral + streak + hair-quiz)    | pixie broader                                                                 |
| Email/Marketing   | campaigns (builder, scheduler, tracking, public)    | email_campaigns + marketing                            | pixie splits campaign engine vs marketing                                     |
| Storefront        | sales_campaigns (admin, storefront) + store         | sales_campaigns + storefront + storefront_studio       | pixie broader (Studio CRUD)                                                   |
| Social            | social                                              | social_media                                           | Parity                                                                        |
| Retail partners   | retail-partners                                     | retail_partners                                        | Parity                                                                        |
| Settings/Setup    | settings                                            | business_setup (+provision, email-signature, webhooks) | pixie broader (in-app provisioning)                                           |

### Only in hub-system (pixie gaps — feature, not robustness)

| hub module                                                            | Notes                                                                                                                                    |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `tax`                                                                 | Standalone tax module. Pixie computes VAT inline (business_config vat_rate) — no dedicated tax-rate registry module.                     |
| `help`                                                                | Help-centre content module. No pixie equivalent.                                                                                         |
| `reports` (sales/stock/finance/payroll/purchases/attendance/delivery) | Dedicated report builders + PDF/XLSX export. Pixie has a `report-processor` queue + dashboards but **no rich report-export module yet**. |
| `discounts` (standalone)                                              | Pixie folds discounts into `sales_campaigns.discount.service` + pricing.                                                                 |
| `store.admin.routes`                                                  | Hub separates storefront admin; pixie uses storefront_studio.                                                                            |

### Only in pixie-girl (ahead of hub)

`ai_governance`, `ai_insights`, `praxis_ai` (+ `src/ai/*`), `pricing`, `service_jobs`,
`stylist_programme`, `production`, `intercompany`, `cash_request`, `storefront_studio`,
plus shared `org_workflow` (+ `src/workflows/`), `attendance`, and document **e-sign**
(`shared/documents/documents.esign.*`). These have no hub counterpart.

### Shared folders

| Domain        | hub `shared/`      | pixie `src/shared/`                               | Note                                        |
| ------------- | ------------------ | ------------------------------------------------- | ------------------------------------------- |
| Audit         | audit              | audit                                             | Parity                                      |
| Auth          | auth (+invite)     | middleware/auth + hr_payroll/auth.\*              | pixie splits staff vs (stylist) portal auth |
| Calendar      | calendar           | calendar                                          | Parity                                      |
| Contacts      | contacts (+public) | contacts (+timeline)                              | pixie adds 360 timeline                     |
| Documents     | documents          | documents (+esign suite)                          | pixie broader                               |
| Messaging     | messaging          | (module) smartcomm                                | Same domain, different home                 |
| Notifications | notifications      | notifications (+subscribers)                      | Parity                                      |
| Permissions   | permissions        | access (catalog, guards, grants, roles)           | pixie richer RBAC                           |
| Staff/HR      | staff              | hr_payroll (hr, payroll, staff, auth, commission) | pixie broader (full payroll)                |
| Tasks         | tasks              | tasks                                             | Parity                                      |
| Upload        | upload             | services/storage + media.service                  | Different home                              |
| Attendance    | — (via reports)    | attendance (+geo.calc)                            | pixie only                                  |
| Org/Workflow  | —                  | org_workflow (+workflows engine)                  | pixie only                                  |

**Takeaway:** pixie is _more_ feature-complete than hub in most domains. The gap is not
coverage — it's the engineering robustness of the wiring, which §2–§3 quantify.

---

## Part 2 — Objective signal scan (every file in `modules/` + `shared/`)

| Signal                                    | hub-system                            | pixie-girl                                     | Verdict                                                                                |
| ----------------------------------------- | ------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Files using `ON CONFLICT` (idempotency)   | 16                                    | 17                                             | Parity — but pixie's **financial consumers** (GL post on order.paid) lack it (see A-3) |
| Files using `FOR UPDATE` / `SKIP LOCKED`  | 3 (jobs, campaigns scheduler, invite) | **0** (modules, shared, jobs)                  | 🔴 **pixie gap** — no pessimistic locking anywhere                                     |
| `parseFloat` on money (anti-pattern)      | **211** occurrences                   | **0**                                          | ✅ pixie far ahead (uses `decimal.js` in 20 files)                                     |
| Centralised error handler hides SQL/stack | partial                               | **yes** (23505/23503/23514 mapped, request_id) | ✅ pixie ahead                                                                         |
| Resource singletons (pool/redis/socket)   | socket **double-init bug**            | clean single-owners                            | ✅ pixie ahead                                                                         |

---

## Part 3 — Robustness deltas by dimension

### A. Transaction integrity — 🔴 the core gap (uniform across the spine)

Emit/subscriber census (every pixie service): **40 service files emit events**; the
`order.paid` event alone has **6 subscribers** — `accounting`, `invoicing`, `logistics`,
`hr_payroll/commission`, `notifications`, `retention`. **Every one** is written as:

```js
salesEvents.on("order.paid", async ({ brand, order_id }) => {
  const order = await salesRepo.findById({ brand, id: order_id }); // NO client → pool conn
  ...
});
```

Combined with `sales.service.markPaid` emitting `order.paid` **inside** the still-open
transaction (pre-commit), this means all six consumers run on a separate connection that,
under READ COMMITTED, **cannot see the uncommitted order** → they hit `if (!order) return`
and silently skip. There is no atomicity, no commit barrier, no retry — only a swallowed
`logger.error`. Same shape for `order.deposit_met` (service_jobs), `variant.created`
(stock seed), etc. → **Plan findings A-1, A-2, A-3.**

hub-system avoids this entirely by calling consumers in-transaction on the same client.
Pixie's fix keeps the event model but makes it durable: **transactional outbox +
post-commit dispatch + idempotent consumers**.

### B. Idempotency & retries

- **Webhooks are stubs** (`business_setup/webhooks.routes.js` all `res.status(200).send()`)
  while `shared.webhook_log` already exists — hub has the full verify→log→dedup→process
  pipeline. → **B-1 / D-1.**
- **No `SKIP LOCKED` in any cron sweep** (signal scan = 0) — `email-campaign-send` runs
  every minute at concurrency 4. hub locks its campaign sweep for this exact reason.
  → **B-2.**
- In-process EventEmitter doesn't cross the web↔worker boundary → **B-3** (fixed by the
  outbox).

### C. Resource lifecycle

- `server.js` shutdown doesn't await `server.close()` (drains under teardown), exits `0`
  on crashes, no re-entrancy guard / no force-exit failsafe. hub closes inside the
  `server.close` callback + 10s failsafe. → **C-1.**
- DB pool / Redis (main+pub+sub) / Socket.io are clean single-owners — **ahead of hub**
  (whose `config/sockets.js` instantiates `io` twice and loses handlers). No change needed.
- No PDF/browser engine yet (G-7) — bank the hub lesson (one browser owner, escape tokens)
  for when it's built. → **C-2.**

### D. Security & correctness

- **Money:** ✅ pixie ahead (decimal.js, 0 float ops). D-3 is just a confirmation sweep.
- **Error handler:** ✅ pixie ahead — **D-2 resolved** (verified: never leaks SQL/stack).
- **Webhook signature verification:** 🔴 absent (folded into B-1).
- **Stock oversell under concurrency (NEW — B-4):** `stock_levels` is trigger-maintained
  from signed `stock_movements` ("never write on_hand directly"). With **0 app-level
  FOR UPDATE**, two concurrent `-sale` movements can both pass and drive `on_hand`
  negative unless the trigger/constraint blocks it. _Action: verify `fn_apply_stock_movement`
  rejects a movement that would make `on_hand < 0` (or add a CHECK / advisory lock)._
- **Public-route rate limiting (NEW — D-5):** only the global limiter + the campaign
  public route are throttled. Other unauthenticated **write** endpoints (storefront
  order-form checkout, contacts register, e-sign public submit, email/logistics tracking)
  rely on the global limit only. hub adds a dedicated `registrationRateLimiter` for public
  POSTs. _Action: per-endpoint throttle on public writes._

---

## Part 4 — Net assessment

Pixie is **more feature-complete and stricter on money + error handling** than hub-system,
and has cleaner resource singletons. Its robustness debt is concentrated and systemic
rather than scattered:

1. The event spine is non-atomic, non-durable, and emits pre-commit (A-1/A-2/A-3) — the
   single highest-value fix.
2. Inbound webhooks are unimplemented (B-1/D-1).
3. No pessimistic locking anywhere — cron sweeps (B-2) and stock oversell (B-4).
4. Shutdown ordering (C-1) and public-write throttling (D-5).

Fixing those four areas brings pixie to hub's robustness bar while keeping its superior
architecture. Severity-ordered work plan: see `SOLIDIFICATION_PLAN.md`.

---

## Part 5 — Deep dives (requested areas)

### 5.1 Messaging — `shared/messaging` (hub, 961 lines) vs `smartcomm` (pixie, 375)

**Coverage:** closer than the line counts suggest. Pixie `smartcomm` already has internal
team channels **and** external customer threads (`sendToCustomer` over WhatsApp/email,
`recordInboundFromCustomer`, `findOrCreateCustomerThread`). Hub `messaging` is larger
mainly because it inlines the full Meta/SMTP adapter bridge.

**Robustness deltas (pixie):**

- 🟠 **Outbound bypasses the durable queue.** `sendToCustomer` calls
  `whatsapp.sendText` / `email.send` **inline in the request**, then inserts the message
  row. But `worker.js` already runs `whatsapp-send` and `email-send` BullMQ queues —
  smartcomm doesn't use them. So a provider hiccup loses the message with no retry, and a
  double call double-sends (no dedup). _Fix: enqueue outbound to the existing queues
  (retry + backoff + rate-limit); record the message on enqueue, stamp `external_ref` on
  completion._
- 🟠 **`findOrCreateCustomerThread` is a racy check-then-insert** with no unique key, so
  concurrent inbound for the same `(brand, contact_id)` can create duplicate threads.
  _Fix: unique index + `ON CONFLICT DO NOTHING`/`RETURNING`._
- 🟡 **Mixed atomicity:** `sendToCustomer`/`recordInbound`/`addMember`/`addAttachment` run
  repo calls on the pool (no tx), while `createChannel`/`postMessage` use `transaction()`.
  And `postMessage`/`createChannel` emit **inside** the tx (the A-1 pattern). _Fix: wrap
  the multi-write paths; route emits post-commit (A-1/A-2)._

### 5.2 Storefront — the ERP-controlled website

**Layout:** hub = `store` (1247-line single-tenant Orika site: catalogue, cart, Paystack
checkout) + `sales_campaigns/storefront.service` (campaign landing checkout). Pixie =
`storefront` (public catalogue + order-form) + `storefront_studio` (in-ERP site builder /
CRUD) + `sales_campaigns`. Pixie's split (site **content managed from the ERP** via
storefront_studio, public read/checkout via storefront) matches the "website controlled by
the ERP" intent and is cleaner than hub's monolithic `store.service`.

**Robustness deltas (pixie public checkout, `submitOrderForm`):**

- ✅ The checkout itself is **transactional** — contact upsert + order + lines commit
  together. Good (hub does the same).
- 🟠 **No idempotency on the public order.** A double-click / network retry POSTs twice →
  two orders. Pixie already has `client_idempotency_key` on POS + sales payments
  (migrations) — the public order-form should adopt the same. _Fix: accept + enforce a
  client idempotency key on `/public/order-form`._
- 🟡 **Racy contact upsert** (`findContactByEmailOrPhone` then insert) with no unique
  constraint → duplicate contacts under concurrency. _Fix: unique on phone/email +
  `ON CONFLICT`._ (Hub has the same weakness — parity, still worth fixing.)
- 🟡 **No rate limit** on `order-form.routes` (and the other public writes) — see D-5.

### 5.3 Staff invite — hub has a model flow; **pixie has none**

Hub `shared/auth/invite.service.js` (310 lines) is exemplary: staff-only invites from a
**vetted** `staff_profiles` row, sha256-**hashed** single-use token, 1-hour expiry,
`SELECT … FOR UPDATE` on accept (no double-accept race), `ON CONFLICT DO NOTHING` on role
grants, FK-safe staff-profile linking with a legacy fallback, audit log, and soft-failed
SMTP. Grep for `invite` in pixie finds only channel/calendar invites — **there is no staff
onboarding/invite flow**. Today pixie staff are presumably created directly with a password
(no email invite, no self-set-password, no token expiry/single-use). → **Feature + security
gap F-1** (recommended build; not part of the 4 hardening batches).

### 5.4 Walk-in customers — hub self-registers; pixie only via purchase

Hub `contacts.public.routes.js` exposes a rate-limited public **walk-in self-registration**
(`POST /contacts/register/:business`) + a staff QR generator (`/register-qr/:business`):
validated input, upsert-by-phone, branded welcome email (soft-fail), manager notification.
Pixie has **no `contacts.public.routes`** and no register endpoint — a customer only becomes
a contact by going through the public **order-form** (i.e. by ordering). There is no
"register me as a customer (QR, no purchase)" capture. → **Feature gap F-2** (recommended
build; reuses the order-form's upsert logic + the throttle from D-5).

### Deep-dive summary

| Area                | Pixie state                                  | Action                                              |
| ------------------- | -------------------------------------------- | --------------------------------------------------- |
| Messaging outbound  | inline, no retry/dedup, racy thread          | route via existing queues + unique thread key (B-5) |
| Storefront checkout | transactional ✅ but no idempotency/throttle | order-form idempotency key + rate limit (A-3/D-5)   |
| Staff invite        | **missing entirely**                         | build hardened invite flow (F-1)                    |
| Walk-in register    | **missing** (order-only)                     | build rate-limited public register (F-2)            |
