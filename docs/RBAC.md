# Role-Based Access Control

V2.2 §3 defines a **five-layer** access model:

1. **Entity isolation** — which company (PXG / FLH) you can see
2. **Module-level** — which modules you can open
3. **Action-level** — within a module, what verbs you can use (view/create/edit/delete/approve/export)
4. **Record-level** — which records you can act on (all / team / own)
5. **Field-level** — within a record, which fields you can see (cost, salary, factory origin hidden from most roles)

## How it lives in the schema

```sql
shared.roles                Role templates (Sales Rep, Manager, CEO, etc.)
shared.user_roles           Users assigned to roles
shared.user_business_access Which brands a user can act on
shared.permissions          (role, module, action, record_scope, allowed)
shared.permission_module_keys  The 36 canonical module keys (org_workflow, sales, ...)
shared.org_positions        Approval thresholds + deputy flags
shared.workflow_definitions Approval routing for actions that need it
```

## How it lives in code

```js
router.post(
  "/orders",
  authMiddleware, // verifies JWT → req.user
  brandContextMiddleware, // resolves req.brand
  requirePermission("sales", "create"), // checks permission, sets req.permission_scope
  validator.validateCreate, // Zod schema
  controller.create,
);
```

The `requirePermission` middleware:

- Bypasses CEO (req.user.is_ceo === true)
- Otherwise looks up permission rows for user's role IDs
- Sets `req.permission_scope` to the most permissive of: 'all' / 'team' / 'own'
- 403s if no grants exist

## Record scope ('own' / 'team') is enforced in the repo

The middleware only knows whether the user has ANY permission at the module × action level. Whether they can act on **this specific record** depends on the record's owner/team — which only the repo can check. So:

```js
async function findById({ brand, id, scope, user_id }) {
  let where = "WHERE order_id = $1";
  const params = [id];
  if (scope === "own") {
    where += " AND created_by = $2";
    params.push(user_id);
  } else if (scope === "team") {
    where += ` AND created_by IN (
      SELECT user_id FROM shared.team_members WHERE team_id IN (
        SELECT team_id FROM shared.team_members WHERE user_id = $2
      )
    )`;
    params.push(user_id);
  }
  // ...
}
```

### Worked example — Stylist Studio (`service_jobs`)

The `service_jobs` module runs a strict own/all split:

| Role          | Actions kept                                       | Scope |
| ------------- | -------------------------------------------------- | ----- |
| `tech_stylist`| view, create, edit                                 | `own` |
| `ops_mgr`     | view, create, edit, delete, approve, export        | `all` |
| CEO / owner   | everything                                         | (bypass) |

An `own`-scope stylist can only see + act on jobs they are **currently
assigned to** OR were **ever a stylist on** (kept visible via the
`wig_custody_ledger` — so their scorecard history survives reassignment).
`getJob` throws `NO_LONGER_ASSIGNED` with the current assignee's display
name when a stylist opens a stale link to a reassigned job, so the UI can
render "reassigned to X → back to my jobs" instead of a bare 403.

Seeded by migration `000348_shared_stylist_studio_rbac_own_scope.sql`.

### Worked example — Expenses (`expenses`) & Cash Requests

Both the **Expenses** (§6.7) and **Cash Request** (§6.32) modules share the one
`expenses` permission key, and their read visibility is **approve-gated** rather
than driven by the record scope on the `view` grant:

| Can `approve` the module? | Sees on lists / detail |
| ------------------------- | ---------------------- |
| Yes (or CEO)              | the whole brand's queue (`all`) |
| No — `view` only          | only records they submitted (`own`) |

Why not the plain record scope? Because `expenses` was seeded to several roles
at `partial_team` (view at scope `team`), and `team` was never implemented in
these modules' queries — it fell through to "no filter", so team/junior staff
could see cash requests and expenses raised by colleagues. Binding visibility to
the **approve capability** makes "who can see the queue" match "who acts on it",
and is robust to mis-seeded scopes.

- **Enforced by `middleware/rbac.js` `approveGatedScope('expenses')`**, mounted
  **after** `requirePermission('expenses','view')` on every read route (list,
  detail, KPIs, advances, receipts, documents, history). It overrides
  `req.permission_scope` to `all` (holder of an `approve` grant, or CEO) or
  `own` (everyone else). List queries then filter `submitted_by` /
  `requested_by`; single-record reads 404 a record the caller doesn't own — so a
  stray id can't confirm a record exists. Creating/editing your **own** request
  is unaffected (those routes gate on `create`/`edit`, not `view`).

## Field-level privacy

Currently **app-layer only** (see CONFORMANCE_GAPS.md — H-1 / M-5). Sensitive fields (cost prices, factory origin, salaries) are filtered out in the service layer before response serialisation, based on the user's role. A pending amendment will back this with restricted views + column GRANTs at the DB level.

## Contact-type visibility (Contacts §6.12)

The `contacts` module carries an extra, contacts-specific scoping dimension on top of record scope: a per-role allow-list of **contact types** a role may see (`customer`, `supplier`, `staff`, `retail_partner`, `stylist_partner` — the values in `shared.contacts.contact_type[]`). This lets the owner separate the directory — e.g. supplier-facing / operations staff who deal with the China manufacturers see only suppliers, never the client book.

- **Storage:** `shared.role_contact_type_access(role_id, contact_types[])`. **No row = unrestricted** (the role sees every type — the default, so nothing changes until a role is opted in). A row restricts the role to its listed types (empty array = sees no contacts).
- **Effective per user = the union across their brand-active roles** (mirrors record scope's "most permissive wins"): any unrestricted role widens access to everything, so to lock a person down, restrict every role they hold — or give restricted staff only the restricted role. **CEO bypasses** (sees all).
- **Enforced in the repo**, like `own`/`team`: `middleware/rbac.js` `contactTypeScope` resolves the caller's allowed set into `req.contact_type_scope` (cached via identity-cache), and `contacts.repo` adds a `contact_type && $allowed` guard to list / get / stats / milestones. A contact outside the set reads as **404**, never revealing it exists. Writes (create / update / import) can't give a contact a type the caller can't see. Bulk export stays owner/CEO-only (unrestricted).
- **Praxis** inherits it automatically — it acts with the requesting user's permissions, and the enforcement lives below the service boundary the agent calls.

Administered from **IAM → Org & Workflow → the role editor** (a "Contact visibility" control) via `GET/PUT /access/roles/:role_id/contact-types`.

## CEO bypass

`req.user.is_ceo === true` short-circuits permission checks. The CEO sees everything by design. This is the V2.2 contract — the CEO doesn't need to grant themselves rights, they just have them.

## Workflow-gated actions

Some actions don't have a simple "allowed/denied" — they require an approval workflow. For example:

- Expenses above ₦200,000 require manager approval
- Price changes require CEO approval
- Cash disbursements above ₦20,000 require CEO approval

These are NOT checked in `requirePermission`. Instead, the service layer detects the threshold and opens a `workflow_instance`. The user can submit the request, but it sits in pending until approval. See `WORKFLOWS.md`.

---

## Administration surface (`/api/v1/access`)

RBAC is administered by the **Access** module (`src/modules/access/`), gated on
the `settings` permission (the owner/CEO bypasses). It is the only supported way
to create roles, edit the role→permission matrix, grant/revoke roles, and set a
user's brand access — the middleware otherwise only _reads_ permissions.

| Area              | Endpoint                                                                     |
| ----------------- | ---------------------------------------------------------------------------- |
| Catalog           | `GET /access/catalog`                                                        |
| Roles             | `GET/POST /access/roles`, `…/roles/:role_id`                                 |
| Permission matrix | `GET/PUT /access/roles/:role_id/permissions`                                 |
| Contact visibility | `GET/PUT /access/roles/:role_id/contact-types` (Contacts §6.12)             |
| Grants            | `GET/POST /access/users/:user_id/roles`, `DELETE …/roles/:role_id?business=` |
| Brand access      | `GET/PUT /access/users/:user_id/access`                                      |

**Catalog = enforcement vocabulary.** The matrix is built from the module keys
the routes actually enforce (`org_workflow`, `sales_campaigns`, `hr_payroll`, …),
harvested in `access.catalog.js`. The abbreviated keys in the
`shared.permissions` schema comment (`workflow`, `campaigns`, `staff`) are NOT
the enforced keys; permission writes are validated against the catalog so the
table can't drift from what `requirePermission` checks. (Note: the
`000015_shared_seed_data.sql` owner seed still uses some abbreviated keys — the
owner bypasses, so it works for the owner, but non-owner roles should be granted
against catalog keys.)

**Escalation guards.** A delegated `settings` admin cannot delete system roles,
modify system roles or their permissions, or grant/revoke the `owner` role; and
the last active owner cannot be revoked. Only the owner/CEO can do these.

**Live effect.** The middleware reads `shared.permissions` with no cache, so
matrix/grant changes apply on the user's next request.

## The `goals` module (AI Chief of Staff)

The Chief of Staff feature adds one catalog module, **`goals`** (group
`workspace`), enforcing `view` / `create` / `edit` / `delete`. It gates both the
`/api/v1/goals` and `/api/v1/notes` routes — **Notes ride under `goals`** rather
than carrying their own key. Seeded to the executive tier (owner/admin/manager)
at `all` scope in migration `000322`; notes are additionally **owner-scoped**
(`own`) in the repo.

The CoS **agent** (`/api/v1/cos/*`) is not a permission module — it is guarded
by a **`requireCeo`** middleware for v1 (`req.user.is_ceo`). It never bypasses
RBAC: its executor re-enters the real `/goals`, `/tasks`, `/calendar`, `/notes`
endpoints over loopback **as the CEO**, so `requirePermission` re-applies on
every write. The `goals` module exists so the surface can open to execs later
without a rework. See `docs/AI_CHIEF_OF_STAFF.md`.
