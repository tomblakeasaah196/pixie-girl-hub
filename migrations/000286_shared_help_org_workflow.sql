-- ============================================================
-- MIGRATION 000286 — Help Center content: Org & Workflow
-- Pixie Girl Hub · V2.2 §6.27 (Org & Workflow) · §6.30 (Help Center) [PR2]
--
-- Seeds the full Org & Workflow set: overview, the org chart & roles,
-- permissions, approval workflows (definitions, thresholds, deputies),
-- the pending queue, and a FAQ.
--
-- Grounded in src/shared/org_workflow + apps/admin/src/pages/
-- OrgWorkflowPage: tabs Org Chart / Permissions / Workflows / Pending;
-- management/deputy/approval-limit; the workflow engine that gates
-- expenses, purchasing, pricing, cash, stock adjustments, etc.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('org-workflow', 'Org & Workflow',
   'Structure, roles and permissions — and the approval routing that gates sensitive actions.',
   'GitBranch', 66)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'org-overview',
  'What Org & Workflow controls',
  'Who reports to whom, who can do what, and what needs approval before it happens — the backbone that makes every other module''s controls work.',
  $md$
## What it is

**Org & Workflow** (sidebar → **Org & Workflow**, or `/org-workflow`) defines the
shape of the business and the rules that govern actions across it:

- the **org chart** — reporting lines and structure,
- **roles & permissions** — who can see and do what,
- **approval workflows** — what must be signed off before it takes effect.

When you read elsewhere that an expense, a PO, a price change or a cash request
"goes through approval," **this** is the module that decides how.

## The tabs

- **Org Chart** — the structure and reporting relationships.
- **Permissions** — what each role can do.
- **Workflows** — the approval routes.
- **Pending** — items currently waiting on approval.

## Why it's foundational

Every other module trusts these definitions. A workflow-gated write (a discount, a
disbursement, a stock adjustment) doesn't hit its target table until the approval
route here says so — which is what turns "controls" from a policy on paper into
something the software actually enforces.
$md$,
  'ceo', 'orgworkflow',
  ARRAY['org','workflow','overview','roles','approvals'], 10
FROM shared.help_categories c WHERE c.slug = 'org-workflow'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Org chart & roles ─────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'org-chart-and-roles',
  'The org chart, roles and approval limits',
  'Set the reporting structure, assign roles, and give each role an approval limit so authority matches responsibility.',
  $md$
## The org chart

The **Org Chart** captures who reports to whom. It's not decoration — reporting
lines drive **routing**: an approval can go to "the requester's manager," which
only works if the structure is defined here.

## Roles

People are assigned **roles**, and roles carry permissions and authority. The Hub
ships with seeded system roles and lets you create **custom** ones. The **CEO**
role bypasses permission checks by design; everyone else is bounded by their role.

## Approval limits, management & deputies

A role (or person) can carry an **approval limit** — the amount they're allowed to
authorise. Above it, approval escalates. You can mark **management** relationships
and assign **deputies** who can approve when the primary approver is away, so
work doesn't stall on one person's absence.

## Why it maps to real authority

Approval limits and reporting lines let authority match responsibility — a
supervisor can sign off small things, larger ones escalate to management, and
nothing waits forever because deputies cover gaps.
$md$,
  'ceo', 'orgworkflow',
  ARRAY['org','chart','roles','approval-limit','deputy'], 20
FROM shared.help_categories c WHERE c.slug = 'org-workflow'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Permissions ───────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'org-permissions',
  'Permissions: the 5 layers',
  'Access is controlled on five layers — entity, module, action, record and field — so people see exactly what their job needs and no more.',
  $md$
## The five layers

Permissions in the Hub work on **five layers**, and the **Permissions** tab is
where roles are granted them:

1. **Entity** — which business (Pixie Girl / Faitlynhair) a user can access.
2. **Module** — which modules they can see.
3. **Action** — view / create / edit / delete / approve / export, per module.
4. **Record** — scope: **all** (everything), **team** (their team's), **own**
   (only theirs).
5. **Field** — sensitive fields (cost, salary, factory origin) hidden from
   unprivileged roles.

## Why five layers, not one on/off

Real roles are nuanced: a sales lead should **edit** their **team's** deals but
not see **cost**; a cashier should **create** sales but not **approve**
discounts. Five layers express that precisely — which is why controls elsewhere
("hidden if you lack permission", "your record scope") behave the way they do.

## Enforced at the API

Permissions aren't just hidden buttons — they're enforced on the server. If a role
can't do something, the action is refused even if someone crafts the request
directly. Hiding the control is a courtesy; the API is the guard.
$md$,
  'ceo', 'orgworkflow',
  ARRAY['org','permissions','rbac','record-scope','field-security'], 30
FROM shared.help_categories c WHERE c.slug = 'org-workflow'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Approval workflows & pending ──────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'org-workflows-and-pending',
  'Approval workflows and the pending queue',
  'Define which actions need approval and who signs off, then watch and clear the pending queue — the engine that gates writes across the Hub.',
  $md$
## What a workflow is

An **approval workflow** is a rule: *this kind of action, above this threshold,
must be approved by these people, in this order.* It's data-driven — you define
it here, and modules like Expenses, Purchasing, Pricing, Cash Requests and Stock
adjustments submit to it instead of writing directly.

## What workflows can express

- **Thresholds** — approval kicks in above an amount.
- **Multi-stage** — several approvers in sequence (e.g. Finance then CEO).
- **Deputies & escalation** — cover for absence, and escalate if nobody acts.
- **Timeouts** — flag or escalate items that sit too long.

## The pending queue

The **Pending** tab shows what's currently awaiting approval. Approvers act from
here (or from the item itself). Praxis Insights flags an approval queue with items
**waiting 48+ hours** (High 96+, Critical a week+) so nothing stalls silently.

## Workflow-gated writes

The key idea: a gated write **doesn't touch its target table until approved** — it
lives as a workflow instance first. That's why a submitted discount or
disbursement is "pending," not "done": the approval, recorded here, is what makes
it real.
$md$,
  'ceo', 'orgworkflow',
  ARRAY['org','workflows','approvals','pending','thresholds','escalation'], 40
FROM shared.help_categories c WHERE c.slug = 'org-workflow'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'org-faq',
  'Org & Workflow FAQ',
  'Why something is "pending", changing who approves, the CEO bypass, record scope, and approvals that stall.',
  $md$
## "Why is my action stuck as 'pending'?"

Because it's **workflow-gated** — it needs approval before it takes effect. It's
sitting as a workflow instance until an approver acts. Check the **Pending** queue
to see who it's waiting on.

## "How do I change who approves something?"

Edit the **workflow** for that action — the approvers, order and thresholds are
defined here. Change the route and future submissions follow the new path.

## "Does the CEO need approval for anything?"

The **CEO role bypasses permission checks** by design. Approvals still exist for
the organisation's own governance, but the CEO isn't blocked by role permissions.

## "Why can't a colleague see my records?"

Their **record scope** (all / team / own) doesn't include them. Scope is set by
role on the Permissions tab — it's a deliberate boundary, not a fault.

## "An approval has been sitting for days."

Praxis flags queues waiting **48+ hours**. Use **deputies** and **escalation** in
the workflow so absence doesn't block things, and clear the Pending queue — a
stalled approval holds up everything behind it.
$md$,
  'ceo', 'orgworkflow',
  ARRAY['org','faq','pending','approvals','ceo','record-scope'], 50
FROM shared.help_categories c WHERE c.slug = 'org-workflow'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'orgworkflow'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
