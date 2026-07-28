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
- **Refresh** — on mobile, *pull down* on any screen to re-fetch what's on it.
  That's a light refresh: no full reload, just the on-screen data — pull past
  the sparkle and *hold* for a moment to confirm, so a stray flick or scroll
  bounce won't trigger it. For a full reload that also clears the app's cached
  files (use this if the Hub ever looks stuck or stale), use **Hard refresh** —
  the ⟳ button in the top bar on desktop, or on mobile via **Hard refresh** in
  the account menu (tap your avatar, top-right) or the floating launcher's ⟳
  fan item (tap the launcher bottom-right).
- **Your name / avatar (bottom-left)** — account menu: **Change photo · My
  profile · My HR · Appearance · Quick login PIN · Change password · Sign out**.
  - **Appearance** here is a *personal* look for your own device — pick a
    palette (Maroon Noir, Porcelain White, Onyx Ruby), dark/light, and density.
    It doesn't need any permission and doesn't change the company logo, fonts,
    or anyone else's view. (That company-wide branding lives at **Settings →
    Appearance**, `/settings/appearance`, which only admins can open.)

### 2.4 Global search & command palette (⌘K)
Press **⌘K** (Mac) or **Ctrl-K** (Windows) anywhere. From one box you can:
- **Find records** across the business — orders, contacts, invoices, expenses,
  cash requests, CRM deals, employees, deliveries, documents, **products &
  catalogue items** (search a product name or SKU).
- **Jump to any page — and any tab within a page.** Type a module name
  ("stock", "invoicing") *or* a tab name ("shades", "credit notes", "chart of
  accounts", "approval queue") and the palette takes you straight to that tab
  (e.g. "shades" → **Catalogue › Shades**).
- **Run a command** — e.g. type "new order" to start one.
- **Search help articles.**
- **Search across all your brands** (toggle) — find a record even if it's in the
  other business.

Everything the palette shows respects your permissions: modules, their tabs,
and record types you can't access simply don't appear (e.g. a user without
Catalogue access never sees Catalogue or its tabs in search). Operators narrow
the search: `>` commands, `#` records, `@` people, `?` help, `!` pages & tabs.

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
- The **App Grid** (your favourite modules). To rearrange it, press and hold
  any tile for a couple of seconds (or use the small **Arrange** button beside
  the "Your apps" title) — the tiles start to jiggle, iOS-style. While
  arranging: **drag** a tile to reorder (neighbours slide out of the way),
  tap a tile's **−** badge to move it down to the "More" list, and tap the
  **+** badge on any app in the "More" list to pin it up into the grid
  (the **+** is always visible, even outside arrange mode). Finish with
  **Done**, press **Esc**, or tap anywhere outside the grid. The grid holds
  10 apps — pinning an 11th moves the last one back to "More". Dashboard is
  anchored first and can't be moved. The same order drives the sidebar's
  Priority list.
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
**What's inside (tabs).** **Quick Sale** · **Orders** · **Pre-orders** ·
**Quotations** · **Delivery Pending** · **POS Reconciliation** · **Payments**.
**Common tasks.**
- *Ring up a fast sale?* Sales → **Quick Sale** tab (`/sales`). Fill the Quick
  Sale Form, add items, take payment. (This replaced the old POS.) If an item is
  out of stock it still sells — as a **pre-order** — and a toast confirms it went
  in as made-to-order.
- *Get a walk-in customer's details without typing them in?* Quick Sale →
  Customer step → **QR Code** button — shows a scannable code for the order
  capture link, next to a **Share** button that opens WhatsApp with the link
  pre-filled so you can send it to any chat (a `wa.me` deep link — free, no
  phone number needed since no customer is picked yet). The customer fills
  their own name/phone/email on their phone; the moment they submit, they're
  matched (by phone → WhatsApp → email → Instagram handle, creating a new
  lead if nothing matches) and auto-selected on this screen in real time —
  no manual search needed.
- *Get the customer their payment link after Quick Sale creates the order?*
  The "Order Created!" confirmation screen shows a **QR Code** to scan on
  the spot plus a **Share** button — a `wa.me` WhatsApp deep link addressed
  straight to the customer's own WhatsApp/phone number when one is on file
  (falls back to picking a chat manually if not). Free either way — this is
  a plain click-to-chat link, not the metered WhatsApp Business API, so it
  never triggers a per-message charge; the sender still taps Send themselves.
- *See pre-orders and their production deadlines?* Sales → **Pre-orders** tab
  (`/sales?tab=preorders`). Every order carrying a made-to-order line, soonest
  ship-by first, with overdue/urgent flags — click through to the order.
- *Turn pre-orders on/off or change the delivery window?* Catalogue → **Config**
  (`/catalogue?tab=config`) → **Pre-orders**: master switch + the production
  window buyers see (default 4–8 weeks). Exclude a single product from its own
  page (base product → Pre-order · production → "Exclude from pre-orders").
- *Create a full order and send a pay link?* Sales → **Orders** → **New Sale** /
  **Create Order & Send Pay Link**. The customer gets a short checkout link
  (`/o/<slug>`), picks their gateway (Nomba / Paystack, whichever are active),
  and is redirected straight to payment.
- *Send a quotation?* Sales → **Quotations** → **New Quotation** / **Create Quotation**.
- *Let a customer PAY a quotation (and turn it into an order automatically)?*
  Sales → **Quotations** → open the quote → **Payment Link**. That mints a
  customer link (`/quote/<token>`) you can paste into WhatsApp or email. When
  the customer pays it, the quote becomes a sales order by itself — nobody has
  to press Convert, and the payment, invoice and receipt all land on the new
  order exactly as with any other sale. The link works while the quote is sent /
  viewed / accepted and not yet expired; once it's been paid the link stops
  offering payment and points at the resulting order instead.
- *Convert a quotation to an order manually?* Open the quote → **Convert to
  Order** (once it's accepted), or **Accept & Create Order** straight from a
  sent/viewed quote. Use this when the customer is paying offline — bank
  transfer or cash — so there's an order to record the money against. For a
  deposit ("50% now, balance on delivery"), convert first, then take the part
  payment on the order's own pay link, which is what enforces the plan minimums.
- *Which quote did an order come from?* The order carries the quotation it was
  converted from, and the quote shows the order it became — the link is stamped
  both ways at conversion.
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
- *What do the order statuses mean?* An order moves through seven stages:
  **Pending Payment** (placed, nothing paid) → **Partially Paid** (part payment
  in; the deposit sits as a liability, not yet revenue) → **Paid** (paid in
  full) → **Assigned** (a stylist is working on it) → **Order Ready** (packed,
  waiting for the courier) → **Dispatched** (handed to the courier / on its
  way) → **Completed** (delivered or collected). Most of these move
  automatically: recording payment drives Partially Paid / Paid; assigning a
  stylist in Studio sets Assigned; a Studio QC pass sets Order Ready; the
  courier hand-off sets Dispatched; delivery sets Completed. Cancellations are a
  separate side-flow (**Cancel Requested** / **Cancelled**).
- *Move an order's status myself?* Open the order → use the **Move to…**
  dropdown in the top action bar to nudge a paid order forward (e.g. mark a
  walk-in **Completed** the moment the customer's happy, or **Dispatched** when
  the rider takes it). Only the fulfilment stages are offered — payment and
  cancellation states are handled automatically. Moving to a customer-facing
  stage sends the matching message if it's switched on in **Messaging settings**.

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
- *Filter clients by country?* CRM → **Clients** → type a country code in the
  **Country** box — a dialing code (`+234`, `+44`) or an ISO code (`NG`, `GB`).
  It matches the phone dialing prefix or the saved country, and the filter
  sticks for the rest of your browser session (clears on a new session).
- *Log a call / activity?* Open the client or deal → **Log Activity**.
- *See who to follow up with today?* CRM → **Today** tab.

### 4.4 Stylist Studio (Service Jobs)
**What it's for.** Faitlyn's **in-house styling operations** — the register of
styling jobs from booking through QC. A QC pass marks the job **completed**
and hands the wig over to Logistics; shipping + delivery live on the Sales
Order / Logistics side.
**Where.** Run → **Stylist Studio** · `/service-jobs`
**Who can see it.** `service_jobs` permission. **The `approve` right decides
the layout:**
- **Without `approve`** (individual stylists, and the front desk) see **only
  their own queue** — the **My Jobs** and **Recipes** tabs. Every ops surface
  is hidden, and the API only ever returns their own jobs.
- **With `approve`** (Ops Manager / CEO) see every tab: My Jobs · Job Board ·
  QC Queue · Wig Accountability · Team Scorecards · Service Types · Recipes ·
  Chemical Reconciliation.

**Lifecycle (6 states).** `pending → assigned → in_progress → returned_for_qc
→ completed` (or `rework` back to the stylist). Retired: `qc_passed`,
`ready_for_dispatch`, `handed_to_sales` — never written for new jobs.

**Common tasks.**
- *Create a styling job?* Ops → Stylist Studio → **New Service Job**
  (`/service-jobs?tab=board`).
- *Assign a stylist and set the deadline?* Open the job → **Assignment** panel →
  pick a stylist. The **Due date** field there sets the job's deadline; it
  **defaults to 48 hours** from now (editable). That deadline becomes the job's
  due date **and** the due date of the task raised on the stylist's Workspace,
  so the job shows up on their **My Day**.
- *Work on my own job?* Stylist → **My Jobs** (`/service-jobs?tab=my`). Each
  wig is a **picture-first card** (photo, customer, tag, order, deadline);
  **tap the card** to open its drawer, then **Start** → hand back for QC.
- *Find one of my jobs fast?* Stylist → **My Jobs** → the **search box** at the
  top matches on the **tag** written on the wig, the **product** name, the
  **customer** name, or the **order** number.
- *See or download the style photo?* Stylist → **My Jobs** → tap the job → the
  photo sits at the top of the drawer; **tap it** for a full-screen view with a
  **Download** button, so you can save it to your phone and work from it. (Ops
  can do the same from the Job Board drawer.)
- *Where are the notes from my manager?* They're in the job drawer under **The
  style & notes for you** — the customer's locked brief plus any notes the
  operations manager / assigner added.
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
- *See what's on today — and what's coming up?* Workspace → **My Day**. It shows
  **Today's Schedule** (today's events) and **Tasks Due** (overdue + due today),
  and — so an empty day still points you forward — an **Upcoming** section under
  each: the next events and the next tasks with a future due date (a task due
  tomorrow, an event later in the month, a styling job's 48-hour deadline). Each
  Upcoming list shows up to **10** items with a **View more** link into the full
  **Calendar** / **Tasks** tab.
- *See my to-dos / add a task?* Workspace → **Tasks** → **New Task** / **Create Task**.
  The tab shows **your** tasks (assigned to you or created by you) — including
  tasks auto-raised when a service job is assigned to you (they carry the
  deadline set on the job at assignment). Managers/CEO with team-wide task
  access get a **My tasks / Everyone** switch at the top of the Tasks tab; My
  Day counts are always personal.
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
- *Add a raw/base product?* Catalogue → **Base** → **New base product** opens a
  guided **wizard**: Step 1 basics (name, texture, lace, length, category, cap
  size — from your size config — and supported lace) plus a **Sizes** pick;
  Step 2 sets price per size. Ticking several sizes creates the **whole run at
  once** (one base per size). Open one at `/catalogue/base/<id>`.
- *Create the other sizes of a base I already made?* Open the base →
  **Create other sizes** (top-right) → pick the sizes; it clones this base into
  new sibling bases (same everything, size differs).
- *Duplicate a base to tweak one thing?* Open the base → **Clone** (top-right).
- *Set a base's cap size?* Open the base → Details → **Cap size** (dropdown from
  your size config, plus Adjustable).
- *Add a sellable styled product?* Catalogue → **Styled** → **New styled**. Open
  one at `/catalogue/styled/<id>`.
- *Point one styled colour×size at a different base SKU?* Open the styled product
  → Sizes & variants → click the **Base** link on that row → pick the base.
- *Generate the colour×size matrix on the right per-size bases?* Styled product →
  **Generate variants** with **Auto-map each size to its own base** on (default).
- *Remove a duplicate lace construction?* Catalogue → **Config** → Lace ladder →
  the row's **trash** icon. If it's in use you must pick a replacement (its
  variants move there first); deleted lace sits in **Trash** for 15 days.
- *A variant shows "made to order" but a similar size is in stock — why, and how
  do I fix it?* A base one size up or down (never further) can be rewigged to
  fill an order — same styling job, no separate service. Turn it on/off, choose
  whether it applies to every listing automatically or only listings switched on,
  and pick which size is drawn from first (cut down vs built up) at Catalogue →
  **Config** → **Rewig adjacency**. A single listing can override the brand
  setting from its own Sizes & variants tab — note **"Always off for this
  listing" beats the brand setting**, so a listing set that way never substitutes
  even while adjacency is on everywhere else. The substitution applies on every
  channel that raises an order: storefront, sales campaigns, WhatsApp/Instagram
  order links, **and the Sales → Quick Sale form and Quotations**. When it fires,
  the order line is repointed to the sibling SKU actually taken off the shelf and
  carries a note telling the stylist which unit to resize, so the picklist never
  sends out the wrong size unresized.
- *The screen says units are in stock but the order still pre-ordered — why?*
  Stock only counts locations marked **available for storefront** (Stock →
  Locations), and a sale reserves against a single location. Stock parked at a
  location that isn't storefront-enabled is deliberately not sellable and won't
  be counted or reserved — enable that location, or transfer the units to one
  that is.
- *Add product pictures with a consistent branded background?* Open a styled
  product → a colour → **Add a picture**. The upload modal lets you drag/drop or
  choose an image, then optionally switch on **Use branded background** to wipe
  the photo's backdrop and drop the product onto a brand colour (defaults to the
  active brand's — burgundy for Pixie Girl, bronze for Faitlyn — pick another
  from the dropdown; Flat or Soft gradient). Save uses whichever you previewed.
- *Create a bundle?* Catalogue → **Bundles** (fixed price or % off the total).
- *Group products for a campaign?* Catalogue → **Collections** → add to collection.
- *Put a product in / take it out of a collection, bundle, or shade?* Open the
  styled product → the right sidebar's **Add to collection**, **Add to bundle**,
  and **Shop by shade** pickers show where it already lives as chips; click a
  chip's **✕** to remove it, or search to add it somewhere new.
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
Rejected). Two ways to create: **New Expense** (fill the form yourself) and
**Scan Receipt** (let Praxis read a receipt for you).
**Common tasks.**
- *Log an expense from a receipt or invoice without typing it?* Expenses →
  **Scan Receipt** (needs `create`). Upload a photo or PDF of the receipt and,
  optionally, record a short voice note (or type one) explaining what the money
  was for. Praxis reads the vendor, date, amount, VAT and line items — mapped to
  your real expense categories — and proposes an expense. You review and edit
  the suggestion, then **Create & Submit** (routes it for approval) or **Save as
  Draft**. Nothing is written until you confirm, and it all stays inside the
  Expenses screen — you're never sent to the Praxis chat.
- *Claim an expense / reimbursement?* Expenses → **New Expense** (add receipts) →
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
**Who can see it.** `cash_request` permission — its own gate, separate from
`expenses`, so access to the disbursement queue can be granted independently of
the expense ledger.
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
**What it's for.** Appraisals and reviews — score and review your team over cycles —
plus an **Insights** tab: Sales Exec of the Month and an attendance report, with a
plain-language Praxis ask box.
**Where.** People → **Performance** · `/performance`
**Who can see it.** `performance` permission.
**Tabs.** **Cycles** · **KPIs** · **Reviews** · **Insights**.
**Common tasks.**
- *Start an appraisal cycle?* Performance → **Cycles** → **New cycle**.
- *Review / score someone?* Performance → **Cycles** → open the cycle → the person.
- *Close a cycle?* Performance → **Cycles** → **Close cycle**.
- *See who is Sales Exec of the Month / who closed the most sales?* Performance →
  **Insights**. Each rep shows how many sales they closed out of the total, their
  share %, and value closed. Website / storefront self-checkouts are counted in
  the total but shown as **Online / self-service (unattributed)** — credited to
  no individual (nobody "closed" a self-checkout). WhatsApp/Instagram and walk-in
  sales are credited to the staff who raised them in **Quick Sale**, or to whoever
  **shared the catalogue/order link** the customer bought through.
- *See the attendance report (present / late / absent, on-time %, hours)?*
  Performance → **Insights** → **Attendance summary**. Filter by date range.
- *Ask a plain-language question about sales or attendance?* Performance →
  **Insights** → **Ask Praxis** box (or the quick-question chips) — e.g. *"who
  closed the most sales this month?"*, *"how was attendance this month?"*.
- *Export the report?* Performance → **Insights** → **Excel** (workbook) or
  **Winner PDF** (Sales Exec of the Month certificate).
- *Announce the winner to staff?* Performance → **Insights** → **Announce winner**
  (sends an in-app notification to brand staff). Needs `performance` edit.

### 4.22 Contacts
**What it's for.** The shared **contact directory** — everyone the businesses deal
with (customers, suppliers, staff, partners), with tags and milestones.
**Where.** People → **Contacts** · `/contacts`
**Who can see it.** `contacts` permission. A role can be limited to specific
**contact types** (e.g. suppliers only) — see below; unrestricted by default.
**Common tasks.**
- *Add a contact?* Contacts → **New Contact** / **Create Contact** / **Add Contact**.
- *Open a contact?* Contacts → click a row → `/contacts/<id>`.
- *Bulk-import contacts (clients / suppliers / retail partners / stylists /
  subscribers)?* Contacts → **Import** → pick the record type → download that
  type's template → fill it in Excel/CSV → upload to **preview** every row →
  **Confirm**. Each type has its own template and columns; rows already on file
  (matched by phone or email) are skipped, not duplicated. Employees are not
  bulk-imported here — onboard them via `/contacts/staff/new`.
- *Get an import template?* Contacts → **Template** → pick the record type (or
  use the **Import** modal's download button).
- *Export contacts?* Contacts → **Export** (owner/CEO only) — pick records + a
  period → downloads a CSV.
- *See birthdays / milestones?* Contacts → **Milestones** (`/contacts/milestones`).
- *Add a new staff member?* `/contacts/staff/new`.
- *Manage contact tags?* Settings → **Contact Tags** (`/settings/contact-tags`).
- *Limit who sees which contact types (clients vs suppliers)?* Org & Workflow →
  open the role → **Contact visibility** (`/org-workflow`). E.g. give
  supplier-facing staff suppliers only, hiding the client book.

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
  `/retention/strategies/<id>/edit`. (The legacy single-action "Workflows"
  tab was retired — every advertised trigger + action lives in Strategies.)
- *Write the email a strategy step sends?* In the strategy builder, a
  **Send email** step offers two modes: **Write it here** — the same
  Gmail-style editor Marketing uses, with **Personalise** tokens (name,
  points balance, loyalty tier, days since last order …) — or
  **Saved template**, which reuses a mail crafted in Marketing →
  **Templates** (`/marketing?tab=templates`). Either way the mail goes out
  with the brand header, footer and unsubscribe link added automatically —
  the exact same pipeline as campaign mail.
- *Preview what a strategy will send?* The builder's **Preview** panel
  renders the exact framed mail a sample customer would receive;
  **Email me a test** sends it to your own inbox.
- *Set up a loyalty scheme / rewards?* Retention → **Loyalty** / **Rewards**.
  Reward percentages are entered as whole percent (e.g. `10` for 10% off)
  and stored as a fraction; free-product / gift redemptions open a task in
  **Tasks** automatically for Retention Ops to fulfil.
- *Create a coupon?* Retention → **Coupons**. Percentage discounts take a
  whole percent (e.g. `10`); the value stores as a fraction so the engine
  applies it correctly.
- *Run a referral programme?* Retention → **Referrals**. A shopper's
  referral code is brand-scoped, captured from the storefront/landing URL
  as `?ref=<code>` and pre-filled on the checkout referral field. The
  friend's discount applies at checkout; the referrer's points AND ₦
  store-credit reward post on order.paid (the credit lands in the
  customer store-credit ledger).

### 4.24 Messaging (Smart Comm)
**What it's for.** The **unified inbox** — staff send and receive customer
messages across WhatsApp, SMS, and other channels in one place.
**Where.** People → **Messaging** · `/smartcomm`
**Who can see it.** `smartcomm` permission.
**Common tasks.**
- *Reply to a customer on WhatsApp/SMS?* Messaging (`/smartcomm`) — pick the
  conversation and send.
- *Email a customer?* Open their **email** conversation. Email uses a
  **rich, Gmail-style writer** — bold/italic/underline, text colour and size,
  alignment, bullet/numbered lists, links, inline **images**, and emoji from
  the editor's toolbar. Above it sits a **Subject** line (defaults to the
  thread's subject — edit it freely) and a **+ Cc** button to copy other
  recipients; the **Attach** button stages files (PDFs, images, docs) as chips
  to ride the same letter. One Send delivers the formatted body + subject + Cc
  + every file as a single **branded** email (the brand's logo, colours and
  footer are applied automatically). Press **⌘/Ctrl + Enter** to send;
  plain Enter makes a new line. (WhatsApp and Instagram stay a simple text box —
  those channels don't carry formatting, subjects or Cc.)
- *Start a brand-new conversation with a customer?* The **+** (top of the inbox
  list) → **Customer** tab → search the contact → pick **Send via** WhatsApp /
  Email / Instagram. Choosing **Email** opens the same rich Gmail-style writer
  with Subject, Cc and attachments; WhatsApp/Instagram show a simple first-
  message box.
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
  the ~20 most recent messages per conversation), and diagnose live sync
  with `npm run diag:instagram-echoes`. Echoes ride the **`messages`**
  webhook subscription (there is no separate `message_echoes` field on
  Instagram), which the hourly watchdog keeps subscribed — see
  `docs/INSTAGRAM_APP_REPLY_SYNC.md`.

### 4.25 Org & Workflow
**What it's for.** Company **structure, roles, and approvals** — the org chart,
positions, roles, the permission matrix, and approval routing rules.
**Where.** People → **Org & Workflow** · `/org-workflow`
**Who can see it.** `org_workflow` permission.
**Common tasks.**
- *Create a role / edit what a role can do?* Org & Workflow → **Add a role** /
  the role × module permission matrix.
- *Assign a role to several staff at once / can more than one person hold the
  same role?* Yes — a role can be held by any number of staff. Org & Workflow →
  **Permissions** → open the role → **Members** section → **Add members**: tick
  everyone who should hold it (e.g. all your junior stylists) and assign in one
  go. Roles attach to people with a Hub login; each gets the role's permissions
  on their next request. (An org-chart *position* is a single seat with one
  holder — that's separate from a role, which is shared.)
- *Limit which contact types a role sees (clients vs suppliers)?* Org & Workflow
  → open the role → **Contact visibility**: "Sees all contact types" (default)
  or "Limit to selected types" (customers, suppliers, staff, retail/stylist
  partners). Members see the union of their roles' types; the CEO sees all.
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
**Who can do what.** The whole Marketing team shares one campaign board:
**Marketing Officer** can see, build, edit and **submit for approval** *any*
campaign the team created (not just their own). **Marketing Manager** (and the
CEO) additionally **approve / launch**, delete and export. So the flow is:
anyone on the team builds & submits → a manager or CEO approves & launches.
**What's inside.** Campaigns list (filter chips: All · Live · Scheduled ·
Drafts · **Past**) · **Bundles** (`/sales-campaigns/bundles`) · **Special
Codes** (`/sales-campaigns/codes`) · a campaign detail
(`/sales-campaigns/<id>`) · the builder (`/sales-campaigns/<id>/edit`) · the
full-screen **Landing Studio** (`/landing-studio`).
**Common tasks.**
- *Launch a flash sale?* Sales Campaigns → new campaign → build → **Approval &
  launch** (submit → a manager/CEO approves → launch).
- *Clone a past campaign to reuse it?* Open the campaign → **Clone** (top-right
  of the detail page). It copies the whole sale — products, pricing, deals,
  gateways, landing config — into a fresh **draft** and drops you in the builder
  to edit. Needs `sales_campaigns.create`.
- *View past campaigns and the sales they made?* Sales Campaigns → **Past**
  chip (or the "Ended" state filter) → open one to see visitors, signups,
  orders, revenue, conversion, AOV, discount given and VIP gifts.
- *Design the campaign's landing page?* Open the campaign → **Landing Studio**
  (`/landing-studio`), drag blocks, preview (`/landing-studio/preview`).
- *Create a discount code?* Sales Campaigns → **Special Codes**
  (`/sales-campaigns/codes`).
- *Set up campaign bundles?* Sales Campaigns → **Bundles**.
- *A campaign link shows 404?* Public sale pages live on the brand's **sales
  subdomain** (e.g. `sales.faitlynhair.com/sale/<slug>`), set in Settings →
  Business Setup → Public Identity. A link on the bare apex
  (`faitlynhair.com/sale/…`) 404s — use the subdomain link from **Share kit**.

### 4.27 Social Studio
**What it's for.** Log the links of posts you published natively, see them
embedded on a calendar, and track posting cadence. No planning, approvals, or
content authoring — just proof of what went out and how it's doing.
**Where.** Grow → **Social Studio** · `/social`
**Who can see it.** `social` permission.
**What's inside (tabs).** **Calendar** · **Performance** · **Account**.
**Common tasks.**
- *Record a post you published?* Social → **Calendar** → tap the day → paste the
  link (platform is auto-detected) → **Log it**. It embeds in that day's drawer.
- *See what was posted on a day?* Social → **Calendar** → tap the day to open its
  drawer of embeds + reactions.
- *Check posting cadence / how many posts this month?* Social → **Performance**
  (the target is fixed: 6 posts/week, Sunday off; Instagram must hit 6).
- *Add a social handle?* Social → **Account** → **Add handle**.

### 4.28 Marketing
**What it's for.** Email campaigns — writing beautiful branded mails, choosing
who receives them, sending/scheduling, and reading the results. (Ad analytics
was retired; the module is email-only.)
**Where.** Grow → **Marketing** · `/marketing`
**Who can see it.** `email_campaigns` permission.
**What's inside (tabs).** **Campaigns** (`?tab=campaigns`, the default) ·
**Templates** (`?tab=templates`) · **Segments** (`?tab=segments`) ·
**Design** (`?tab=design`).
**Common tasks.**
- *Send an email campaign?* Marketing → **Campaigns** → **New campaign** →
  name it, pick a segment + template → build the audience → **Send now** (or
  set a schedule).
- *Send myself a test / get a campaign approved first?* Marketing →
  **Campaigns** → open the campaign → **Send a test**. **Send test to me**
  drops the exact mail (marked **[TEST]**) in your inbox — no tracking, no
  recipients. To route it for sign-off, type a reviewer's address (e.g. the
  CEO's) and **Send for approval**; they review it in their inbox before you
  hit **Send now** (the real send needs `email_campaigns:approve`).
- *Set the From address / Reply-To on a campaign?* You don't — it's **not**
  typed per campaign. The From address and Reply-To are resolved from the
  brand's **Outbound Email** connection in **Messaging → Settings →
  Connections → Email** (`/smartcomm`, the gear → Connections → Email) so
  every mail sends from the authenticated mailbox and customer replies thread
  back into Messaging. The campaign builder shows them read-only; only the
  From **display name** is editable.
- *See the exact mail a past campaign sent?* Marketing → **Campaigns** → open
  the campaign — the full mail is previewed at the top, with performance
  (sent/opened/clicked) below it.
- *Write or edit a mail template?* Marketing → **Templates** → **New template**
  — a Gmail-style editor: write normally, use **Personalise** to greet each
  customer by name, add images/emoji/brand colours. The logo header and
  unsubscribe footer are added automatically. Templates are also reusable by
  Retention → **Strategies** email steps, so one mail can serve campaigns
  and automated journeys alike.
- *Personalise a mail with loyalty details?* The **Personalise** menu now
  includes each customer's live loyalty facts — points balance, tier,
  orders placed, lifetime spend, days since last order — plus the
  campaign's sale tokens.
- *Add my own merge token (e.g. a WhatsApp line or store hours)?* In any
  mail editor, **Personalise → Add your own token** — name it, say what it
  fills in, and it's instantly available in Marketing templates and
  Retention strategy mails for that brand.
- *Choose who gets a campaign?* Marketing → **Segments** → **New segment** —
  pick filters and watch the live count of who's in before saving.
- *Change the header/footer on every mail?* Marketing → **Design** — tagline,
  footer note, socials; it ships pre-styled so most brands never touch it.
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
| Appearance — **company-wide** logo, fonts & default palette (white-label). For a *personal* look, use **Appearance** in the account menu instead — see §2.3. | `/settings/appearance` |
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
- *Change someone's login email?* IAM → **Users** → row ⋯ menu → **Edit email**.
- *Remove an employee / user from everywhere?* IAM → **Users** → row ⋯ menu →
  **Move to trash**. They disappear from HR, Payroll, Contacts and this list and
  their login is disabled. Nothing is lost — they sit in the **Trash** tab.
- *Restore a deleted person?* IAM → **Users** → **Trash** tab → **Restore**.
- *Delete someone permanently?* IAM → **Users** → **Trash** tab → **Delete**.
  Only possible when no other records reference them; if they're still linked
  they stay in the Trash to preserve those connections.
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
- *Change storefront colours / fonts / corner roundness?* Storefront Studio →
  **Theme** (a live preview updates as you edit; Save draft, then Publish).
- *Change storefront logo / favicon?* Storefront Studio → **Branding**.
- *Fix how the site looks when shared on WhatsApp/Instagram/Facebook (the
  picture + title + description)?* Storefront Studio → **Branding → Share text
  and Share banner**. Upload one normal photo (4:5 or square is fine) and it
  builds the wide 1200×630 share banner — your photo centred, with a blurred
  enlargement of it filling the sides (or a flat brand gradient), optional logo
  + headline — with crop/zoom, background blur/dim/zoom and a live preview. A
  photo that's already 1200×630 is used edge-to-edge. Save draft, then Publish.
- *Preview the storefront on a phone / tablet / desktop frame?* Storefront
  Studio → **Preview** (device-size toggle).
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
| Order pay-link | `/pay/<token>` | A customer pays (or part-pays) the balance on an existing order. |
| Quotation pay-link | `/quote/<token>` | A customer pays a quotation — paying it turns the quote into a sales order automatically. |
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
- Let a customer pay a quotation (auto-converts to an order) → Sales → `/sales`
  (Quotations → open the quote → Payment Link → `/quote/<token>`)
- Convert a quotation to an order by hand → open the quote → Convert to Order
  (or Accept & Create Order on a sent/viewed quote)
- Record a payment on an order → open the order → `/sales/orders/<id>` → Record Payment
- Match an unattributed in-store terminal payment to an order → Sales →
  `/sales?tab=pos-reconciliation` → Match (or Ignore with a reason)
- Add a CRM deal → CRM (Run) → `/crm` (Pipeline → New Deal)
- See a client's history → CRM → `/crm/clients/<id>`
- Add a contact → Contacts (People) → `/contacts` (New Contact)
- Bulk-import contacts (clients / suppliers / retail partners / stylists /
  subscribers) → Contacts (People) → `/contacts` (Import → pick type → template →
  preview → confirm)

**Money in**
- Create an invoice → Invoicing (Finance) → `/invoicing` (Invoices → New Invoice)
- Issue a credit note → Invoicing → `/invoicing` (Credit Notes)
- See overdue customers → Invoicing → `/invoicing` (AR Ageing)

**Money out**
- **Create a cash request** → Cash Requests (Finance) → `/cash-requests` (New Cash Request)
- Approve a cash request → Cash Requests → `/cash-requests` (Approval Queue)
- Settle a cash request with receipts → open the request → Settlement wizard
- Claim an expense / reimbursement → Expenses (Finance) → `/expenses` (New Expense)
- Log an expense from a receipt/invoice (photo or PDF + optional voice note) → Expenses → `/expenses` (Scan Receipt)
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
- Start an appraisal → Performance (People) → `/performance` (Cycles → New cycle)
- See Sales Exec of the Month / who closed the most sales → Performance → `/performance` (Insights)
- See the attendance report (present/late/absent, on-time %) → Performance → `/performance` (Insights)
- Hire someone (JD → offer → e-sign) → HR → `/hr` (Recruitment)

**Growth & AI**
- Launch a flash sale → Sales Campaigns (Grow) → `/sales-campaigns`
- Design a landing page → `/landing-studio`
- Create a discount code → Sales Campaigns → `/sales-campaigns/codes`
- Log a posted link → Social Studio (Grow) → `/social` (Calendar → tap a day → paste link)
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
