-- ============================================================
-- MIGRATION 000258 — Help Center content: Praxis Insights (complete guide)
-- Pixie Girl Hub · JBS Praxis · V2.2 §6.30 / §6.31
--
-- Seeds the DB-backed Help Center (shared.help_categories /
-- shared.help_articles, from 000214) with the full Praxis Insights
-- documentation set: overview, getting started, the Insights Center,
-- AI Control & spend, the complete 27-module detector reference, briefings
-- & asking Praxis, and a troubleshooting FAQ.
--
-- Articles are praxis_indexed (default true), so this content also feeds
-- Praxis retrieval — asking Praxis "how do insights work?" answers from here.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING. Re-runs are no-ops.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('insights', 'Praxis Insights',
   'Proactive alerts across every module — what they watch, what they cost, and how to act on them.',
   'Lightbulb', 45)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'insights-overview',
  'What Praxis Insights are (and what they cost)',
  'The always-on early-warning layer: rules watch every module and flag what needs attention — free by default.',
  $md$
## What Praxis Insights are

Praxis Insights is the Hub's **early-warning layer**. Instead of you (or your
staff) remembering to check every module for problems, the system watches the
live data and raises a **flag** when something needs attention — an invoice
gone overdue, stock at its reorder point, a paid order that hasn't shipped, a
stylist payout that failed, a customer message waiting too long.

Every flag carries:

- a **severity** — Low, Medium, High, or Critical (High + Critical = "urgent"),
- a plain-language **headline** (and the amount, where money is involved),
- a **View** link that jumps straight to the record it's about,
- lifecycle actions — **Acknowledge**, **Resolve** (with a note), **Dismiss**.

## The two tiers (why it's affordable)

**Tier 1 — Rules (free, always on).** Plain database rules detect the facts:
no AI tokens, no hallucination risk, zero cost. This is what raises every flag
you see. Detection runs automatically every **30 minutes** (stock is checked
at 08:00 and 14:00), and you can trigger a scan yourself at any time.

**Tier 2 — AI narration (optional, small cost).** Each morning at **07:00**
Praxis can read the *summarised* findings — never your raw records — and write
you a short plain-language briefing: what changed, what it means, what to look
at first. This uses your monthly AI budget, is **off by default for every
module**, and you switch it on per module in AI Control. If it's off, the
budget is exhausted, or the AI vendor is unreachable, you still get a
deterministic (rule-written) briefing — the system never goes blank.

## Where insights appear

1. **On the module's own page** — a "Praxis insights" card at the top of
   Invoicing, Stock, Purchasing, Logistics, CRM and every other covered module.
   The card only appears when that module is enabled *and* has open findings —
   otherwise it stays out of the way.
2. **The Insights Center** (sidebar → **Insights**, or `/insights`) — every
   open finding across the business in one filterable list.
3. **The Command Center** — an alert bar with the urgent count, plus the daily
   Praxis Briefing widget.
4. **The notification bell** — new High/Critical findings ping the CEO's
   notifications (and phone, if push is enabled) the moment they're detected.
5. **Praxis chat** — ask *"what needs my attention?"* and get the live counts.

Everything updates **in real time**: when a scan finds something new, or
someone resolves a flag, every open screen refreshes on its own.

## The one-line cost promise

Rules are free and always on. AI narration runs **only** where you switch it
on, **only** within your monthly budget, and stops at the hard cap while the
rules keep working. Enabling insights on a module can never surprise you with
a bill.
$md$,
  'all', 'ai_insights',
  ARRAY['insights','alerts','praxis','overview','tiers','cost'], 10
FROM shared.help_categories c WHERE c.slug = 'insights'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Getting started: switching modules on/off ─────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'insights-getting-started',
  'Switching insights on or off per module',
  'AI Control → Insights is the switchboard: pick exactly which modules Praxis watches, and which get AI narration.',
  $md$
## The switchboard: AI Control → Insights

Go to **AI Control → Insights** (`/ai-control/insights`). You'll see all
**27 modules** in one matrix, each with three controls:

| Control | What it does | Cost |
|---|---|---|
| **Insights** | Turns the module's Tier-1 rule detection on/off. Off = the scanner skips the module completely — no queries run, no flags raised, the card disappears from its page. | Free either way |
| **Narration** | Includes this module in the AI-written morning briefing. Only selectable when Insights is on. | Uses AI budget |
| **Frequency** | How eagerly the briefing treats this module: Real-time / Daily / Weekly / Off. | — |

Beside each row you'll see the module's **live open count**, so you can see
what a toggle affects before you flip it.

## Defaults (nothing runs until you say so)

Out of the box only the five original watchdogs are on — **Stock, Invoicing,
Inter-company, Approvals and Service Jobs**. The other 22 modules ship with
detection built but **switched off**. Narration is **off for all 27**. That
means:

- Turning a module **on** starts free rule-detection within 30 minutes.
- Turning **Narration** on is the only action that adds AI spend — and even
  that is capped by your monthly budget (see the AI Control & spend article).

## First-time checklist

1. Open **AI Control → Insights** and switch on the modules you want watched.
2. Open the **Insights Center** (`/insights`) and press **Run scan** to get
   findings immediately instead of waiting for the next 30-minute cycle.
3. Work the list: **View** to jump to the record, then **Resolve** when
   handled. Anything that fixes itself in the data (an invoice gets paid, a
   delivery lands) is closed for you automatically on the next scan.
4. When you're comfortable, switch **Narration** on for the handful of modules
   you want in the morning briefing.

## Turning things off to cut spend

- Flip **Narration** off on a module → it drops out of the AI briefing; the
  free rules keep running.
- Flip **Insights** off → the module is skipped entirely. Its already-open
  flags remain visible in the Insights Center until you resolve or dismiss
  them, but nothing new is raised.
- The monthly **hard cap** (AI Control → Spend) is the master brake: when
  reached, all paid AI pauses gracefully; every Tier-1 rule keeps running.
$md$,
  'ceo', 'ai_insights',
  ARRAY['insights','ai-control','enable','disable','spend','setup'], 20
FROM shared.help_categories c WHERE c.slug = 'insights'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. The Insights Center ───────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'insights-center-guide',
  'Using the Insights Center',
  'One filterable list of every open finding — severity, filters, lifecycle actions and drill-through.',
  $md$
## Opening it

Sidebar → **Insights** (`/insights`), or tap **View** on the Command Center's
urgent-alert bar. The header shows the total open and urgent counts for the
active business.

## Reading the screen

- **Module chips** across the top — one per module that currently has open
  findings, with its count (red-tinted when any are urgent). Tap a chip to
  filter to that module; **All** clears it.
- **Status filter** — Open / Acknowledged / Resolved / Dismissed. Open is the
  default working view.
- **Severity filter** — narrow to Critical, High, Medium or Low.
- Each row shows the severity pill, the headline, the amount (for money
  findings), how long ago it was detected, and a **View** link that opens the
  exact record (the invoice, the order, the delivery, the deal…).

The list is sorted worst-first (Critical → Low, newest first within a level).

## Acting on a finding

| Action | Meaning | When to use |
|---|---|---|
| **Acknowledge** | "Seen it — working on it." Keeps it in view, stops it reading as brand-new. | You've delegated it or started on it |
| **Resolve** | "Handled." Optionally add a note (kept for the record). | The underlying issue is fixed |
| **Dismiss** | "Not relevant / accepted risk." | False positives or deliberate exceptions |

Every action is **audited** — who did what, when, and any note — so a resolved
flag is a record, not a deletion.

### Auto-resolve (the list cleans itself)

If a finding's underlying condition clears in the data — the overdue invoice
gets paid, the delivery arrives, the stalled deal moves stage — the next scan
**resolves it automatically** with the note *"Auto-resolved: condition
cleared."* You only ever handle things that are still genuinely wrong.
(Dismissed items are never reopened or touched.)

## Run scan

**Run scan** (top right, needs edit permission) triggers the full detection
cycle immediately instead of waiting for the next 30-minute run — useful right
after you've fixed a batch of issues or enabled a new module.

## Live updates

The Center and every module-page card are connected to the real-time feed:
new findings, acknowledgements and resolutions from any user or any scan
appear without refreshing the page.

## Who can see and do what

- **View** requires the `ai_insights` view permission (the CEO always has it;
  Operations, Finance and Marketing manager roles have read access by default).
- **Acknowledge / Resolve / Dismiss / Run scan** require `ai_insights` edit.
- Everything is scoped to the **active business** — switching the entity chip
  switches the findings. (Inter-company findings, which belong to both
  companies, appear under either.)
$md$,
  'all', 'ai_insights',
  ARRAY['insights','center','filters','acknowledge','resolve','dismiss','audit'], 30
FROM shared.help_categories c WHERE c.slug = 'insights'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. AI Control & spend ────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'insights-ai-control-spend',
  'Controlling AI spend on insights',
  'Narration is opt-in per module, metered per call, and hard-capped by the monthly budget — rules stay free.',
  $md$
## What actually costs money

Only **Tier-2 narration** — the AI-written morning briefing — spends anything.
Everything else in the insights system (detection, the Center, cards, badges,
notifications, auto-resolve) is deterministic SQL and costs **₦0** in AI fees,
forever, regardless of how many modules you enable.

A narration call costs roughly **₦1–3** depending on the model configured in
AI Control → Vendors & Models. One briefing per business per day is the normal
cadence — a few hundred naira a month even with everything switched on.

## The three layers of control

1. **Per module** — AI Control → Insights → the **Narration** toggle. Praxis
   narrates only modules you've opted in. None are on by default.
2. **Per feature** — the *AI Daily Briefing* feature flag (AI Control →
   Feature flags). Off = no narration anywhere, one switch.
3. **The budget** — AI Control → Spend & budget sets the monthly **soft cap**
   (you get warned) and **hard cap** (all paid AI pauses). Every narration call
   is written to the usage ledger with its real token count and cost, so the
   **live spend meter** always shows where the month's budget went, by feature
   and by vendor.

## What happens at the hard cap

Paid AI stops *gracefully*: narration skips and the morning briefing switches
to its deterministic (rule-written) text. **No Tier-1 rule stops.** Cards,
alerts, the bell, auto-resolve — all keep running. When a new budget month
opens (or you raise the cap), narration resumes on its own.

## What happens with no AI vendor configured

Same graceful behaviour: the system detects there's no usable vendor and keeps
producing the deterministic briefing. You can run the entire insights system
without ever entering an API key.

## Reading the meter

AI Control shows the current month's spend against both caps, plus per-day and
per-feature breakdowns. Narration appears under the feature key
**insights_briefing** with call type *insight narration* — so you can see its
exact share of the budget at any time.
$md$,
  'ceo', 'ai_insights',
  ARRAY['insights','spend','budget','narration','caps','meter','vendors'], 40
FROM shared.help_categories c WHERE c.slug = 'insights'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. The complete detector reference ───────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'insights-detector-reference',
  'Detector reference: what every module watches',
  'All 27 modules — the exact conditions that raise a flag, how severity is decided, and where each one drills.',
  $md$
## How to read this

Each module below lists the **conditions** its rules watch, how **severity**
escalates, and where **View** takes you. Detection runs every **30 minutes**
(stock at 08:00 & 14:00) for modules switched on in AI Control → Insights.
"Urgent" = High or Critical (these ping the notification bell when new).

---

### Money & selling

**Invoicing** — an invoice past its due date and not fully paid.
Severity: Low under 30 days overdue · Medium 30+ · High 60+ · Critical 90+.
View → the invoice.

**Sales** — an order **paid but not dispatched** for more than 3 days.
Medium 3+ days · High 7+ · Critical 14+. View → the order.

**Pricing** — a variant **selling below cost** on *any* channel (storefront,
POS, wholesale, partner), or below its price floor on the storefront.
Below floor: Medium. Below cost: High (Critical when more than 10% below
cost). View → Pricing.

**Storefront** — a **checkout payment failed** in the last 7 days.
High within 24 hours, Medium after. View → the order.

**Sales Campaigns** — a campaign still **live past its end time**, or
**scheduled but never launched**. Medium. View → the campaign.

**Marketing** — an active ad campaign that spent **over ₦5,000 in 7 days with
zero conversions**. High from ₦50,000. View → Marketing.

**Retail Partners** — a consignment settlement **disputed**, or approved /
invoiced but **unpaid for 7+ days** (High from 30 days or when disputed).
View → Retail Partners.

### Operations & fulfilment

**Stock** — a variant at or below its **reorder point** (Medium; High when
stock is under half the reorder point; Critical at zero), and **negative
stock** (a count below zero — a data-integrity red flag, always Critical).
Checked at 08:00 and 14:00. View → Stock.

**Purchasing** — a PO past its **expected delivery date** and not received
(Medium · High 14+ days late · Critical 30+), and a PO **submitted for
approval but untouched for 7+ days** (High from 14). View → Purchasing.

**Logistics** — a delivery **failed / lost / damaged / returned** (High;
lost or damaged = Critical), or an in-flight delivery **past its expected
time** (Medium; High past 48 hours). View → Logistics.

**Production** — a run past its **expected arrival date** and not yet
received (Medium · High 7+ · Critical 14+ days late). View → Production.

**Catalogue** — a product **visible on the storefront with no active, priced
variant** (customers can see it but can't buy it). Medium. View → the product.

**Service Jobs (anti-pocketing)** — a completed styling job with **no linked
sale** (High when the expected amount is ₦50,000+), and a cross-entity job
with **no inter-company invoice**. View → the job.

### People & relationships

**CRM** — an open deal **stuck in the same stage 14+ days** (High from 30).
View → the deal.

**Retention** — a customer whose churn-risk score is **High or Critical** —
your win-back list. View → the customer profile.

**Smart Comm** — a customer thread whose **last message is from the customer,
unanswered for 4+ hours** (High past 24). View → the conversation.

**Customer Onboarding** — a submission **never linked to a contact** after
2 days (Medium after a week). View → Contacts.

**Attendance** — an **off-site clock-in** in the last 7 days (High when over
1 km from the geofence). View → HR.

**Payroll** — a staff contract **expiring within 30 days** (High within 7).
View → Payroll.

**Stylist Programme** — a stylist payout **approved/processing but unpaid for
3+ days** (High from 14) or **failed** (High). Cross-company. View → Stylists.

**Tasks** — a task **past its due date** and not done (High when its priority
is Urgent). View → Workspace.

### Finance & governance

**Accounting** — a **draft journal entry unposted for 7+ days** (High from
30) — the books aren't closing. View → Accounting.

**Expenses** — a cash advance flagged **overdue for settlement**, or disbursed
and **unsettled for 14+ days** (High from 30 or when overdue). View → Expenses.

**Inter-company** — a cross-company transaction **pending 7+ days**
(High 14+ · Critical 30+). Belongs to both companies, so it shows under
either. View → the Insights Center entry.

**Approvals** — a workflow approval queue with items **waiting 48+ hours**
(High 96+ · Critical a week+). View → Org & Workflow.

**IAM & Security** — an access review **open past its due date** (High from
30 days). View → IAM & Security → Reviews.

**Social Media** — a scheduled post that **failed to publish** (or is
overdue), and a platform **access token expiring within 7 days** (High on the
last day) — reconnect before publishing breaks. View → Social.

---

### Notes

- Flags **never duplicate**: while one is open, the same condition won't raise
  a second copy.
- When a condition clears in the data, the flag **auto-resolves** on the next
  scan.
- A handful of modules have no card on their own page (Inter-company, Smart
  Comm's inbox, Storefront, Onboarding) — their findings live in the Insights
  Center and the bell.
$md$,
  'ceo', 'ai_insights',
  ARRAY['insights','detectors','reference','thresholds','severity','modules'], 50
FROM shared.help_categories c WHERE c.slug = 'insights'
ON CONFLICT (slug) DO NOTHING;

-- ── 6. Briefings & asking Praxis ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'insights-briefings-and-praxis',
  'The daily briefing & asking Praxis',
  'A 07:00 morning briefing per business — rule-written for free, AI-narrated where you opt in — plus chat access.',
  $md$
## The daily briefing

Every morning at **07:00** the Hub writes a briefing per business and delivers
it to the Command Center's **Praxis Briefing** widget (unread ones carry a
dot; the full history lives in Dashboard → briefings).

**What's in it** depends on your AI Control settings:

- **Deterministic (always)** — a clear rule-written summary: *"Good morning.
  Pixie Girl has 7 open items, 2 urgent: 3 overdue invoices (1 urgent), 2
  low-stock alerts…"* Zero AI cost.
- **AI-narrated (opt-in)** — when at least one module has **Narration** on,
  the feature flag is enabled, the budget has room, and an AI vendor is
  configured, Praxis rewrites that summary as short plain prose: what stands
  out, what it means, what to look at first. It reads **only the summarised
  counts**, never your raw records.

Each briefing also records **which specific findings it covered** (the top
open items by severity at generation time), so a briefing links back to the
alerts behind it.

If any AI condition fails — narration off, budget capped, vendor down — you
get the deterministic text. The widget is never empty on a working system.

## Asking Praxis directly

In any Praxis chat (the floating launcher or `/praxis`), ask things like:

- *"What needs my attention today?"*
- *"Any alerts right now?"*
- *"What's wrong in the business?"*

Praxis answers from the **live** insight counts for your active business —
the same numbers as the Insights Center, fetched at that moment. This is a
read-only query: it respects your permissions and never changes anything.

## The urgent-alert path (no waiting for morning)

You don't wait for the briefing for genuinely urgent things: the moment a scan
raises a **new High or Critical** finding, it lands in the CEO's notification
bell (and phone, with push enabled) with a link straight to the record. An
alert that's already open never re-pings — one problem, one notification.

## Weekly reports

Separate from insights but part of the same "no manual compilation" promise
(§6.30): every Saturday at 20:00 the Hub auto-generates the weekly sales and
customer reports from logged data into a review-then-confirm queue on the
Dashboard — staff confirm rather than retype.
$md$,
  'ceo', 'ai_insights',
  ARRAY['insights','briefing','praxis','chat','notifications','weekly-reports'], 60
FROM shared.help_categories c WHERE c.slug = 'insights'
ON CONFLICT (slug) DO NOTHING;

-- ── 7. FAQ / troubleshooting ─────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'insights-faq',
  'Insights FAQ & troubleshooting',
  'Every common question: nothing showing, flags disappearing, no AI text, costs, permissions, timing.',
  $md$
## "I don't see any insights on a module's page."

Three possibilities, in order of likelihood:

1. **The module is switched off** — check AI Control → Insights. Off = the
   card never renders and nothing is scanned.
2. **All clear** — the card deliberately hides itself when there are no open
   findings. No card on an enabled module is good news.
3. **Permissions** — you need the `ai_insights` view permission. If the
   Insights Center shows "Reserved for management", ask the owner for access.

## "A flag disappeared and nobody resolved it."

That's **auto-resolve** working: the underlying condition cleared in the data
(the invoice was paid, the delivery arrived), so the next scan closed it with
the note *"Auto-resolved: condition cleared."* Filter the Center's status to
**Resolved** to see it, note and all.

## "The same problem — why only one flag?"

Deliberate. While a finding is open (or acknowledged), the scanner will not
raise a duplicate for the same condition. Resolve or dismiss it and, if the
condition still holds, the next scan raises it fresh.

## "My briefing is plain text, not AI-written."

The AI narration has four preconditions — any miss falls back to the
deterministic text (by design, never an error):

1. At least one module has **Narration** on (AI Control → Insights).
2. The **AI Daily Briefing** feature flag is enabled.
3. The monthly budget hasn't hit its **hard cap**.
4. An **AI vendor** is configured and reachable (AI Control → Vendors).

## "How much is this costing me?"

Detection and everything you see in the app: **₦0** in AI fees. Narration:
roughly ₦1–3 per briefing, only where opted in, visible line-by-line on the
AI Control spend meter under *insights_briefing*, and stopped automatically
by the monthly hard cap.

## "Who gets notified, and when?"

New **High/Critical** findings notify the **CEO** (bell + push) the moment a
scan detects them. Medium/Low findings don't ping — they wait in the Center
and the module cards. Existing open alerts never re-notify.

## "How fresh is what I'm seeing?"

- Detection: every **30 minutes** (stock 08:00 & 14:00; briefing 07:00).
- The screens themselves: **live** — new findings and resolutions push to
  every open tab instantly.
- Impatient? **Run scan** in the Insights Center forces a full pass now.

## "Can staff see insights?"

Yes, with the `ai_insights` **view** permission — Operations, Finance and
Marketing manager roles have it by default; acting (resolve/dismiss/scan)
needs **edit**. All of it is enforced at the API, not just hidden buttons,
and every action is written to the audit log.

## "Do insights respect the two-company split?"

Fully. Findings are raised per business and every screen follows your active
entity chip. The only deliberate exceptions are genuinely cross-company
findings (inter-company transactions, stylist payouts), which are visible from
either side.

## "Why did an old margin/stock flag change shape after an update?"

When detection logic improves (e.g. margin checks widened from storefront-only
to every sales channel), superseded flags auto-resolve on the next scan and
re-raise in the new, more precise form. Nothing is lost — the old ones are in
the Resolved filter.

## "What if a detector is wrong for how we work?"

**Dismiss** the finding (it won't re-ping while dismissed) and tell the
platform team — thresholds like "7 days" or "₦50,000" are code-level settings
that can be tuned per business rule.

## "Does turning everything on slow the Hub down?"

No. Detection runs in the background worker on a schedule, uses indexed
queries with hard row limits, and skips every disabled module entirely. The
pages themselves only ever read the small pre-computed results.
$md$,
  'all', 'ai_insights',
  ARRAY['insights','faq','troubleshooting','permissions','costs','auto-resolve'], 70
FROM shared.help_categories c WHERE c.slug = 'insights'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
-- SELECT slug FROM shared.help_articles WHERE related_module = 'ai_insights'
-- ORDER BY sort_order;  -- expected: 7 rows
-- ============================================================
