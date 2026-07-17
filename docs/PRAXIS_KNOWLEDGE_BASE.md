# Pixie Girl Hub — Praxis Knowledge Base (Whole-System Navigation Guide)

> **What this document is.** This is the single knowledge file that teaches
> Praxis (the in-hub AI operator) how the entire Pixie Girl Hub is laid out, so
> Praxis can answer *any* "how do I…" / "where do I…" / "what is…" question in
> plain language and hand the user a direct link to the exact page.
>
> **How Praxis should use it.** When a user asks how to do something, find the
> matching module or task below, explain it in one or two plain sentences, give
> the short numbered steps, and then give the **page link** (e.g. `/cash-requests`).
> The links are in-app routes inside the Hub — a user who is signed in can open
> them directly. If the user might not have permission, add one line: "You'll
> only see this if your role includes access to *<module>*."
>
> **Golden rules for answers:**
> 1. Always name the **sidebar group** and **module** ("Finance → Cash Requests")
>    *and* give the **link** (`/cash-requests`). People navigate by both.
> 2. If a task has a specific button, name it exactly ("click **New Cash Request**").
> 3. If the task needs approval, say so ("it goes to your approver before payout").
> 4. Never invent a page. If it isn't in this document, say you're not certain and
>    point the user to the closest module or to **Help Center** (`/help`).
> 5. Everything is **entity-scoped**: the answer may differ per business
>    (Pixie Girl Global vs Faitlyn Hair). If it matters, remind the user to
>    check which business is active in the top-left switcher.

---

## 1. What the Pixie Girl Hub is

The Pixie Girl Hub ("the Hub") is one platform that runs **two Nigerian
businesses** from a single system:

- **Pixie Girl Global (PXG)** — hair, retail, stylist partner network.
- **Faitlyn Hair (FLH)** — hair, in-house styling studio.

It combines **ERP + CRM + E-commerce**: sales, stock, purchasing/imports,
production/landed-cost, invoicing, accounting, expenses, HR & payroll,
marketing, retention, messaging, and an AI layer (Praxis) — all in one place.

**Key idea — data is separated by business.** Each business keeps its own
customers, orders, stock, invoices, and books. Shared things (people/identity,
the contact directory, audit trail, AI, documents) live in a common area. When
you're working in the Hub you are always working *inside one business at a time*,
chosen with the **business switcher** at the top-left. Switching the business
changes every number you see.

---

## 2. Getting around the Hub (global navigation)

Everything below is visible on (almost) every screen.

### 2.1 The left sidebar — the module menu
The sidebar lists the modules, grouped into sections:

- **Run** — day-to-day: Dashboard, Sales, CRM, Stylist Studio, Insights, Workspace
- **Operate** — the physical business: Stock, Catalogue, Logistics, Purchasing, Production, Retail Partners, Stylists
- **Finance** — money: Invoicing, Accounting, Expenses, Pricing, Cash Requests
- **People** — humans: HR & Staff, Payroll, Performance, Contacts, Retention, Messaging, Org & Workflow
- **Grow** — reach & AI: Sales Campaigns, Social Studio, Marketing, Praxis AI
- **System** — configuration: Settings, IAM & Security, Documents, AI Control, Storefront Studio, Notifications, Help Center

You **only see modules your role can access.** If a module isn't in your
sidebar, your role doesn't include it — ask an admin (or the CEO) to grant it
in **Org & Workflow** (`/org-workflow`) or **IAM & Security** (`/iam-security/users`).

### 2.2 The business switcher (top-left)
The chip showing the current business (e.g. "Faitlyn Hair") is a dropdown.
Click it to switch between **Pixie Girl Global** and **Faitlyn Hair**. Every
list, KPI, and total on screen re-loads for the business you pick. If you can
only access one business, there's nothing to switch.

### 2.3 The top bar
- **Search Hub… (⌘K / Ctrl-K)** — the global command palette. See §2.4.
- **Clock in / Clock out** — punches your attendance for the day (feeds My HR
  and the HR attendance register). As your closing time approaches you get a
  reminder to clock out (5 min before / at / 5 min after) if you're still
  clocked in; time past your closing time shows as supplementary hours in My HR.
- **Bell (notifications)** — your alert feed; the number is unread count. Full
  page at `/notifications`.
- **Theme toggle** — light / dark (the Hub defaults to the dark "Maroon Noir" look).
- **Your name / avatar (bottom-left)** — account menu: profile, preferences,
  sign out.

### 2.4 Global search & command palette (⌘K)
Press **⌘K** (Mac) or **Ctrl-K** (Windows) anywhere. From one box you can:
- **Find records** across the business — orders, contacts, invoices, expenses,
  cash requests, CRM deals, employees, deliveries, documents.
- **Jump to any page** — type a module name ("cash", "invoicing", "stock").
- **Run a command** — e.g. type "new order" to start one.
- **Search help articles.**
- **Search across all your brands** (toggle) — find a record even if it's in the
  other business.

This is the fastest way to get anywhere. When telling a user where something is,
you can add: "or press **⌘K** and type its name."

### 2.5 The floating Praxis launcher (that's me)
On every screen there's a floating Praxis button. It opens the AI drawer so a
user can ask a question or ask Praxis to do something *without leaving the page
they're on*. The full Praxis workspace is at `/praxis`.

### 2.6 Home — the Command Center
The Hub's home screen (the "/" landing) is the **Command Center**:
- A greeting + live clock/attendance card.
- A **role KPI strip** (three cards tuned to your role).
- **Quick Actions** (shortcuts you have permission for).
- A **Praxis Insights** card (urgent + open counts, deep links into `/insights`).
- The **App Grid** (pin/drag your favourite modules).
- **My activity** (your recent audit trail — so you can spot anything that
  wasn't you).

The dedicated numbers dashboard is separate, at **Dashboard** (`/dashboard`).

### 2.7 Every screen has four states
If a page looks empty or blocked, it's by design. Every screen handles four
states: **loading** (skeleton), **empty** (with a "create your first…" button),
**error** (with retry), and **permission-denied** ("You don't have permission
to view this"). A permission-denied message means your role lacks that access,
not that the feature is broken.

---

## 3. How page links work in this guide

Every link below is an **in-app path**. When signed in, opening the path takes
you straight to that screen. Examples:

| You want | Path (link) |
|---|---|
| Cash Requests list | `/cash-requests` |
| A specific order | `/sales/orders/<orderId>` |
| A contact's profile | `/contacts/<contactId>` |
| An employee's file | `/hr/employees/<profileId>` |
| A CRM deal | `/crm/deals/<id>` |

Paths with `<…>` need an ID — Praxis should either give the list page
(`/sales`) and say "open the order," or, if the ID is known, build the exact
link. Sub-pages use extra segments, e.g. `/settings/currencies`,
`/ai-control/training`.

There are also **public links** (no login) the Hub generates for customers and
candidates — see §14.

---

# 4. THE MODULES

Each module below follows the same shape:

- **What it's for** (plain language)
- **Where** — sidebar group → name, and the **link**
- **Who can see it** — the permission that gates it
- **What's inside** — the tabs/sections
- **Common tasks** — "How do I…" with steps + link

---

## RUN

### 4.1 Dashboard
**What it's for.** The business's headline numbers for today — revenue, orders,
stock health, and other KPIs at a glance.
**Where.** Run → **Dashboard** · `/dashboard`
**Who can see it.** Everyone with a login (personal, always on).
**How do I…**
- *See today's sales / KPIs?* Open **Dashboard** (`/dashboard`). Switch the
  business at top-left to compare PXG vs FLH.

### 4.2 Sales
**What it's for.** Selling: quick over-the-counter sales, full orders, quotations,
chasing deliveries, matching stray in-store terminal payments, and payment settings.
**Where.** Run → **Sales** · `/sales`
**Who can see it.** `sales` permission.
**What's inside (tabs).** **Quick Sale** · **Orders** · **Quotations** ·
**Delivery Pending** · **POS Reconciliation** · **Payments**.
**Common tasks.**
- *Ring up a fast sale?* Sales → **Quick Sale** tab (`/sales`). Fill the Quick
  Sale Form, add items, take payment. (This replaced the old POS.)
- *Create a full order and send a pay link?* Sales → **Orders** → **New Sale** /
  **Create Order & Send Pay Link**. The customer gets a short checkout link
  (`/o/<slug>`), picks their gateway (Nomba / Paystack, whichever are active),
  and is redirected straight to payment.
- *Send a quotation?* Sales → **Quotations** → **New Quotation** / **Create Quotation**.
- *See orders waiting to ship?* Sales → **Delivery Pending** tab.
- *An in-store card/terminal payment came in but no order matched it?* Sales →
  **POS Reconciliation** tab (`/sales?tab=pos-reconciliation`). Pick the
  suggested order (or search manually) and **Match** — this confirms the
  order's payment exactly as if the terminal had reported it directly — or
  **Ignore** a false positive/duplicate with a short reason. A payment whose
  terminal isn't registered to either brand yet shows in a CEO-only
  cross-brand section until it's resolved.
- *Open one order?* Sales → **Orders**, click the order → `/sales/orders/<orderId>`.
- *Record a payment against an order?* Open the order, **Record Payment**.

### 4.3 CRM
**What it's for.** Customer relationships: your daily follow-ups, the deal
pipeline, and 360° client profiles (history, preferences, hair specs).
**Where.** Run → **CRM** · `/crm`
**Who can see it.** `crm` permission.
**What's inside (tabs).** **Today** (follow-ups due) · **Pipeline** (deals,
kanban) · **Clients** · **Reports** (forecast, close time).
**Common tasks.**
- *Add a new deal / opportunity?* CRM → **Pipeline** → **New Deal**. Open a deal
  at `/crm/deals/<id>`.
- *See a client's full history?* CRM → **Clients**, click the client →
  `/crm/clients/<contactId>`.
- *Log a call / activity?* Open the client or deal → **Log Activity**.
- *See who to follow up with today?* CRM → **Today** tab.

### 4.4 Stylist Studio (Service Jobs)
**What it's for.** Faitlyn's **in-house styling operations** — the register of
styling jobs from booking through QC. A QC pass marks the job **completed**
and hands the wig over to Logistics; shipping + delivery live on the Sales
Order / Logistics side.
**Where.** Run → **Stylist Studio** · `/service-jobs`
**Who can see it.** `service_jobs` permission. **Scope matters:**
- `own`-scope users (individual stylists) see **only their own queue** —
  My Jobs + Recipes tabs; every ops surface is hidden.
- `all`/`team` (Ops Manager / CEO) see every tab: My Jobs · Job Board · QC
  Queue · Wig Accountability · Team Scorecards · Service Types · Recipes ·
  Chemical Reconciliation.

**Lifecycle (6 states).** `pending → assigned → in_progress → returned_for_qc
→ completed` (or `rework` back to the stylist). Retired: `qc_passed`,
`ready_for_dispatch`, `handed_to_sales` — never written for new jobs.

**Common tasks.**
- *Create a styling job?* Ops → Stylist Studio → **New Service Job**
  (`/service-jobs?tab=board`).
- *Work on my own job?* Stylist → **My Jobs** (`/service-jobs?tab=my`) →
  Start → hand back for QC.
- *See or download the style photo?* Open the job from the Job Board
  (`/service-jobs?tab=board`) — the photo sits at the top of the job drawer;
  **click it** for a full-screen view with a **Download** button, so you can
  save it to your phone and work from it.
- *QC pass or fail a returned job?* Ops → **QC Queue** tab. Pass = job
  completed + wig auto-dispatched to Logistics; fail = back to stylist for
  rework.
- *See a stylist's scorecard?* Ops → **Team Scorecards** tab.
- *See my own scorecard?* Stylist → My Jobs — the "Your scorecard" tile is
  at the top of the queue.
- *Add a chemical recipe?* Ops → **Recipes** → **New Chemical Recipe**.
- *A stylist opened a job that was reassigned to someone else?* The drawer
  shows "reassigned to X → back to my jobs" (no bare 403).

> Note: "Stylist Studio" (in-house jobs) is different from "**Stylists**" (the
> external partner programme) — see §4.16.

### 4.5 Insights
**What it's for.** Praxis's **proactive alerts** — things it noticed you should
act on (risks, anomalies, opportunities), with severity.
**Where.** Run → **Insights** · `/insights`
**Who can see it.** `ai_insights` permission.
**What's inside.** Filter by severity/status: Open · Acknowledged · Resolved ·
Dismissed.
**Common tasks.**
- *See what Praxis is flagging?* Open **Insights** (`/insights`), or the Praxis
  Insights card on the home screen.
- *Act on an insight?* Open it → Acknowledge / Resolve / Dismiss, or "Open in
  Praxis" to dig in.

### 4.6 Workspace
**What it's for.** Your personal cockpit — your day, calendar, tasks, notes,
goals, the AI Chief of Staff, and **My HR** (your own attendance, leave, payslips).
**Where.** Run → **Workspace** · `/workspace`
**Who can see it.** Everyone (personal). Some tabs (Goals, Notes) are CEO-only.
**What's inside (tabs).** **My Day** · **Tasks** · **Calendar** (Month/Week/Day/
Agenda) · **My HR** · **Goals** *(CEO)* · **Notes** *(CEO)* · **AI Chief of Staff**.
**Common tasks.**
- *See my to-dos / add a task?* Workspace → **Tasks** → **New Task** / **Create Task**.
  The tab shows **your** tasks (assigned to you or created by you) — including
  tasks auto-raised when a service job is assigned to you. Managers/CEO with
  team-wide task access get a **My tasks / Everyone** switch at the top of the
  Tasks tab; My Day counts are always personal.
- *Work through my tasks on my phone?* The Tasks tab is a deadline-first list
  grouped **Overdue · Today · This Week · Later · Done Today** (tap a heading to
  expand/collapse). **Swipe a task right to mark it done**, **swipe left to
  reschedule** (Later today / Tomorrow / Next week / pick a date). On desktop
  the same actions appear on hover, and a **Board / List** switch toggles
  between the kanban board and this list.
- *Change a task's status?* Open the task and use the **status dropdown** at
  the top of its detail panel — or, on the desktop board, drag its card into
  another column.
- *Add a calendar event?* Workspace → **Calendar** → **New Event** / **Create Event**.
- *Clock in / out?* Top bar **Clock in** button (or Workspace → **My HR**).
- *Request leave / see my payslip?* Workspace → **My HR** tab.
  (Old `/my-hr` links redirect here: `/workspace?tab=my-hr`.)
- *Set a goal?* Workspace → **Goals** → **New Goal** / **Create Goal** (CEO).
- *Plan with the AI Chief of Staff?* (CEO) Workspace → **AI Chief of Staff** →
  describe what you want in plain language. It proposes a whole plan (goal +
  milestones + tasks + events + notes) as one card; review the steps (✎ to edit
  any) and tap **Approve plan** to run them — nothing is written until you
  approve. To assign work, name a teammate ("assign to my BDM") and it resolves
  the person; for a private to-do say "personal" and it stays off the shared board.
- *Teach the Chief of Staff my preferences?* Under any reply, tap 👍/👎. On 👎 a
  small note box appears — say what it should have done differently ("don't
  schedule anything before 10am") and it remembers that on future plans.

---

## OPERATE

### 4.7 Stock
**What it's for.** The **one true inventory count** — receiving goods, moving
stock between locations, transfers, adjustments, low-stock alerts.
**Where.** Operate → **Stock** · `/stock`
**Who can see it.** `stock` permission.
**What's inside (tabs).** **Overview** · **Goods Reception** · **Movements** ·
**Transfers** · **Adjustments** · **Alerts** · **Locations**.
**Common tasks.**
- *Receive incoming goods?* Stock → **Goods Reception** tab.
- *Move / transfer stock between locations?* Stock → **Transfers** → **New Transfer**
  / **Create Transfer**.
- *Do a stock count / stocktake?* Stock → **Adjustments** → **New Stocktake**.
- *Log a write-off / damage?* Stock → **Adjustments** → **Log Write-off** /
  **Log Stock Movement**.
- *See what's running low?* Stock → **Alerts** tab.
- *Add a warehouse / location?* Stock → **Locations** → **Add Location**.

### 4.8 Catalogue
**What it's for.** Products and variants. The Hub uses a **base product** (the
raw item) → **styled product** (the sellable, styled version) model, plus
categories, collections, bundles, shades, and bookable services.
**Where.** Operate → **Catalogue** · `/catalogue`
**Who can see it.** `catalogue` permission.
**What's inside (tabs).** **Styled** · **Base** · **Categories** · **Collections**
· **Shades** · **Bundles** · **Services** · **Config**.
**Common tasks.**
- *Add a raw/base product?* Catalogue → **Base** → **New base product**. Open one
  at `/catalogue/base/<id>`.
- *Add a sellable styled product?* Catalogue → **Styled** → **New styled**. Open
  one at `/catalogue/styled/<id>`.
- *Create a bundle?* Catalogue → **Bundles** (fixed price or % off the total).
- *Group products for a campaign?* Catalogue → **Collections** → add to collection.
- *Add a bookable service (Faitlyn)?* Catalogue → **Services** → **New Service Type**.

### 4.9 Logistics
**What it's for.** Getting orders to customers — the delivery queue, active
deliveries, couriers/agencies, and shipping rates.
**Where.** Operate → **Logistics** · `/logistics`
**Who can see it.** `logistics` permission.
**What's inside (tabs).** **Queue** · **Active** · **Delivered** · **Issues** ·
**All** · **Agencies** · **Shipping Rates**.
**Common tasks.**
- *Dispatch / assign a delivery?* Logistics → **Queue** tab, assign a courier.
- *Track a delivery / see failed attempts?* Logistics → **Active** or **Issues**.
- *Add a courier/agency?* Logistics → **Agencies**.
- *Set shipping rates by destination?* Logistics → **Shipping Rates**.

### 4.10 Purchasing
**What it's for.** Buying stock and imports — purchase orders (POs), suppliers,
goods-received notes (GRNs), and supplier invoices.
**Where.** Operate → **Purchasing** · `/purchasing`
**Who can see it.** `purchasing` permission.
**What's inside.** Purchase Orders · **GRNs** · **GRN & Invoices** · Suppliers.
**Common tasks.**
- *Raise a purchase order?* Purchasing → **New Purchase Order** / **Create PO**.
- *Add a supplier?* Purchasing → **New Supplier** / **Create Supplier**.
- *Receive goods against a PO?* Purchasing → **GRNs** (goods-received note).
- *Match a supplier invoice?* Purchasing → **GRN & Invoices**.
> Big POs may need approval before they're sent — the Hub routes them through the
> approval workflow.

### 4.11 Production
**What it's for.** The **China factory account** and **production runs** — funding
the factory, tracking runs from planned → in production → arrived, and building
**landed cost** (product + shipping + customs) so margins are real.
**Where.** Operate → **Production** · `/production`
**Who can see it.** `production` permission.
**What's inside (tabs).** **Overview** · **Production** (runs) · **Factory Account**.
**Common tasks.**
- *Start a production run?* Production → **New Production Run** / **Create Run**.
- *Fund the factory / record a factory payment?* Production → **Factory Account**
  (records payments, charges, credits in CNY/NGN).
- *See landed cost of a batch?* Open the production run in the **Production** tab.

### 4.12 Retail Partners
**What it's for.** **Consignment** — stock placed with retail partners, tracking
what moved, and settling what they owe.
**Where.** Operate → **Retail Partners** · `/retail-partners`
**Who can see it.** `retail_partners` permission.
**What's inside (tabs).** **Partners** · **Consignment Stock** · **Movements** ·
**Settlements**.
**Common tasks.**
- *Add a retail partner?* Retail Partners → **Partners** → **Add Stylist Partner**
  / activate partner.
- *Record consignment stock moved out/returned?* Retail Partners → **Movements**.
- *Settle a partner's account?* Retail Partners → **Settlements**.

### 4.13 Stylists (Partner Programme)
**What it's for.** The **external stylist partner network** (Pixie Girl) —
applications, vetting/certification, assignments, referral sales, reviews, and
payouts.
**Where.** Operate → **Stylists** · `/stylists`
**Who can see it.** `stylist_programme` permission.
**What's inside.** Applicants / vetting · Partners · Assignments · Referral sales
· Reviews · Payouts.
**Common tasks.**
- *Review a stylist application?* Stylists → applications (approve / decline /
  send to vetting).
- *Certify a partner?* Stylists → move an applicant to **Certified**.
- *Pay a partner?* Stylists → **Payouts**.
> This is the *partner* programme. In-house Faitlyn styling jobs live in **Stylist
> Studio** (§4.4).

---

## FINANCE

### 4.14 Invoicing
**What it's for.** Billing customers and watching what they owe — invoices,
credit notes, and live **AR ageing** (who's overdue).
**Where.** Finance → **Invoicing** · `/invoicing`
**Who can see it.** `invoicing` permission.
**What's inside (tabs).** **Invoices** · **Credit Notes** · **AR Ageing** ·
**Settings**.
**Common tasks.**
- *Create an invoice?* Invoicing → **Invoices** → **New Invoice** / **Create Invoice**.
- *Issue a credit note / refund a customer on the books?* Invoicing → **Credit
  Notes** → **New Credit Note** / **Issue Credit Note**.
- *See who's overdue?* Invoicing → **AR Ageing** tab.
- *Record a payment against an invoice?* Open the invoice → **Record Payment**.

### 4.15 Accounting
**What it's for.** The books — the general ledger, journals, chart of accounts,
tax, fiscal periods, and bank reconciliation. Financial reports live here.
**Where.** Finance → **Accounting** · `/accounting`
**Who can see it.** `accounting` permission.
**What's inside (tabs).** **Reports** (P&L, Balance Sheet, Cash Flow, Trial
Balance, AR/AP Ageing) · **Journals** · **Chart of Accounts** · **Tax Center** ·
**Periods** · **Bank**.
**Common tasks.**
- *See Profit & Loss / Balance Sheet?* Accounting → **Reports** tab.
- *Post a journal entry?* Accounting → **Journals**.
- *Add / edit a ledger account?* Accounting → **Chart of Accounts**.
- *Close a period / file tax?* Accounting → **Periods** / **Tax Center**.
- *Reconcile the bank?* Accounting → **Bank**.

### 4.16 Expenses
**What it's for.** Staff **claims and advances** — reimbursements, company-card
spend, and advance settlements, with approval routing.
**Where.** Finance → **Expenses** · `/expenses`
**Who can see it.** `expenses` permission.
**What's inside.** Filter by type (Reimbursement, Company card, Direct invoice,
Advance settlement) and status (Draft, Pending, Approved, Paid, Partially Paid,
Rejected).
**Common tasks.**
- *Claim an expense / reimbursement?* Expenses → **New** (add receipts) →
  **Submit for Approval**. It routes to your approver. Picking **Save as
  Draft** instead records it without submitting.
- *Submit a draft expense you saved earlier?* Open it from the list →
  **Submit for Approval** (needs `edit`).
- *Settle a cash advance?* Expenses → **Advance settlement**.
- *Approve someone's expense?* Expenses → the pending list (needs `approve`).
- *Mark an approved expense as paid / disburse it?* Open the approved expense
  → **Mark as Paid**, pick a payment method (Bank Transfer, Cash, POS/Card,
  Payslip Addition, Wallet), then either type a reference or attach a receipt
  photo/PDF instead — both are optional (needs `approve`). Once paid, the
  status pill and the expense detail show the amount paid, who paid it, and
  any attached receipt.

### 4.17 Pricing
**What it's for.** Margin, fees, and price changes — the pricing advisor, rules,
price floors, overrides, and proposals that go through approval.
**Where.** Finance → **Pricing** · `/pricing`
**Who can see it.** `pricing` permission.
**What's inside (tabs).** **Advisor** · **Rules** · **Floors** · **Overrides** ·
**Proposals** · **Scenarios**.
**Common tasks.**
- *Get a suggested price / check margin?* Pricing → **Advisor**.
- *Add a pricing rule?* Pricing → **Rules** → **New rule** / **Add rule**.
- *Set a minimum price (floor)?* Pricing → **Floors**.
- *Override a price?* Pricing → **Overrides** → **Add manual override**.
- *Propose a price change for approval?* Pricing → **Proposals** → **Send for approval**.

### 4.18 Cash Requests
**What it's for.** **Disbursements** — asking for cash to be released (petty cash,
supplier payment, float), getting it approved, paid out, and settled afterwards.
**Where.** Finance → **Cash Requests** · `/cash-requests`
**Who can see it.** `expenses` permission (Cash Requests share the expenses gate).
**What's inside (tabs).** **My Requests** · **Drafts** · **Approval Queue**
*(approvers)* · **All Cash Requests** *(approvers)*.
**Common tasks.**
- **Create a cash request?** Go to **Finance → Cash Requests** (`/cash-requests`)
  and click **New Cash Request** (top-right). Fill in amount, purpose, urgency,
  and who/what it's for, then submit. It goes to the **Approval Queue** for your
  approver; once approved it's paid out and later you **settle** it with receipts.
- *Save one for later?* It lands in the **Drafts** tab until you submit.
- *Approve / pay a request?* Cash Requests → **Approval Queue** (needs `approve`).
- *Settle a paid-out request (attach receipts)?* Open the request → **Settlement**
  wizard / **Add Receipts**.

---

## PEOPLE

### 4.19 HR & Staff
**What it's for.** The people system — staff directory, leave, attendance admin,
disciplinary queries, targets, rewards, recruitment, and HR analytics.
**Where.** People → **HR & Staff** · `/hr`
**Who can see it.** `hr_payroll` permission (Recruitment tab needs `recruitment`).
**What's inside (tabs).** **Overview** · **Directory** · **Leave** · **Attendance**
· **Devices** · **Queries** · **Targets** · **Rewards** · **Recruitment** ·
**Analytics** · **Settings** · **Onboarding**.
**Common tasks.**
- *Open an employee's file?* HR → **Directory**, click a person →
  `/hr/employees/<profileId>`.
- *Onboard a new staff member?* HR → **Onboarding**, or Contacts →
  **contacts/staff/new** (`/contacts/staff/new`). The onboarding wizard sets
  the work schedule — on-site/remote/off per weekday, plus the **start and
  closing time** and lateness grace.
- *Change an employee's work days or hours after onboarding (e.g. 5 days → 3,
  or a new closing time)?* Open their file → **Schedule** card → **Edit**.
  Set the per-weekday mode and the start/closing/grace times, then Save.
- *Approve leave?* HR → **Leave** tab (the badge shows pending count).
- *See attendance?* HR → **Attendance** tab. (Staff clock in/out via the top
  bar.) An employee's file → **Attendance** tab shows each day's in/out times,
  minutes late, minutes early, and **supplementary hours** worked past their
  closing time (`+Nm over`).
- *Turn the clock-out reminders on/off?* HR → **Settings** tab → the
  **"Clock-out reminders"** switch (under the attendance/lateness card). When
  on, anyone still clocked in gets a nudge (in-app + push) **5 minutes before,
  at, and 5 minutes after** their closing time so they don't forget to clock
  out and bank unintended supplementary hours. Each person's closing time is
  set on their **Schedule** (falls back to the brand default closing time in
  **Settings → Payroll**).
- *Raise a staff query?* HR → **Queries**.
- *Hire someone (JD → offer → e-sign → onboarding)?* HR → **Recruitment** tab.
  Candidates get a public offer link (`/offer/<token>`). On that page the
  candidate can **download the offer as a branded PDF at any time — before or
  after signing** (the signed copy carries their stamped e-signature); the
  direct link is `/api/public/offer/<token>/pdf`.
- *Clock-in address label missing, or want to rotate/test the geocoding key?*
  HR → **Settings** tab → the **"Configure Geoapify"** pill (right after
  **Payout authorisation**). The key is stored encrypted (permission
  `geoapify_settings`), maskable/revealable with a password re-check, and has
  a **Test connection** button — no `.env` edit or redeploy needed.

### 4.20 Payroll
**What it's for.** Pay runs, payslips, and disbursement.
**Where.** People → **Payroll** · `/payroll`
**Who can see it.** `hr_payroll` permission.
**Common tasks.**
- *Run payroll?* Payroll → start a new run, review, then disburse.
- *See / send payslips?* Payroll → the run's payslips. (Staff see their own in
  Workspace → **My HR**.)

### 4.21 Performance
**What it's for.** Appraisals and reviews — score and review your team over cycles.
**Where.** People → **Performance** · `/performance`
**Who can see it.** `performance` permission.
**Common tasks.**
- *Start an appraisal cycle?* Performance → **New cycle**.
- *Review / score someone?* Performance → open the cycle → the person.
- *Close a cycle?* Performance → **Close cycle**.

### 4.22 Contacts
**What it's for.** The shared **contact directory** — everyone the businesses deal
with (customers, suppliers, staff, partners), with tags and milestones.
**Where.** People → **Contacts** · `/contacts`
**Who can see it.** `contacts` permission.
**Common tasks.**
- *Add a contact?* Contacts → **New Contact** / **Create Contact** / **Add Contact**.
- *Open a contact?* Contacts → click a row → `/contacts/<id>`.
- *See birthdays / milestones?* Contacts → **Milestones** (`/contacts/milestones`).
- *Add a new staff member?* `/contacts/staff/new`.
- *Manage contact tags?* Settings → **Contact Tags** (`/settings/contact-tags`).

### 4.23 Retention
**What it's for.** Keeping customers — loyalty, rewards, referrals, coupons,
subscriptions, bundles, maintenance reminders, and win-back **strategies**.
**Where.** People → **Retention** · `/retention`
**Who can see it.** `retention` permission.
**What's inside (tabs).** **Strategies** · **Loyalty** · **Rewards** ·
**Referrals** · **Coupons** · **Subscriptions** · **Bundles** · **Maintenance** ·
**Analytics**.
**Common tasks.**
- *Build an automated retention strategy (trigger → action)?* Retention →
  **Strategies** → new (`/retention/strategies/new`). Edit one at
  `/retention/strategies/<id>/edit`.
- *Set up a loyalty scheme / rewards?* Retention → **Loyalty** / **Rewards**.
- *Create a coupon?* Retention → **Coupons**.
- *Run a referral programme?* Retention → **Referrals**.

### 4.24 Messaging (Smart Comm)
**What it's for.** The **unified inbox** — staff send and receive customer
messages across WhatsApp, SMS, and other channels in one place.
**Where.** People → **Messaging** · `/smartcomm`
**Who can see it.** `smartcomm` permission.
**Common tasks.**
- *Reply to a customer on WhatsApp/SMS?* Messaging (`/smartcomm`) — pick the
  conversation and send.
- *Share products / a bundle / a service in a chat?* Open the conversation →
  the **catalogue icon** in the composer → pick Base / Styled / **Bundle** /
  Service items → **Send**. The customer gets photo cards plus one short
  order link (`/o/<slug>`) to pick, confirm delivery, and pay.
- *Connect a WhatsApp/SMS number?* That's **Messaging Accounts** (permission
  `messaging_accounts`) — connect channels there.
- *Edit the automatic messages customers get (receipts, order updates)?* That's
  the **Automated Messages Studio** (`comms_studio` permission).
- *See the confirmation a customer was sent after paying?* It's recorded on
  their thread in Messaging: the branded confirmation **email** appears on
  their email-channel conversation, and a WhatsApp confirmation (sent when
  the customer has no email on file) appears on their WhatsApp thread.
- *A teammate answered an Instagram DM from the Instagram app — where is it?*
  It syncs into the customer's thread automatically as a business-side bubble
  tagged **"via Instagram app"**, and the thread's unread badge clears for
  everyone (the conversation was handled — just not in the Hub). If a thread
  was only *opened* on Instagram but never answered, it stays **unread** here
  on purpose, so nobody assumes it was dealt with.
- *Instagram replies made in the app are missing / a thread's history has
  gaps?* An admin can recover recent history with
  `npm run backfill:instagram-history` on the server (Instagram only exposes
  the ~20 most recent messages per conversation). Requires the Meta app's
  Instagram webhook subscription to include **message_echoes** — see
  `docs/INSTAGRAM_APP_REPLY_SYNC.md`.

### 4.25 Org & Workflow
**What it's for.** Company **structure, roles, and approvals** — the org chart,
positions, roles, the permission matrix, and approval routing rules.
**Where.** People → **Org & Workflow** · `/org-workflow`
**Who can see it.** `org_workflow` permission.
**Common tasks.**
- *Create a role / edit what a role can do?* Org & Workflow → **Add a role** /
  the role × module permission matrix.
- *Add a position / build the org chart?* Org & Workflow → **Add a position**.
- *See every department in one chart / print or share the org chart?* Org &
  Workflow → Org Chart tab → the **Full Organigramme** pill at the bottom of
  the Departments list (below the last department). It renders every
  department's positions as one connected tree (department badge on each
  node) and has an **Export PDF** button that generates and downloads a
  landscape PDF of the whole structure.
- *Change who approves what (approval chains)?* Org & Workflow → approvals.
> Giving an individual person access to a module is done here (role) or per-user
> in **IAM & Security → Users** (`/iam-security/users`).

---

## GROW

### 4.26 Sales Campaigns
**What it's for.** Flash sales and **landing pages** — build a campaign, its
bundles and special discount codes, and a public landing page.
**Where.** Grow → **Sales Campaigns** · `/sales-campaigns`
**Who can see it.** `sales_campaigns` permission.
**What's inside.** Campaigns list · **Bundles** (`/sales-campaigns/bundles`) ·
**Special Codes** (`/sales-campaigns/codes`) · a campaign detail
(`/sales-campaigns/<id>`) · the builder (`/sales-campaigns/<id>/edit`) · the
full-screen **Landing Studio** (`/landing-studio`).
**Common tasks.**
- *Launch a flash sale?* Sales Campaigns → new campaign → build → **Approval &
  launch**.
- *Design the campaign's landing page?* Open the campaign → **Landing Studio**
  (`/landing-studio`), drag blocks, preview (`/landing-studio/preview`).
- *Create a discount code?* Sales Campaigns → **Special Codes**
  (`/sales-campaigns/codes`).
- *Set up campaign bundles?* Sales Campaigns → **Bundles**.

### 4.27 Social Studio
**What it's for.** Plan, schedule, prove, and score social posts across accounts.
**Where.** Grow → **Social Studio** · `/social`
**Who can see it.** `social` permission.
**What's inside (tabs).** **Board** · **Calendar** · **Performance** · **Team** ·
**Accounts**.
**Common tasks.**
- *Schedule a post?* Social → **Calendar** / **Board** → draft → **Schedule**.
- *See post performance / reach?* Social → **Performance**.
- *Connect a social account?* Social → **Accounts** → **Add social**.
- *Assign a post to a creator?* Social → **Board** → assign to creator.

### 4.28 Marketing
**What it's for.** Email campaigns and ads — reaching customers in bulk and
tracking ad spend/performance.
**Where.** Grow → **Marketing** · `/marketing`
**Who can see it.** `email_campaigns` permission (ad analytics via `ad_analytics`).
**Common tasks.**
- *Send an email campaign?* Marketing (`/marketing`) → build and send.
- *See ad performance?* Marketing → ad analytics.
> Email **signatures** and sender setup live in Settings →
> **Email Signatures** (`/settings/email-signatures`).

### 4.29 Praxis AI
**What it's for.** **Me** — your AI operator. I read freely, write only with your
sign-off, and act only with *your* permissions (I can never do what your role
can't). Ask me questions, or ask me to do work; anything that changes data waits
in a **pending queue** for your approval.
**Where.** Grow → **Praxis AI** · `/praxis` (and the floating launcher everywhere).
**Who can see it.** `praxis_ai` permission.
**What's inside (rails/tabs).** the chat · **Pending** (actions awaiting your
sign-off) · **Trace** (what I did and why) · **Abilities** (what I'm allowed to do).
**Common tasks.**
- *Ask Praxis something / give it a task?* Open `/praxis` or the floating button;
  type your request.
- *Approve or reject an action I proposed?* Praxis → **Pending** queue.
- *See how I reached an answer?* Praxis → **Trace**.
- *See what I'm allowed to do for you?* Praxis → **Abilities**.

---

## SYSTEM

### 4.30 Settings
**What it's for.** Configure the Hub. A landing grid of tiles; each tile is a
focused settings page.
**Where.** System → **Settings** · `/settings`
**Who can see it.** `settings` permission.
**The tiles (direct links).**

| Setting | Link |
|---|---|
| Appearance (theme / branding) | `/settings/appearance` |
| Login screen editor | `/settings/login` |
| Business setup (company profile) | `/settings/business-setup` |
| Businesses (brands) | `/settings/businesses` |
| Currencies | `/settings/currencies` |
| Tax rates | `/settings/tax-rates` |
| Payment gateways (Paystack/Opay/Nomba/Stripe) | `/settings/payment-gateways` |
| Bank accounts | `/settings/bank-accounts` |
| Document numbering (invoice/PO numbers) | `/settings/document-numbering` |
| Custom fields | `/settings/custom-fields` |
| CRM pipeline stages | `/settings/pipeline-stages` |
| Document templates | `/settings/document-templates` |
| Email signatures | `/settings/email-signatures` |
| Notification preferences | `/settings/notifications` |
| Scheduled reports | `/settings/scheduled-reports` |
| Integration secrets / API keys | `/settings/integration-secrets` |
| Business policies | `/settings/policies` |
| Contact tags | `/settings/contact-tags` |
| Factory languages (i18n) | `/settings/factory-languages` |

**Common tasks.**
- *Connect a payment gateway?* Settings → **Payment gateways**
  (`/settings/payment-gateways`).
- *Change invoice/PO number format?* Settings → **Document numbering**.
- *Add a currency / tax rate?* Settings → **Currencies** / **Tax rates**.
- *Add a bank account?* Settings → **Bank accounts**.

### 4.31 IAM & Security
**What it's for.** Users, access, sessions, and audit — the security control room.
**Where.** System → **IAM & Security** · `/iam-security`
**Who can see it.** `iam` permission.
**Sub-pages (links).** Users `/iam-security/users` · Audit log
`/iam-security/audit` · Security events `/iam-security/events` · Sessions
`/iam-security/sessions` · Access reviews `/iam-security/reviews` · MFA
`/iam-security/mfa`.
**Common tasks.**
- *Create a user / give someone access?* IAM → **Users** (`/iam-security/users`).
- *See who did what (audit trail)?* IAM → **Audit** (`/iam-security/audit`).
- *Force-log-out a session?* IAM → **Sessions**.
- *Turn on MFA?* IAM → **MFA**.
- *Run an access review?* IAM → **Reviews** → **New Access Review**.

### 4.32 Documents
**What it's for.** The shared **filing cabinet** — contracts, agreements, POs,
invoices, receipts, IDs, and media, linked to the record they belong to.
**Where.** System → **Documents** · `/documents`
**Who can see it.** `documents` permission.
**Common tasks.**
- *Find a document?* Documents (`/documents`) — filter by type (Contract,
  Invoice, Receipt, ID, …) or by the record it's attached to.
- *Send a document for e-signature?* Documents attach to the sign engine; the
  signer gets a public link (`/sign/<token>`) and can verify at `/verify/<code>`.

### 4.33 AI Control
**What it's for.** AI **governance** — this is where you *teach* Praxis, set its
voice, control models/vendors, watch spend, and gate features. **This is where
you upload knowledge like this very document.**
**Where.** System → **AI Control** · `/ai-control`
**Who can see it.** `ai_governance` permission.
**Sub-pages (links).**

| Area | Link | What it does |
|---|---|---|
| **Knowledge & Training** | `/ai-control/training` | Upload files or teach facts; Praxis embeds them and uses them in answers. **Upload this guide here.** |
| Brand Voice | `/ai-control/brand-voice` | How Praxis should sound. |
| Insights control | `/ai-control/insights` | Tune the proactive insights. |
| Vendors & Models | `/ai-control/vendors` | Which LLM/embedding/vendors are used. |
| Health & Logs | `/ai-control/health` | AI health & request logs. |
| Spend & Budget | `/ai-control/budget` | AI usage metering & budget. |
| Feature flags & governance | `/ai-control/governance` | Turn AI features on/off. |
| AI access | `/ai-control/access` | Who/what Praxis may touch. |

**Common tasks.**
- *Teach Praxis a fact or upload a document?* AI Control → **Knowledge &
  Training** (`/ai-control/training`). Type a fact and **Teach Praxis**, or drop
  a file (any type, up to 25 MB).
- *Change how Praxis talks?* AI Control → **Brand Voice**.
- *See what the AI is costing?* AI Control → **Spend & Budget**.

### 4.34 Storefront Studio
**What it's for.** The look and wording of the online storefront — templates,
fonts, colours, favicons, and vocabulary (button text, page copy).
**Where.** System → **Storefront Studio** · `/storefront-studio`
**Who can see it.** `storefront_studio` permission.
**Common tasks.**
- *Change storefront branding / fonts / colours?* Storefront Studio → **Branding**.
- *Reword storefront buttons/labels?* Storefront Studio → **Content** / vocabulary.

### 4.35 Notifications
**What it's for.** Your alert feed.
**Where.** System → **Notifications** · `/notifications` (and the bell in the top bar).
**Who can see it.** Everyone (personal).
**Common tasks.**
- *See all my alerts?* `/notifications`.
- *Choose which alerts I get?* Settings → **Notification preferences**
  (`/settings/notifications`).

### 4.36 Help Center
**What it's for.** Guides and FAQs inside the Hub.
**Where.** System → **Help Center** · `/help`
**Who can see it.** `help_center` permission.
**Common tasks.**
- *Read a how-to article?* Help Center (`/help`) → open an article (`/help/<slug>`).
- *Write/edit an article (staff)?* Help Center → **Editor** (`/help/editor`).

---

# 5. Cross-cutting concepts (things that apply everywhere)

### 5.1 Money is always NGN-based
Figures are stored in **Nigerian Naira (₦)** and shown with the money component.
History is **never** recomputed with today's FX rate — an old order keeps the
rate it was booked at. Foreign amounts (e.g. China factory payments in CNY) are
converted at the rate on the day. If a total "looks wrong," check the business
and the date, not just the number.

### 5.2 Approvals & workflows
Many actions don't hit the target table directly — they **submit for approval**
first and show the approval chain before you confirm. This covers: expenses,
cash requests, purchase orders, sales discounts, pricing changes, campaigns, and
intercompany. If something you did is "pending," it's waiting for an approver;
find it in that module's **Approval Queue** (approvers) or your **My Requests**.

### 5.3 Who can see/do what — RBAC (5 layers)
Access is checked at five levels:
1. **Entity** — which business (PXG / FLH).
2. **Module** — which of the modules you can open.
3. **Action** — view / create / edit / delete / approve / export within a module.
4. **Record scope** — **all** records, only your **team's**, or only your **own**.
5. **Field** — sensitive fields (cost, salary, factory origin) are hidden from
   roles that shouldn't see them.

The **CEO** role bypasses all checks. There are 15 seeded roles; custom roles can
be created. Grants are managed in **Org & Workflow** (roles) and **IAM &
Security → Users** (per user). *If a user can't see or do something, it's almost
always a role/permission gap — that's the first thing to check.*

### 5.4 Business (entity) isolation
Each business has its own separate data. The **business switcher** (top-left)
picks the active one; everything re-loads. You cannot accidentally mix PXG and
FLH data — the Hub scopes every query to the active business. Cross-business
money movements go through **Intercompany** (settlement between the two).

### 5.5 Document numbering
Invoices, POs, receipts, etc. get automatic sequence numbers. The format is
configurable in Settings → **Document numbering** (`/settings/document-numbering`).

### 5.6 Notifications & real-time
The Hub updates live (new orders, messages, approvals pop in without refresh).
Alerts collect in the **bell** and at `/notifications`; you tune what you receive
in Settings → **Notification preferences**.

---

# 6. Public (no-login) links the Hub generates

Some Hub flows create links for people **outside** the company (customers,
candidates). They don't need a Hub account:

| Purpose | Link shape | Who uses it |
|---|---|---|
| Order checkout | `/o/<slug>` | A customer pays for an order a staffer built. |
| Walk-in registration | `/walkin/<brand>` | The counter QR — a walk-in customer registers. |
| Online welcome / onboarding | `/welcome/<business>/<token>` | New customer intake via a QR/token link. |
| Document e-signature | `/sign/<token>` | Anyone signing a document emailed to them. |
| Signature verification | `/verify/<code>` | Verifying a signed document is genuine. |
| Candidate offer packet | `/offer/<token>` | A job candidate reads the JD + offer, downloads a PDF copy, and e-signs. |
| Candidate offer PDF | `/api/public/offer/<token>/pdf` | Direct download of the offer packet PDF (any time, before/after signing). |

---

# 7. "HOW DO I…?" — quick task index

Use this as the fast lookup. Format: **task → module (group) → link**.

**Selling & customers**
- Ring up a quick sale → Sales (Run) → `/sales` (Quick Sale tab)
- Create an order + pay link → Sales → `/sales` (Orders → Create Order & Send Pay Link)
- Send a quotation → Sales → `/sales` (Quotations → New Quotation)
- Record a payment on an order → open the order → `/sales/orders/<id>` → Record Payment
- Match an unattributed in-store terminal payment to an order → Sales →
  `/sales?tab=pos-reconciliation` → Match (or Ignore with a reason)
- Add a CRM deal → CRM (Run) → `/crm` (Pipeline → New Deal)
- See a client's history → CRM → `/crm/clients/<id>`
- Add a contact → Contacts (People) → `/contacts` (New Contact)

**Money in**
- Create an invoice → Invoicing (Finance) → `/invoicing` (Invoices → New Invoice)
- Issue a credit note → Invoicing → `/invoicing` (Credit Notes)
- See overdue customers → Invoicing → `/invoicing` (AR Ageing)

**Money out**
- **Create a cash request** → Cash Requests (Finance) → `/cash-requests` (New Cash Request)
- Approve a cash request → Cash Requests → `/cash-requests` (Approval Queue)
- Settle a cash request with receipts → open the request → Settlement wizard
- Claim an expense / reimbursement → Expenses (Finance) → `/expenses` (New)
- Settle a cash advance → Expenses → `/expenses` (Advance settlement)
- Raise a purchase order → Purchasing (Operate) → `/purchasing` (Create PO)
- Fund the China factory → Production (Operate) → `/production` (Factory Account)

**The books**
- See Profit & Loss / Balance Sheet → Accounting (Finance) → `/accounting` (Reports)
- Post a journal → Accounting → `/accounting` (Journals)
- Reconcile the bank → Accounting → `/accounting` (Bank)
- Close a period / file tax → Accounting → `/accounting` (Periods / Tax Center)

**Stock & products**
- Receive goods → Stock (Operate) → `/stock` (Goods Reception)
- Transfer stock → Stock → `/stock` (Transfers → New Transfer)
- Do a stocktake → Stock → `/stock` (Adjustments → New Stocktake)
- See low stock → Stock → `/stock` (Alerts)
- Add a product → Catalogue (Operate) → `/catalogue` (Base → New base product; Styled → New styled)
- Create a bundle → Catalogue → `/catalogue` (Bundles)

**Delivery**
- Dispatch a delivery → Logistics (Operate) → `/logistics` (Queue)
- Track / fix a failed delivery → Logistics → `/logistics` (Active / Issues)
- Set shipping rates → Logistics → `/logistics` (Shipping Rates)

**People & pay**
- Onboard a new staff member → HR (People) → `/hr` (Onboarding) or `/contacts/staff/new`
- Open an employee file → HR → `/hr/employees/<id>`
- Approve leave → HR → `/hr` (Leave)
- Run payroll → Payroll (People) → `/payroll`
- See my own payslip / request leave → Workspace → `/workspace` (My HR)
- Clock in/out → top-bar Clock in button
- Start an appraisal → Performance (People) → `/performance` (New cycle)
- Hire someone (JD → offer → e-sign) → HR → `/hr` (Recruitment)

**Growth & AI**
- Launch a flash sale → Sales Campaigns (Grow) → `/sales-campaigns`
- Design a landing page → `/landing-studio`
- Create a discount code → Sales Campaigns → `/sales-campaigns/codes`
- Schedule a social post → Social Studio (Grow) → `/social` (Calendar/Board)
- Send an email campaign → Marketing (Grow) → `/marketing`
- Build a retention strategy → Retention (People) → `/retention/strategies/new`
- Ask or instruct Praxis → `/praxis` or the floating button
- **Teach Praxis / upload a document** → AI Control (System) → `/ai-control/training`

**Admin & config**
- Give a user access / create a user → IAM → `/iam-security/users`
- Create or edit a role → Org & Workflow (People) → `/org-workflow`
- See the audit trail → IAM → `/iam-security/audit`
- Connect a payment gateway → Settings → `/settings/payment-gateways`
- Change invoice/PO numbering → Settings → `/settings/document-numbering`
- Add a currency / tax rate → Settings → `/settings/currencies` / `/settings/tax-rates`
- Switch business (PXG ⇄ FLH) → business switcher, top-left
- Find anything fast → press ⌘K / Ctrl-K

---

# 8. Glossary (plain-language)

- **The Hub** — this whole platform.
- **Entity / business / brand** — Pixie Girl Global (PXG) or Faitlyn Hair (FLH).
  The Hub keeps their data separate; you switch between them top-left.
- **Praxis** — the AI operator (me). Reads freely, writes only with your sign-off,
  acts only within your permissions.
- **Command palette (⌘K)** — the search-and-jump box that finds records, opens
  pages, and runs commands.
- **Command Center** — the Hub home screen.
- **Quick Sale** — the fast counter-sale form (replaced the old POS).
- **Base vs Styled product** — base = the raw item; styled = the sellable, styled
  version customers buy.
- **GRN** — Goods-Received Note; confirms what actually arrived against a PO.
- **Landed cost** — true cost of imported goods (product + shipping + customs).
- **AR / AP ageing** — how overdue customers owe you (AR) / you owe suppliers (AP).
- **Consignment** — stock placed with a retail partner that you settle later.
- **Stylist Studio** — Faitlyn's in-house styling jobs. **Stylists** (separate) —
  Pixie Girl's external partner programme.
- **Workflow / approval chain** — the route a request takes through approvers
  before it takes effect.
- **RBAC** — the 5-layer access model (entity → module → action → record → field).
- **Intercompany** — settling money between the two businesses.
- **My HR** — your personal HR view (attendance, leave, payslips) inside Workspace.

---

*This guide is generated from the live Pixie Girl Hub codebase (the admin app's
route map `apps/admin/src/router.tsx`, the module catalogue
`apps/admin/src/lib/modules.ts`, and the RBAC permission catalog
`src/shared/access/access.catalog.js`).*

**Maintenance (do not skip).** Any user-facing change — a new/renamed/re-routed
page, a module added or removed, a new or renamed tab or primary action button, a
changed task flow, or a new public-link shape — **must update this file in the
same PR**. Re-seeding is then automatic: this file is in the RAG ingest manifest
(`scripts/ai-ingest-docs.js`), so every production deploy runs `npm run
ai:reindex` and re-embeds the changed sections — merge to `main` and Praxis
re-learns it. For an immediate refresh without deploying, run `npm run ai:reindex`
on the server or upload this file at **AI Control → Knowledge & Training**
(`/ai-control/training`). A user-facing change isn't "done" until this doc
reflects it. Full rules: README → "Praxis knowledge base (keep it seeded)" and
CLAUDE.md → "Praxis knowledge base must stay seeded".*
