-- ============================================================
-- MIGRATION 000290 — Help Center content: Praxis AI
-- Pixie Girl Hub · V2.2 §6.31 (Praxis) · §6.30 (Help Center)  [PR3]
--
-- Populates the existing (previously-empty) 'praxis' category with the
-- full Praxis set: overview, asking Praxis & grounding, actions the agent
-- can take (permission-inheriting, confirm-gated), and a FAQ.
--
-- Grounded in src/modules/praxis_ai + apps/admin/src/pages/praxis: tabs
-- Pending / Trace / Abilities; actions catalogue, pending-actions
-- (confirm), conversations + steps; RAG grounded in ai_knowledge_chunks
-- (which now includes all Help articles).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

-- The 'praxis' category already exists (000214). Upsert is a safe no-op.
INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('praxis', 'Praxis AI',
   'How to ask Praxis for help, how it grounds its answers, and the actions it can take for you.',
   'Sparkles', 60)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'praxis-overview',
  'What Praxis is',
  'Your in-Hub agent: ask it questions in plain language and, with your confirmation, have it take actions — always within your own permissions.',
  $md$
## What it is

**Praxis** is the Hub's AI agent. Open it from the **floating launcher** on any
screen or at **`/praxis`**. You can ask it questions in plain language ("what
needs my attention?", "how does layaway work?") and, for things that change data,
have it **take actions** on your behalf — with a confirmation step.

## The two things it does

1. **Answers** — grounded in your live data and in the Hub's own documentation
   (including every Help Center article), so answers are specific to *your*
   business, not generic.
2. **Actions** — it can do things you could do yourself (raise a draft, pull a
   number), always **within your own permissions** and, for anything that
   matters, only after you **confirm**.

## The tabs

- **Pending** — actions Praxis has prepared that are waiting for your confirm.
- **Trace** — the run steps of what it did, so you can see its working.
- **Abilities** — the catalogue of actions it can perform.

## Permission-inheriting

Praxis can never do more than *you* can. If your role can't approve a discount,
neither can Praxis on your behalf. It inherits your permissions exactly — the
same API guards apply.
$md$,
  'all', 'praxis',
  ARRAY['praxis','ai','overview','agent'], 10
FROM shared.help_categories c WHERE c.slug = 'praxis'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Asking Praxis & grounding ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'praxis-asking-and-grounding',
  'Asking Praxis and how it grounds answers',
  'Ask in plain language; Praxis answers from your live data and the Help Center, and it only ever reads what your permissions allow.',
  $md$
## Just ask

Type a question the way you'd ask a colleague:

- *"What needs my attention today?"* — live insight counts.
- *"Why can't my staff start a WhatsApp chat?"* — grounded in the messaging
  guides.
- *"How do part-payments work?"* — grounded in the Sales/Invoicing help.

## How it grounds answers (RAG)

Praxis doesn't make things up from thin air. It retrieves relevant **knowledge
chunks** — including **every Help Center article** — and answers from them. That's
why the Help Center and Praxis agree: they read the **same source text**. When you
write or edit a help article, Praxis can cite it.

## It respects your permissions and entity

A question is answered for your **active business** and within your **permissions**
— Praxis won't surface a figure or a record you're not allowed to see. Reading is
read-only: asking never changes anything.

## Cost

Chatting to Praxis uses your AI budget (metered in AI Control). Grounded retrieval
keeps answers accurate and short, which keeps cost low — and the hard cap in AI
Control is the master brake.
$md$,
  'all', 'praxis',
  ARRAY['praxis','ask','rag','grounding','permissions'], 20
FROM shared.help_categories c WHERE c.slug = 'praxis'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Actions ───────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'praxis-actions',
  'Letting Praxis take actions (safely)',
  'Praxis can prepare actions from its ability catalogue and run them — but sensitive ones wait for your confirmation, and every step is traceable.',
  $md$
## The ability catalogue

The **Abilities** tab lists what Praxis can actually *do* — the catalogue of
actions it's allowed to perform (governed in AI Control). It can only take actions
that are in the catalogue *and* that your permissions allow.

## Confirm-gated

For anything that changes data or matters, Praxis prepares the action and puts it
in **Pending** for you to **confirm** before it runs. You stay in control — Praxis
proposes, you approve. Nothing sensitive happens silently.

## Trace

The **Trace** tab shows the **run steps** — what Praxis did, in order, streamed
live. If it took an action, you can see exactly how, which makes it auditable
rather than a black box.

## Guardrails

What Praxis may do, which vendors and models it uses, and its spending are all
governed in **AI Control**. Praxis operates inside those guardrails plus your own
permissions — two independent limits, so it's safe by construction.
$md$,
  'ceo', 'praxis',
  ARRAY['praxis','actions','confirm','trace','abilities','guardrails'], 30
FROM shared.help_categories c WHERE c.slug = 'praxis'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'praxis-faq',
  'Praxis FAQ',
  'Can it see everything, will it act without asking, where its answers come from, cost, and turning it off.',
  $md$
## "Can Praxis see everything in the business?"

No — it inherits **your** permissions and is scoped to your **active business**.
It can't surface a record or figure you couldn't open yourself.

## "Will it do things without asking me?"

Sensitive actions are **confirm-gated** — Praxis prepares them and waits for your
confirmation in **Pending**. You approve before anything meaningful happens.

## "Where do its answers come from?"

From your live data plus the Hub's knowledge base — **including every Help Center
article**. That's why Praxis and the Help Center give the same answers: same
source.

## "How much does using Praxis cost?"

It uses your AI budget, metered in **AI Control** under the relevant feature, and
stopped by the monthly hard cap. Grounded, concise answers keep the cost small.

## "Can I limit or turn it off?"

Yes — **AI Control** governs its abilities, vendors, models and spend, and its
feature flags. You decide what it may do and how much it may spend.
$md$,
  'all', 'praxis',
  ARRAY['praxis','faq','permissions','confirm','cost','ai-control'], 40
FROM shared.help_categories c WHERE c.slug = 'praxis'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles WHERE related_module='praxis';
-- expected: 4 rows
-- ============================================================
