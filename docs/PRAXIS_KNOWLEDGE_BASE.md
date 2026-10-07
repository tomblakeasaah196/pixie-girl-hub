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
  - **My profile** shows two names, and only one of them is yours to edit.
    **Full name** is your *official name on record* — it's read-only here,
    managed by HR, and it's the name everyone else sees on the records you
    touch (orders, approvals, tasks, the org chart, Users & Access, activity
    logs). **Display name** is a *personal label* you can edit freely: it
    appears only in your own account menu and on this profile, and changing
    it never renames you anywhere else in the Hub. Leave it empty to just use
    your official name. You can also edit your **phone**, change your
    **email** (password + a 6-digit code sent to the new address), and
    **Change photo**.
    - *Change my name on the system?* You can't do it yourself — editing
      **Display name** in My Profile only sets your personal label. Your
      official name lives on your **contact record**, so ask HR or an admin
      with `contacts:edit` to correct it in People → **Contacts** → your row
      (`/contacts/<id>`) → **Edit** → *Display name*. That's the one that
      updates everywhere the Hub shows your name.

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
**Quotations** · **Delivery Pending** · **Delivery Fee Review** (Pixie Girl, when
Care & Accessories is on or orders are waiting) · **POS Reconciliation** ·
**Payments**.
**Common tasks.**
- *Ring up a fast sale?* Sales → **Quick Sale** tab (`/sales`). Fill the Quick
  Sale Form, add items, take payment. (This replaced the old POS.) If an item is
  out of stock it still sells — as a **pre-order** — and a toast confirms it went
  in as made-to-order.
- *Sell to a customer paying in dollars?* Quick Sale → **Currency** → **USD**
  (only NGN or USD — Nomba charges nothing else). The Total shows the exact
  dollar figure (each product's catalogue USD price) with the Naira beneath,
  and after **Create Order & Send Pay Link** the confirmation says what the
  link charges, e.g. "Charging USD 249.99 on Nomba".
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
- *Where did a cancelled order go / how do I un-cancel one?* Two ways, same
  result. If you have the order open, a cancelled order shows a **Reinstate**
  button in its top bar (`/sales/orders/<orderId>`). If you're hunting for it,
  cancelled orders are hidden from the Orders list so it stays a working view —
  open them with the **archive icon** beside the order filters on Sales →
  **Orders** (`/sales?tab=orders`), which lists every cancelled order
  with a **Restore** button. (You can also still pick **Cancelled** in the
  status dropdown to see them inline.) Either way it returns the order to the
  exact status it held before it was cancelled and re-holds its stock. If some
  items have since sold out, it asks first and tells you those lines will come
  back as **pre-orders** — everything still in stock is re-held immediately. An
  order whose **deposit was forfeited** when it was cancelled cannot be
  restored: that money was already posted to income, so raise a new order
  instead. Reinstating needs the `sales` **edit** right.
- *Why was this order cancelled / who cancelled it?* Open the order — a
  cancelled one carries a red banner under its status pills giving the date and
  the reason ("Cancelled on 10/09/2026, 03:30 — Checkout abandoned"). The same
  reason shows beside each row in the archive drawer. Cancelling by hand asks
  you to pick a reason first (customer changed their mind, wrong item,
  duplicate order, item no longer in stock, payment failed, test order, or
  **Other…** to type your own) — you can't cancel without one. Orders the
  system cancelled say so instead: **Checkout abandoned** (an unpaid self-serve
  order past the expiry window), **Instalment plan abandoned**, or superseded by
  a paid duplicate. An older order may say *no reason recorded (cancelled by
  hand)* — those pre-date the reason picker.
- *The system cancelled an order on its own — when is it allowed to?* Only when
  an order is unpaid or part-paid; a fully paid order is never auto-cancelled
  (that needs a refund). Three sweeps do it: an unpaid **self-serve** checkout
  (Website, sales campaign, public form) past **24 hours** with ₦0 paid; an
  **instalment** order with money on it but no payment for the abandonment
  window; and a **pending duplicate** of an order the customer has just paid
  under another number. All three release the stock the order was holding. The
  windows live at Sales → **Payments** (`/sales?tab=payments`) — the expiry
  cannot be set below 24 hours. Any payment above ₦0 takes an order out of the
  abandoned-checkout sweep for good.
- *See pre-orders and their production deadlines?* Sales → **Pre-orders** tab
  (`/sales?tab=preorders`). Every order carrying a made-to-order line, soonest
  ship-by first, with overdue/urgent flags — click through to the order.
- *When does a pre-order get fulfilled once stock comes back?* Automatically. The
  moment stock is received for the variant (Goods Reception, production, or a
  count that raises on-hand), the Hub applies it to the waiting pre-orders
  **first** — **drawn** for already-paid orders, **reserved** for unpaid ones —
  **paid-first, then oldest-first**, before that stock is exposed to a new sale.
  Ops and sales get a "pre-orders fulfilled by new stock" notice. No manual step.
  A deploy-time reconcile also backfills anything the live path missed. (Details:
  `docs/PREORDER_STOCK_DEDUCTION.md`.)
- *Tell the customer their pre-order has arrived?* Open the order (Sales → the
  order) → the **Pre-order card** → **Notify customer (email)**. Sends a branded
  "your pre-order has arrived" email — **email only** — and records when it was
  sent; resend is allowed. Needs a customer email on file and `sales:edit`.
- *See which pre-orders were fulfilled by stock (and what's still stuck)?* Sales
  → **Pre-orders** tab → **Fulfilled pre-orders** button (top-right). Opens a
  modal listing pre-orders stock has been applied to (with current status and
  whether the customer was emailed) and a "Still waiting" section (overdue at the
  top), plus the last reconcile run. The main Pre-orders table only shows orders
  still waiting; this modal is where fulfilled ones live.
- *Manually re-run the pre-order stock check / backfill?* In that same **Fulfilled
  pre-orders** modal, **Run backfill now** (needs `sales:edit`) reconciles this
  brand's waiting pre-orders against available stock on demand — draws for paid,
  reserves for unpaid, notifies ops+sales. It normally runs automatically (on
  every stock receipt and every deploy); this is the manual escape hatch and is
  safe to click any time (it never double-draws).
- *Turn pre-orders on/off or change the delivery window?* Catalogue → **Config**
  (`/catalogue?tab=config`) → **Pre-orders**: master switch + the production
  window buyers see (default 4–8 weeks). Exclude a single product from its own
  page (base product → Pre-order · production → "Exclude from pre-orders").
- *Create a full order and send a pay link?* Sales → **Orders** → **New Sale** /
  **Create Order & Send Pay Link**. The customer gets a short checkout link
  (`/o/<slug>`) and is redirected straight to payment on **Nomba** — the only
  payment gateway, for Naira and US Dollars.
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
- *Sell a Care & Accessories item (comb, oil, brush) — Pixie Girl only?* In
  Quick Sale, Quotations or Change Order, pick the **Care & Accessories** chip in
  the product picker and choose the exact option/SKU (e.g. 50 ml vs 100 ml). Care
  items are **stock-only**: they never become a pre-order, a care-only basket is
  always **paid in full** (no Flexi Pay), and they never go to Stylist Studio.
  For delivery, calculate the fee by hand and type it in — the zone rate only
  counts wigs.
- *Price the delivery for an order with care products?* Sales → **Delivery Fee
  Review** (`/sales?tab=delivery-review`). Every Pixie Girl **delivery** order
  containing Care & Accessories lands here and **can't be dispatched** until its
  fee is settled. Open the row, then either **Confirm** the fee already on the
  order, or enter the calculated fee with how you worked it out. A **higher** fee
  needs the customer's recorded "yes" (channel + message reference) — that puts
  the new fee on the order and gives you a **top-up link** to send; once a
  separate payment taken *after* they agreed is on the order, **Verify & settle**.
  A **lower** fee on an order they already paid more for needs the refunded
  payment or credit note first. If they say no, the order stays blocked — re-price
  it or route it to a manager to cancel/refund. The website notice customers see
  is exactly **EXTRA DELIVERY FEES MAY APPLY**.
- *A payment came in but no order matched it?* Sales → **POS Reconciliation**
  tab (`/sales?tab=pos-reconciliation`). This holds every payment we captured
  but couldn't attach to an order — in-store terminal charges AND online
  payments (a customer who paid without a proper link, a foreign-currency
  charge we couldn't place, a paid Settings → Test connection checkout). Each
  row says who sent it and why it couldn't be matched. Pick the suggested
  order (or search manually) and **Match** — this confirms the order's payment
  exactly as if the gateway had reported it directly — or **Ignore** a false
  positive/duplicate/test with a short reason. A payment whose brand we
  couldn't determine shows in a CEO-only cross-brand section until resolved.
  A **dollar** payment shows its **$** amount (it has no Naira figure until it's
  placed): the suggestions are the dollar orders whose balance it pays, and
  **Match** converts it at *that order's* locked rate and records it as a dollar
  payment (dollar receipt, Nomba USD wallet in the books). A dollar payment made
  on a **cancelled** order also lands here, for a refund decision. Every 10
  minutes the Hub also reads Nomba's own statement and parks any credit it has
  no payment for; a dollar credit there parks in dollars too.
- *Where do failed Nomba payments go?* Nowhere — by design there is no such
  pile. A payment we can't place is never dropped or retried silently; it goes
  straight to **POS Reconciliation** for a person to decide.
- *A customer paid less than the dollar total?* The order is credited with what
  they actually paid (never the whole balance) and stays **Part paid**; they're
  sent the balance in dollars with their pay link automatically. Nothing for you
  to do unless they don't pay it.
- *A customer paid more than the order total (paid twice, or a dollar payment
  well over the balance)?* The whole payment is recorded, the order shows an
  **In credit** pill with the excess, and Finance (Accounting editors and the
  CEO) get an **Overpayment on <order>** notification. The excess is the
  customer's money held in **Customer Deposits 2400** — refund it, or keep it as
  credit for their next order. A few cents over (rounding a dollar total) never
  counts as an overpayment.
- *Why does a receipt or payment message show dollars?* Receipts, the "payment
  received" message and the "order paid" confirmation speak the currency the
  customer actually paid: a dollar order paid in dollars says "$249.99", with
  the Naira figure staying in the books. A receipt shows **Paid in USD** under
  the Naira total. An order paid partly in ₦ and partly in $ keeps a Naira
  receipt.
- *Open one order?* Sales → **Orders**, click the order → `/sales/orders/<orderId>`.
- *Record a payment against an order?* Open the order → **Record Payment**
  (in the action bar at the top, or on the **Payments** card). The form opens
  inline in the Payments card — you never have to open the invoice to accept
  money. Enter the amount received, the bank's transaction reference and the
  bank name (both required — Accounting reconciles them against the
  bank-statement import), plus an optional note, then **Save Payment**. The
  same payment lands on the order's invoice in the same instant, so the two
  screens can never disagree on the balance.
- *Who accepted a payment, and when?* Every payment row in the order's
  **Payments** ledger names the staff member who recorded it — or, for an
  in-store terminal payment resolved through POS Reconciliation, who matched it
  to this order — and the exact time they did — stamped by the system, not typed in, and it stays on the order
  permanently. Payments captured by a gateway say so instead of naming a person.
  Staff-recorded rows also show the bank name and transaction reference. The
  same trail appears on the invoice's Payments list.
- *"Record Payment" isn't showing on an order?* Manual payment entry is a
  business-level switch. A manager turns it on at Sales → **Payments** tab
  (`/sales?tab=payments`); until then payments must arrive through a gateway,
  and the order's Payments card says so where the button would be. You can
  still send a pay link.
- *Apply a discount code to an order that was already placed?* Open the order →
  **Payments** card → **Apply a discount code**. Use this when a customer was
  eligible for a code — a loyalty voucher, a campaign coupon, an apology
  discount — and nobody entered it at checkout. Type the code and press
  **Check**: the panel shows what the code is worth, the new order total and
  the new balance due *before* anything is written. Press **Apply** to commit.
  The order total drops, the discount is recorded on the order, the invoice is
  re-issued and the code is marked used, all in the same instant. It works on
  an order that is part-paid — that's the point — so a customer who has already
  put a deposit down simply owes less.
- *A code is worth more than the customer still owes — what happens?* The
  waiver is capped at the outstanding balance. A ₦20,000 code on an order with
  ₦15,000 left to pay takes off ₦15,000 and settles the order; it never puts
  the order into credit and never starts a refund. The panel says so plainly
  before you apply, including how much of the code's value is not carried
  forward — applying it still marks the code used, so tell the customer.
- *Applying a code cleared the balance — does the order settle?* Yes, and the
  panel warns you before you commit. The moment the balance reaches zero the
  order settles exactly as a final payment would: stock is drawn, the invoice
  is marked paid and any Stylist Studio job opens.
- *Can I put a second discount code on an order?* No — an order holds one code.
  If a code is already on the order the Payments card names it instead of
  offering the field. Use **Change Order** if the pricing needs to move again.
- *"Apply a discount code" isn't showing?* Three reasons: the order has nothing
  left to pay (a code only reduces an outstanding balance), the order is
  completed / cancelled / refunded, or you don't have Sales **edit** permission
  — the same permission Record Payment and Change Order need.
- *Send a customer a pay link instead?* Open the order → **Pay Link** in the
  action bar. Leave the amount blank for the full balance, or type a
  part amount, then **Generate & copy pay link** and paste it into WhatsApp or
  email. What you copy is the order's own pay page, not a one-off checkout: it
  opens on the live balance (in dollars for a dollar order) with your part
  amount filled in. Quick Sale's **Copy** / **Share** and the delivery-fee
  top-up link work the same way (the in-store QR is still a direct checkout,
  paid on the spot).
- *The order changed after I sent a pay link — will they pay the old amount?*
  No. A pay link expires when what the order costs changes (Change Order, a new
  delivery fee, a discount, a currency re-lock). Opened afterwards, it tells the
  customer the order was updated and shows what's due now; the old amount is not
  offered. A payment already recorded does not expire it — the page just shows
  the smaller balance.
- *Jump between an order and its invoice?* Four ways, all one click: the order
  page's invoice strip links to the invoice (click the invoice number or **View
  Invoice**); the invoice's order strip links back (click the order number or
  **View Order**); the Orders list has an **Invoice** column; and the Invoices
  list has an **Order** column.
- *What do the order statuses mean?* An order moves through seven stages:
  **Pending Payment** (placed, nothing paid) → **Partially Paid** (part payment
  in; the deposit sits as a liability, not yet revenue) → **Paid** (paid in
  full) → **Assigned** (a stylist is working on it) → **Order Ready** (packed,
  waiting for the courier) → **Dispatched** (handed to the courier / on its
  way) → **Completed** (delivered or collected). Most of these move
  automatically: recording payment drives Partially Paid / Paid; assigning a
  stylist in Studio sets Assigned; a Studio QC pass sets Order Ready **once
  every item on the order has passed QC** (see below); the courier hand-off sets
  Dispatched; delivery sets Completed. Cancellations are a separate side-flow
  (**Cancel Requested** / **Cancelled**).
- *The order page shows a status like "Assigned" but a pill saying "Part paid" —
  which is right?* Both. The big status chip is the order's **stage**; the first
  pill in the strip beneath it (next to Studio and Delivery) is its **money**,
  read straight off the order's total, amount paid and balance: **Unpaid** ·
  **Part paid** · **Paid** · **Overpaid** · **Refunded** (**No charge** for a
  ₦0 order). They diverge on purpose — a layaway or deposit order carries on
  through Assigned, Order Ready and Dispatched while a balance is still
  outstanding, and the stage never rewinds to say so. If the pill says anything
  but **Paid**, the customer still owes money (or is owed it): the balance is in
  the header beside the order number, and **Record Payment** / **Pay Link**
  clear it.
- *Why does Sales → Orders → Partially Paid show orders marked Assigned, Ready
  or Dispatched?* That filter is the **collection list**, not a stage filter:
  it shows every live order that has received some money and still has a
  positive balance, regardless of its fulfilment stage or payment plan. A
  customer who has paid ₦0 stays under **Pending Payment** instead. Draft,
  Cancel Requested, Cancelled, Refunded and Failed orders are excluded from
  the collection list.
- *An order with several products — when does the customer get told it's ready?*
  **Only when all of them are ready.** An order with three products opens three
  Studio jobs, one per item. The first two QC passes finish their own item and
  credit their stylist, but the order stays where it is: no status change, no
  "Order Ready" message, no delivery booked. The third pass releases everything
  at once — the order moves to **Order Ready**, the customer gets one message,
  and Logistics gets one delivery for the whole parcel. The order's **Stylist
  Studio** panel shows the running count ("2 of 3 items ready"), and the
  Logistics queue shows the order as **Still in the studio** with the specific
  job that's holding it up. An item that is cancelled or rejected no longer
  counts as outstanding, so a written-off wig can't strand the rest.
- *Move an order's status myself?* Open the order → use the **Move to…**
  dropdown in the top action bar to nudge a paid order forward (e.g. mark a
  walk-in **Completed** the moment the customer's happy, or **Dispatched** when
  the rider takes it). Only the fulfilment stages are offered — payment and
  cancellation states are handled automatically. Moving to a customer-facing
  stage sends the matching message if it's switched on in **Messaging settings**.
  You *can* force **Order Ready** while items are still being styled — the
  confirmation warns you how many are outstanding — but the customer is told the
  whole order is ready, so use it only when you really are releasing early.
- *We recorded the WRONG PRODUCT on an order — how do I fix it (she's already
  paid)?* Open the order → **Change Order** in the top action bar
  (`/sales/orders/<orderId>`). This is the only place an order's items can be
  changed, and it works right up until the order is marked **Completed**. It
  opens the **same catalogue picker as Quick Sale** — Base Product · Styled
  Product · Bundle · Service, with the head-size/lace/colour chooser for styled
  wigs — so you swap the wrong item out, add the right one, and adjust
  quantities or prices in one cart. **Delivery details are on the same screen**,
  so "swap the wig AND fix her address" is one change and one message to her.
  Before you save it shows exactly what will happen: the old total → the new
  total, how much more she owes (or how much is now in credit), and a warning
  list you have to tick — studio work already under way, a parcel already with
  the courier, items that will have to be pre-ordered. A short **reason is
  required**; it goes on the audit trail. Nothing is written until you press
  **Save changes**.
- *What actually happens when I change an order?* Everything moves together, in
  one go: stock (the removed wig goes back on the shelf, the new one comes off
  — or is recorded as a **pre-order** if it isn't in stock), the **books** (an
  adjusting journal for the difference, only when the order was already paid),
  the **invoice** (re-issued with the new items and totals; a paid invoice goes
  back to *Partially Paid* when the swap costs more), **Stylist Studio**
  (unstarted jobs for removed items are cancelled; a new styling item opens a
  new job), **Logistics** (the parcel's contents and address are re-synced
  while it's still with us), the order **timeline**, and the **customer** —
  she gets an "Order Updated" message with what changed and a link to pay the
  difference. Turn that message off with the **Notify the customer** toggle if
  you're already on the phone with her.
- *She now owes more after the change — how does she pay it?* Exactly as
  before: the order goes back into balance and she pays through her normal
  **Pay Link**, or you **Record Payment** on the order. The "Order Updated"
  message already carries the link.
- *The change made the order CHEAPER — where does her money go?* It stays on
  her account as a credit (it shows on the order as "credit due to the
  customer"). Refunding it is a Finance decision, not an Orders-screen one —
  raise it with Accounts.
- *Can I change an order that's already completed?* No. Once the job is marked
  **Completed** the Change Order button disappears and the system refuses —
  raise a new order or a return instead. It's also blocked while a
  **cancellation is waiting for a decision**: settle that first.
- *Where do I see what was changed on an order, and by whom?* Open the order →
  the **Change history** card, directly under Items. Every change is listed
  with its number ("Change #2"), what moved, the old total → the new total, the
  reason someone typed, who made it and when, and what it did downstream
  ("Books adjusted · Invoice FLH-INV-0043 revised · 1 back to stock · Customer
  notified"). The order also carries a **Changed ×N** badge at the top.
- *Who can change an order?* Anyone with the `sales` **edit** right — the same
  people who can cancel an order. (Cancelling is the more destructive act, so
  repairing an order is deliberately no harder to reach.)

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
and hands that wig over to Logistics; shipping + delivery live on the Sales
Order / Logistics side. An order with several products has **one job per
item**, and its customer-facing "Order Ready" step waits for the last of them.
**Where.** Run → **Stylist Studio** · `/service-jobs`
**Who can see it.** `service_jobs` permission. **The `approve` right decides
the layout:**
- **Without `approve`** (individual stylists, and the front desk) see **only
  their own queue** — the **My Jobs** and **Recipes** tabs. Every ops surface
  is hidden, and the API only ever returns their own jobs.
- **With `approve`** (Ops Manager / CEO) see every tab: My Jobs · Job Board ·
  QC Queue · Wig Accountability · **Unbilled Jobs** · Team Scorecards ·
  Service Types · Recipes · Chemical Reconciliation.

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
- *Does assigning a stylist take the hair out of stock?* **No — assigning moves
  nothing.** The **sale** is the only thing that deducts stock (when the order
  is paid). Assigning is a **custody** event: the hair passes from the business
  to the stylist and the wig custody ledger records who holds it. The quantity
  does not change, so one hair is never counted out twice.
- *"This hair isn't in stock" when I try to assign?* The assignment is
  **blocked**, and it is telling the truth: the sale never drew this unit and
  no reservation is holding it, so there is physically nothing to hand the
  stylist. This happens when the hair sold as a **pre-order**, or when the
  order was **paid but the stock was never there** (payment is deliberately
  never blocked by missing stock). **Fix it, don't work around it:** if the
  hair has physically arrived, press **Receive stock** on the message — it
  deep-links to Stock → **Goods Reception** — then assign. There is no override,
  because no acknowledgement conjures a wig. Jobs on the **customer's own
  hair** never hit this: our stock isn't involved.
- *Assigning a job that has no sales order?* Allowed, but the confirm dialog
  shows a red **"No sale behind this job"** warning and you must tick the
  acknowledgement before **Confirm** unlocks. It still won't go through if the
  hair it names isn't on the shelf (above).
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
- *Creating a job by hand — "What is this job?"* Required, because **every
  revenue needs a sale**. Pick one: **Customer work — our hair** or
  **Customer's own hair — styling fee** (both mean a sale is **owed**, and the
  job goes on the Unbilled Jobs queue until one is raised), or **Internal —
  content / sample / staff** (no sale will ever be owed; you must say what it
  is for, e.g. "July campaign shoot").
- *Find every job with no sale?* Ops → **Unbilled Jobs** tab
  (`/service-jobs?tab=unbilled`), or click the **No Sale (owed)** tile. It
  lists jobs with no sale **at every stage** — not just completed ones — with
  filter chips: Owes a sale · Unclassified · Customer — our hair · Customer —
  own hair · Internal · **Show all**. Nothing is hidden; internal jobs are just
  filtered out of the default view.
- *Get the missing sale raised?* Open the job (or its row on Unbilled Jobs) →
  **Notify Sales**. Everyone who can create a sale is notified, with Quick
  Sale **pre-filled** from the job. The badge then reads **"Sales notified"**
  with who asked and when, so the same job isn't chased three times.
- *A job on the Unbilled list was never meant to have a sale?* Use **Mark
  internal** and say what it was for. It leaves the "owes a sale" count but
  stays visible under the Internal / Show all filters.
- *What does "Unclassified" mean on Unbilled Jobs?* The job was opened before
  the Studio asked why it had no sale, so nobody has said whether one is owed.
  Notify Sales for the ones that are; mark the rest internal.
- *QC pass or fail a returned job?* Ops → **QC Queue** tab. Pass = job
  completed + wig staged for its order; fail = back to stylist for rework. On a
  multi-item order the parcel is only booked and the customer only told once
  **every** item has passed — the order screen shows "2 of 3 items ready" until
  then.
- *See a stylist's scorecard?* Ops → **Team Scorecards** tab.
- *See my own scorecard?* Stylist → My Jobs — the "Your scorecard" tile is
  at the top of the queue.
- *Add a chemical recipe?* Ops → **Recipes** → **New Chemical Recipe**.
- *A stylist opened a job that was reassigned to someone else?* The drawer
  shows "reassigned to X → back to my jobs" (no bare 403).
- *A job was cancelled and nobody in Studio did it?* Someone changed the order
  it belonged to (Sales → open the order → **Change Order**) and that item is
  no longer being bought. Jobs that hadn't finished are cancelled automatically;
  a job that was **already completed** is deliberately left alone — the labour
  happened and it stays on the stylist's scorecard — it simply detaches from the
  order, so Ops can reassign the finished unit to stock or to another order. The
  order's **Change history** card names who made the change and why.

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

### 4.5b How approvals reach you (every module)

**What it is.** One behaviour for every approval in the Hub — stock
adjustments, cash requests, expenses, purchase orders, price changes,
campaigns, intercompany.

**When a request is submitted.** Everyone who can approve it gets **a task on
their Workspace and a notification**, both linking straight to the request.
Two-tier approvals ask one tier at a time: the second tier is only asked once
the first has passed it up.

**When you click either one.** You land on the request itself — the stock
adjustment in Stock → **Adjustments**, the cash request in Cash Requests →
**Approval Queue**, the expense in **Expenses** — with the detail and the
Approve / Reject buttons in front of you.

**When a decision is made.** Every approver's task for that request closes
itself (including tiers that never got to act), and the person who raised it
is notified of the outcome with a link back. Nobody marks approval tasks done
by hand.

**If nothing arrived.** The request may not have been *submitted* (a draft
notifies nobody), or no one holds the module's **approve** permission — check
Org & Workflow → the permission matrix.

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
- *A task says "Approve …" — where do I actually approve it?* Open the task
  and click **Open <record>** at the top of the detail panel. It takes you
  straight to the request (the adjustment, the cash request, the expense),
  where the Approve / Reject buttons are. Clicking the notification does the
  same in one hop. **You never tick an approval task off yourself** — deciding
  closes it automatically, for every approver at every tier.
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
- *See the documents HR holds on me (contract, guarantor form, NIN, passport
  photograph)?* Workspace → **My HR** → **My documents**. You can preview and
  download your own files; uploading is HR's job, so anything still
  outstanding shows as a "HR still needs:" chip. Contracts issued to you stay
  in the separate **Contracts** card.
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
**What's inside (tabs).** **Overview** · **Goods Reception** ·
**Available Products** · **Movements** · **Transfers** · **Adjustments** ·
**Alerts** · **Locations**.
**Common tasks.**
- *See every product we have in stock, and how many?* Stock → **Available
  Products** tab (`/stock?tab=products`). One row per **base product** with its
  **on hand**, **reserved** and **available** units summed across all its
  variants and locations, plus how many locations hold it and when it last
  moved. Search by product name, product code or SKU; filter by **location**
  and by **In stock / Low / Out of stock**; sort by most stock, name, lowest
  stock or recently moved. Tap a row to open that base product in Catalogue.
- *How many of one particular wig do we have?* Same tab — type its name or SKU
  into the search box; the count is the **Available** column (**On hand** minus
  what's already **Reserved** for orders).
- *Which products are about to run out?* Stock → **Available Products** →
  **Low** chip (below the reorder point), or the **Alerts** tab for the alert
  queue.
- *Receive incoming goods?* Stock → **Goods Reception** tab.
- *Move / transfer stock between locations?* Stock → **Transfers** → **New Transfer**
  / **Create Transfer**.
- *Do a stock count / stocktake?* Stock → **Adjustments** → **New Stocktake**
  to type it in, or **Import Count** to upload a filled-in spreadsheet.
- *Log a write-off / damage?* Stock → **Adjustments** → **Log Write-off** /
  **Log Stock Movement**.
- *See where a movement came from — which order, which channel, who processed
  it?* Click any row in **Overview → Recent Movements** or in the **Movements**
  tab. The **movement detail** panel names the source document (sales order,
  adjustment, transfer, goods reception), the customer and sales channel, who
  processed it, and the other lines of the same operation, with an
  **Open order** / **Open adjustments** link straight to it.
- *A movement looks wrong — how do I get it corrected?* Open the movement →
  **This looks wrong — request a correction**. Movements are append-only, so
  this files a **stock adjustment** (system count vs the correct physical
  count) and submits it to the normal approval queue on Stock →
  **Adjustments**; the count changes only once it is approved and posted.
- *We recounted everything on a spreadsheet — how do we make that the system's
  numbers?* Stock → **Adjustments** → **Import Count**. Download the **Excel
  template** (one row per product, already filled in — you only type the Units
  column), fill it, upload it, and the review screen shows every line as
  `system → counted` with the unit total the location will end on. Pressing
  **Submit for Approval** files **one** `count` adjustment; the count becomes
  the system's number only once it is approved and posted on that same tab.
  Two things to know: **Goods Reception adds units, a stock count replaces
  them** (a wig the system thinks we have 9 of, counted at 2, is corrected to
  2 — not raised to 11); and the whole recount is one approval, so whoever
  signs it owns all of it. The review screen also asks two questions —
  what a **blank Units cell** means (we hold none / not counted) and what
  happens to **products not on the sheet** (zero them / leave alone) — and
  re-totals live as you switch them. Rows that match no product block the
  import until they are fixed. Ops can run the same import headless with
  `npm run stock:import-count` — see `docs/STOCK_COUNT_IMPORT.md`.
- *Do a stock count by hand instead?* Stock → **Adjustments** → **New
  Stocktake** — pick the location, type physical counts against the system's,
  review, submit. Counts you type are kept as you page through the list.
- *A wig was counted out twice (sale + stylist assignment)?* Historic
  double-deductions are repaired by a one-off run that files **found**
  adjustments into Stock → **Adjustments**; approve and post them to put the
  units back. New assignments can no longer double-count — the sale is the only
  path that deducts.
- *See what's running low?* Stock → **Alerts** tab.
- *Add a warehouse / location?* Stock → **Locations** → **Add Location**.

### 4.8 Catalogue
**What it's for.** Products and variants. The Hub uses a **base product** (the
raw item) → **styled product** (the sellable, styled version) model, plus
categories, collections, bundles, shades, and bookable services.
**Where.** Operate → **Catalogue** · `/catalogue`
**Who can see it.** `catalogue` permission.
**What's inside (tabs).** **Styled** · **Base** · **Care & Accessories** (Pixie
Girl only, while switched on in Config) · **Categories** · **Collections** ·
**Shades** · **Bundles** · **Services** · **Config**.
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
  order links, **the Sales → Quick Sale form and Quotations**, and **changing an
  already-placed order** (Sales → order → Change Order). A change that swaps an
  out-of-stock size for one an adjacent base can fill takes the units from that
  base instead of writing the line as a pre-order. When it fires, the order line
  is repointed to the sibling SKU actually taken off the shelf and carries a note
  telling the stylist which unit to resize, so the picklist never sends out the
  wrong size unresized — and the change screen says the item will be resized
  rather than pre-ordered. An order that was a pre-order **stops being one** as
  soon as a change puts its units on the shelf (or a change tops up what it was
  still short of).
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
- *See a product's picture in full / bigger?* On **Styled** or **Base**, every
  product picture carries an **expand icon** (top-right of the card image, or
  bottom-right of the thumbnail in list view). Click it to open the photo full
  screen so you can show the hair properly — there's a download button, and Esc
  or a click outside closes it. Clicking the card anywhere else still opens the
  product as before.
- *Create a bundle?* Catalogue → **Bundles** (fixed price or % off the total).
- *Group products for a campaign?* Catalogue → **Collections** → add to collection.
- *Put a product in / take it out of a collection, bundle, or shade?* Open the
  styled product → the right sidebar's **Add to collection**, **Add to bundle**,
  and **Shop by shade** pickers show where it already lives as chips; click a
  chip's **✕** to remove it, or search to add it somewhere new.
- *Add a bookable service (Faitlyn)?* Catalogue → **Services** → **New Service Type**.
- *Turn Care & Accessories on or off (Pixie Girl)? / I can't see the Care &
  Accessories tab?* Catalogue → **Config** (`/catalogue?tab=config`) → **Care &
  Accessories** → toggle. It's **on by default**; the tab appears/disappears
  straight away. There is no server setting to change. **Off** hides the tab
  and stops new care items and new care sales everywhere (Quick Sale, quotes,
  order links, campaigns, the shop) — care orders already placed still get
  their delivery-fee review and go out, and nothing is deleted. Needs
  Catalogue **edit** permission. Not offered on Faitlynhair.
- *Add a comb, hair oil or other accessory (Pixie Girl)?* Catalogue → **Care &
  Accessories** (`/catalogue?tab=care`) → **New care item**
  (`/catalogue/care/new`). Give it a name, category, tax treatment (exempt, or
  taxable with the approved VAT rate) and one or more **options**, each with its
  own exact SKU, storefront and staff/POS price (e.g. "50 ml" and "100 ml"). It
  starts as a **draft**. Open an existing one at `/catalogue/care/<id>`.
- *Put a care item on sale?* Open it → add a photo and prices on every active
  option → **Publish**. Published items are sellable on every enabled channel.
  **Editing** details, prices, options or photos returns it to **draft** (off
  sale) until you publish again. **Archive** takes it off sale; an archived item
  has **Return to draft**.
- *Receive or count care stock?* Catalogue → **Care & Accessories** → **Receive
  SKUs** (adds stock; needs a positive operational unit cost and Cost Vault
  access) or **Count SKUs** (replaces the on-hand count at one location; goes for
  approval). Both match by **exact SKU** — never by name — and have
  download-able templates. Care items can also be bought on a purchase order by
  exact SKU (Purchasing → new PO → **Or order a Care & Accessories SKU**).
- *Bulk-create care items from a spreadsheet?* Care & Accessories → **Import /
  export** (create-only; one row per SKU, repeat the product code to group
  options).
- *Set the dollar (USD) rate or dollar prices?* Catalogue → **Config** →
  **Apply USD exchange rate**: enter one ₦ per $1 rate, pick the rounding
  (exact, whole dollars or .99) and apply — every USD price in the catalogue is
  recomputed from its Naira price (undo reverts the last apply). **Changing the
  rate needs the CEO.** The CEO's Apply takes effect at once; anyone else's
  button reads **Request approval** and sends the CEO a task — nothing changes
  until they open Catalogue → Config → **Review request** and choose **Approve &
  apply** (it applies the rate that was requested) or **Reject**. Only one
  request can wait at a time, and only the CEO can undo. That rate is
  the ONLY ₦/$ rate for sales: the website, sales campaigns, Quick Sale and
  pay links all use it (Settings → Currencies does not override it). A
  product's own USD price — including one you edit by hand — is exactly what a
  dollar customer pays for it; a product with no USD price converts at the
  rate, rounded up to the dollar.
- *Why does a dollar customer pay $249.99, not ₦ ÷ rate?* Dollar checkouts
  charge each product's catalogue USD price; a campaign or discounted price
  keeps the same percentage off in dollars, and delivery converts at the rate.
  The order locks its dollar total when it's placed, so later rate changes
  never reprice it. Payments are taken in Naira or US Dollars only (Nomba).

### 4.9 Logistics
**What it's for.** Getting orders to customers — the delivery queue, active
deliveries, couriers/agencies, shipping rates, and the per-delivery
profit/loss reconciliation.
**Where.** Operate → **Logistics** · `/logistics`
**Who can see it.** `logistics` permission.
**What's inside (tabs).** **Queue** · **Active** · **Delivered** · **Issues** ·
**All** · **Reconciliation** · **Agencies** · **Shipping Rates**.

**The Queue is banded.** A delivery is created automatically the moment an
order is *paid*, which is usually before the wig is finished. So the Queue
splits into **Ready to dispatch** (the order is packed and any styling job is
out of the studio) and **Not ready yet** (still with a stylist, or the order
isn't packed). The number on the Queue tab counts only the ready ones. Unready
deliveries stay visible so couriers can be pre-arranged for out-of-state drops.

**Marking a delivery complete.** Staff do this in the Hub — open the delivery
and press **Mark delivered**. It is available from any live state: if a rider
phones in a delivery that was never clicked through the intermediate states,
the Hub records the skip on the timeline rather than refusing the update. Every
completed delivery shows **who marked it and when** on the Delivered list and
in the detail panel. *(There is no longer a public driver confirmation link —
it was retired; drivers report in and staff mark it.)*

**What the customer is told.** Booking a courier now messages the customer
automatically with the shipment details — the shipper/agency, the waybill or
AWB, the pickup and expected-delivery window, the rider's name and phone where
one was entered, and a tracking link. It sends on whichever channel the CEO
picked for **Delivery Booked** in the Automated Messages Studio (Messaging →
settings; email by default), and
the booking confirmation screen states plainly whether it went out and to
which address. Untick **Tell … it's booked** on the review step to book
silently. A separate message fires later, when the courier physically collects
the parcel ("Order Shipped"), and again on delivery.

**Checking the customer actually heard.** Open the delivery → **Customer
updates**. A Sent → Delivered → Opened stepper sits over the full send history
(every attempt, on every channel, with the reason for any that failed).
**Resend** is on the same panel, for a waybill typed wrong or a courier changed
after booking.

What each stage actually means, because the Hub never guesses:

- **Sent** — the message left us and the provider accepted it.
- **Delivered** — the receiving service confirmed it arrived. Real for WhatsApp
  and Instagram always, and for email when the mail provider reports back. Rows
  the provider reported are labelled *via SendGrid / Mailgun / Resend* etc.
- **Opened** — she loaded her tracking link, or the mail provider saw the
  message opened. The tracking-link signal is the stronger one: email open
  tracking over-counts on iPhones (Apple pre-loads images whether or not she
  looked) and misses anyone who blocks images.
- **Bounced** — the address rejected it, with the mail server's reason. She
  never got it and never will at that address: fix the email on her contact
  record, then **Resend**. A bounce overrides Delivered.
- **Marked spam** — it arrived and she pressed "this is junk". Stop emailing
  her until she asks.

If Delivered never lights on email for anybody, the mail relay probably can't
report back (Zoho and Google Workspace never do). That's a setup question for
whoever runs the server, not a fault on the delivery.

**Delivery money.** Two figures, never mixed up: what the customer was charged
for shipping (from the sales order), and what we actually paid the courier
(recorded on the delivery). A delivery can carry several costs — a redelivery
after a failed attempt is real money against the same one-time revenue. If the
amount paid out exceeds what the customer paid, the Hub **does not block the
entry** — it saves it, calculates the shortfall, and flags the delivery as a
loss. Free deliveries should be marked with a **fee waiver reason** (promo,
remake, apology reship) so they don't read as losses in the report.

**Common tasks.**
- *Dispatch / assign a delivery?* Logistics → **Queue** tab → **Ready to dispatch** → open it → **Book delivery**.
- *Book a courier before the wig is finished?* Same flow — the Hub warns that it isn't ready and asks you to confirm; the early booking is recorded on the timeline.
- *Tell the customer her delivery is booked?* It's automatic on **Book delivery** — shipper, waybill, expected date and a tracking link. Untick **Tell … it's booked** on the review step to skip it.
- *Check whether the customer got the delivery details?* Open the delivery → **Customer updates** (Sent → Delivered → Opened, plus every attempt).
- *Customer says she never got the email?* Open the delivery → **Customer updates**. **Bounced** means her address rejected it — fix the email on her contact record and **Resend**. **Delivered** with no **Opened** means it reached her inbox and she hasn't looked (check spam with her).
- *Resend the delivery details to a customer?* Open the delivery → **Customer updates** → **Resend**.
- *Change what the booking message says, or send it on WhatsApp instead?* Messaging → settings → **Automated Messages Studio** → **Delivery Booked** (`comms_studio` permission).
- *Stop the booking message going out at all?* Same place — switch **Delivery Booked** off.
- *Mark a delivery completed?* Logistics → open the delivery → **Mark delivered**.
- *See who completed a delivery and when?* Logistics → **Delivered** tab (shown on each row), or open the delivery for the full timeline with names.
- *Record what a delivery cost us?* Open the delivery → **Delivery cost** → **Add cost**.
- *See deliveries that lost money?* Logistics → **Reconciliation**, or look for the red "Loss" chip on a delivery row.
- *Find deliveries nobody costed?* Logistics → **Reconciliation** → "with no cost recorded", or the "Cost not recorded" chip on the row.
- *See which courier or destination loses money?* Logistics → **Reconciliation** → **By courier** / **By destination**.
- *Mark a delivery as deliberately free?* Open the delivery → **Mark fee waived**.
- *Track a delivery / see failed attempts?* Logistics → **Active** or **Issues**.
- *Add a courier/agency?* Logistics → **Agencies**. Set **How we pay them** — invoice (DHL, GIGL) or per drop (Uber and similar).
- *Set shipping rates by destination?* Logistics → **Shipping Rates**.
- *The order changed — is the parcel still right?* Yes, as long as the courier
  hasn't collected it. Changing an order (Sales → open the order → **Change
  Order**) re-syncs the delivery's contents and address automatically while it
  is still **Queued** or **Booked**. Once it's **Picked up** or later we leave
  the parcel alone — the person making the change is warned about that before
  they save, and the order's **Change history** records that the delivery was
  not updated.

### 4.10 Purchasing
**What it's for.** Buying stock and imports — purchase orders (POs), suppliers,
goods-received notes (GRNs), and supplier invoices.
**Where.** Operate → **Purchasing** · `/purchasing`
**Who can see it.** `purchasing` permission.
**What's inside.** Purchase Orders · **GRNs** · **GRN & Invoices** · Suppliers.
**Common tasks.**
- *Raise a purchase order?* Purchasing → **New Purchase Order** / **Create PO**.
  Step 1 picks the supplier, the **order currency** (CNY/USD/NGN…), the **FX
  rate to NGN** (locked onto the order, so later rate moves never rewrite what
  it cost), the **delivery location** and expected date. Step 2 adds lines:
  pick the **base product** being bought — that is what lets the warehouse
  receive it later — plus quantity, unit price and optional wig attributes.
  A line with no base product still orders fine (freight, samples, a style not
  yet in the catalogue); it just can't be received straight into stock.
  Ordering many items? Use **Bulk Add** on step 2: pick a product type, search,
  and tick everything you're buying (the ticks survive changing the search term
  and the type, so one batch can mix bases, styled products and bundles), then
  press **Add lines** — each ticked product becomes its own line at quantity 1,
  ready for you to set quantities and prices.
- *Add a supplier?* Purchasing → **New Supplier** / **Create Supplier**.
- *Receive goods against a PO?* Open the PO → **Receive goods**. It opens Stock
  → **Goods Reception** already filled in: the delivery location from the
  order, and every line still due at its outstanding quantity. Change any
  quantity to what actually arrived and post — stock goes up and the PO
  updates itself. A short delivery leaves the balance **outstanding** and the
  PO reads **partially received**; click **Receive goods** again when the rest
  lands. (Purchasing → **GRNs** remains the formal goods-received note for
  supplier-invoice matching.)
- *Match a supplier invoice?* Purchasing → **GRN & Invoices**.
> Big POs may need approval before they're sent — the Hub routes them through the
> approval workflow.

### 4.11 Production
**What it's for.** The **China factory account** and **production runs** — funding
the factory, tracking runs from planned → in production → arrived, and building
**landed cost** (product + shipping + customs) so margins are real.
**Where.** Operate → **Production** · `/production`
**Who can see it.** `production` permission (`production:create` to open a run,
`production:edit` to add products and costs). Worked by **both the CEO and the
China factory manager** — the page defaults to Chinese for `factory_manager`
users and the language selector sits in the page header.
**What's inside (tabs).** **Overview** · **Factory Account** · **Production Runs**.
**Common tasks.**
- *Start a production run?* Production → **Production Runs** → **New Run**.
  Step 1 is the title, the **factory currency** (CNY/USD/NGN…), an optional
  **purchase order** to build the run from, and expected arrival. Step 2 is the
  products: search the catalogue (or **Bulk Add** to tick several at once), set
  a **quantity** and a **unit cost** per product. Each unit gets its own code
  (`FLH-RUN-0002-001`), and the priced lines become the run's factory cost.
- *Where does the cost come from?* Two places, both landing in the run's **Cost
  Components**: (1) the **product lines** on the run — quantity × unit cost,
  which is what the factory invoices; (2) **Add Cost** on an open run for
  everything else — international freight, customs duty, clearing fees, port
  storage, 3PL Lagos, packaging, styling, wastage, samples. Foreign amounts are
  converted to NGN at the system FX rate, which is pre-filled and editable if
  you converted at a different rate. The Hub re-computes the run's **per-unit
  landed cost** after every cost added — that figure is the cost basis for
  pricing and COGS.
- *Add more products to a run already open?* Open the run → **Add Products**.
- *Record what the factory charged?* Open the run → **Add Cost** → pick the cost
  type, amount and currency, add the invoice reference.
- *Move a run along?* Open the run → **Advance Status**: planned → funded → in
  production → quality check → ready to ship → in transit → arrived Lagos →
  cleared customs → received → completed.
- *Receive finished units into stock?* Open the run → **Receive Units** → choose
  the product, the **Lagos location** and the quantity. This posts a
  `production_in` stock movement at the run's per-unit landed cost. Needs
  `stock:edit` as well as `production:edit`, so it is a Lagos-side action — the
  China factory manager does not see this button.
- *Fund the factory / record a factory payment?* Production → **Factory Account**
  (records payments, charges, credits in CNY/NGN).
- *See landed cost of a batch?* Open the production run in the **Production
  Runs** tab. Note: **Naira cost is hidden from the `factory_manager` role** —
  they see and enter the factory's own currency figures, never the NGN landed
  cost or per-unit cost.
- *The screen is in English but I chose Chinese?* The whole Production module is
  translated. If a language added under Settings → **Factory Languages** is
  missing keys, those strings fall back to English — re-upload the bundle with
  the full key list from the downloadable guide.

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
refunds, and a live view of who still owes us (accounts receivable ageing).
**Where.** Finance → **Invoicing** · `/invoicing`
**Who can see it.** `invoicing` permission.
**What's inside (tabs).** **Invoices** · **Owed to Us** · **Refunds** ·
**Settings**.
**Common tasks.**
- *Create an invoice?* Invoicing → **Invoices** → **New Invoice** / **Create Invoice**.
- *Issue a credit note / refund a customer on the books?* Invoicing → **Refunds**
  → **New Credit Note** / **Issue Credit Note**.
- *See who's overdue?* Invoicing → **Owed to Us** tab.
- *Record a payment against an invoice?* Open the invoice → **Record Payment**.
  For an invoice raised from a sales order, the amount, the bank's transaction
  reference and the bank name are all required: that payment is recorded
  against the **order** (which owns the money) and mirrored back onto the
  invoice in the same instant, so the order's status, the stock, the books and
  the receipt all move together. Recording it from the order page does exactly
  the same thing — use whichever screen you're already on. Manual entry honours
  the same Sales → **Payments** switch in both places.
- *Apply a discount code from the invoice?* Open the invoice → **Apply a
  discount code**, in the same place you record a payment. It only appears on an
  invoice raised from a sales order, because the discount applies to the
  **order** — the invoice is re-issued from it in the same instant. Check the
  code first to see the new total and balance, then apply. The waiver is capped
  at what is still owed, so it can settle the invoice but never put it into
  credit. Doing it from the order page does exactly the same thing.
- *Which order is this invoice for?* The invoice names it at the top: click the
  order number, or **View Order**, to open it. The order page links back to the
  invoice the same way, and the Invoices list carries an **Order** column.
- *Who accepted a payment on an invoice?* Each row in the invoice's **Payments**
  list names the staff member who applied it and when, and staff-recorded rows
  also show the bank name and transaction reference. Gateway captures say so
  rather than naming a person.
- *This invoice's items changed by themselves — why?* Its order was amended
  (Sales → open the order → **Change Order**). An order-backed invoice is a
  view of its order, so it is re-issued with the new items and totals in the
  same instant, and the PDF is re-rendered. If the change made the order more
  expensive, a **Paid** invoice correctly drops back to **Partially Paid** and
  starts showing the outstanding balance again. A **voided** or **refunded**
  invoice is never touched — it's a closed document. The order's **Change
  history** card explains what happened.

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
- *Where do dollar (USD) payments sit in the books?* In **1141 Nomba Settlement —
  USD Wallet** (Chart of Accounts), not the Naira **1140 Nomba Settlement**. Each
  USD capture debits it with the Naira value at the order's locked rate and
  carries the dollars received on the journal line; Nomba's fee on a dollar
  payment nets against the same wallet. Post a journal to clear it when Nomba
  pays the dollars out or converts them.
- *There's a second journal against one sales order — is that a duplicate?* No.
  A sale posts exactly one **Sales** journal. A second entry described "Order
  amended (change #N) — <order number>" is an **adjusting** journal posted when
  someone changed an order that had already been paid: it books only the
  DIFFERENCE in revenue, shipping and VAT, plus the cost of any item newly sent
  out. Items that came back to stock reverse their own cost through a stock
  **return** movement instead, so nothing is double-counted. The money the
  customer still owes (or is owed) sits in **Customer Deposits 2400** until she
  pays it or Finance refunds it. Sales → open the order → **Change history**
  shows who made the change and why.

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
· **Devices** · **Queries** · **Targets** · **Rewards** · **Vacancies** ·
**Recruitment** · **Analytics** · **Settings** · **Onboarding**.
(**Vacancies** and **Recruitment** both need the `recruitment` permission.)
**Common tasks.**
- *Open an employee's file?* HR → **Directory**, click a person →
  `/hr/employees/<profileId>`. The file has six tabs: **Profile** ·
  **Attendance** · **Pay** · **Performance** · **Queries & Leave** ·
  **Documents**.
- *Upload an employee's contract, guarantor form, NIN slip or passport
  photograph?* Open their file → **Documents** tab → **Upload**. Pick the
  document type, choose a PDF or image, Save. Photos are compressed (and HEIC
  converted) automatically.
- *File a document type that isn't in the list (e.g. Work Permit)?* In that
  same upload panel, **New type** → name it, say whether it's required for
  every employee and whether it accepts a PDF, an image or either → **Add
  type**. It's then available for every employee, on this brand.
- *See who's missing paperwork?* The **Documents** tab shows a
  "**N required documents missing**" strip at the top listing the required
  types this person has no file for — click one to upload it straight away.
  When nothing is outstanding it reads "All required documents are on file."
- *Read a document without downloading it?* Click the row (or the eye icon) on
  the **Documents** tab — PDFs and images open in an in-page preview with a
  **Download** button.
- *Retire a document type?* HR → the type stays available to documents already
  filed under it: a seeded type, or one already in use, is **archived** (hidden
  from the picker) rather than deleted, so old files keep their label.
- *Why isn't an employee's contract in the Documents module?* By design.
  Employee documents are HR-only — they never appear in **Documents**
  (`/documents`) or in global search, whatever `documents` permission someone
  holds. They are reachable only from the employee's **Documents** tab
  (needs `hr_payroll`) and from the employee's own **My HR**. Uploading needs
  `hr_payroll` **edit**; removing one needs **delete**.
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
- *Post a job vacancy / advertise a role?* HR → **Vacancies** tab → **New
  vacancy**. Answer a few quick questions (type **or speak** them) and AI drafts
  the whole thing — job description, requirements, work model and a salary band —
  which you review and **Publish** to the public Careers page. The vacancy stays
  open for multiple hires until you close it.
- *Where do candidates see & apply for jobs?* On the brand's public **Careers**
  page — `/careers` lists every published role and `/careers/<slug>` is a single
  role with the no-login application form (CV + optional headshot + up to 3 work
  images + links). It's linked from the storefront footer ("Careers"). Brand is
  by domain (Faitlyn's site shows Faitlyn roles). Applications land in HR →
  **Vacancies** → the vacancy → **Applicants**.
- *See who applied / track candidates?* HR → **Vacancies** → open a vacancy →
  **Applicants**. Each applicant carries an **AI match score**, a pipeline stage
  (New → Screening → Shortlisted → Interviewed → Offered/Rejected), star ratings
  and internal notes. Open one to read the CV, work-sample images and links.
- *How does the AI shortlist candidates?* Every applicant gets an **AI match
  score** automatically — the AI reads their CV against the job description (tap
  **Score** on an applicant, or **Re-score all with AI** on the vacancy). It does
  NOT depend on any answers you type.
- *What are the 5 AI questions for?* Open a vacancy → **AI Screening** →
  **Generate questions** — 5 role-specific strategic **interview questions**. You
  don't answer them; instead, on each applicant's **Interview scorecard** you rate
  the candidate 1–5 stars per question during the interview, and their overall
  rating is the average. Candidates never see these questions.
- *Make an offer to a winning applicant?* Open the applicant → **Move to
  Offered**. This creates a pre-filled offer and jumps to the **Recruitment**
  tab, where you edit and send it.
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
- *Check why someone's pay is what it is / see one employee's full breakdown?*
  Payroll → open the run → click the employee (or **Review**). The breakdown
  drawer shows, for that person and that period: earnings and deductions side by
  side, **every flagged attendance day** (lateness, absence, off-site clock-in)
  with the reason, the money at stake, the system-raised query and **whatever the
  employee wrote back**, plus every **addition** — commission, bonuses and
  rewards — and the recoveries being taken. No need to leave Payroll for HR &
  Staff to work it out.
- *Waive or uphold a lateness / attendance deduction?* Payroll → open the run →
  click the employee → **Lateness & attendance** → **Waive** or **Uphold** on
  that line. Waiving stops that day costing the employee; upholding lets it
  stand. A waive can be reversed (**Reverse waiver**) while the run is still
  open. Needs `hr_payroll` **approve** rights — view-only and edit-only users see
  the evidence but not the buttons.
- *Apply the waivers and update the employee's pay?* After deciding, use
  **Apply & recalculate** at the bottom of the drawer — it recomputes that one
  employee's payslip from the current attendance, commission and bonus truth and
  rolls the run's totals forward. The drawer warns when a slip is out of date and
  shows what the net will become before you commit.
- *Why can't I waive anything?* Decisions lock once the run is **approved** or
  **paid**. Reverse the run first.
- *Download a payslip PDF?* Payroll → the run's payslips → **PDF** (or **PDF** in
  the breakdown drawer). It's a branded, full-page A4 payslip: employer identity,
  employee and period, itemised earnings and deductions, net pay in figures and
  words, employer contributions, and how the money was paid.

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
  recipients; the **paperclip** below the editor stages files (PDFs, images,
  docs) as chips to ride the same letter — and carries the same stock answers
  (Our address, Opening hours, Catalogue, Welcome form, Quick reply) as a chat
  does. One Send delivers the formatted body + subject + Cc
  + every file as a single **branded** email (the brand's logo, colours and
  footer are applied automatically). Press **⌘/Ctrl + Enter** to send;
  plain Enter makes a new line. (WhatsApp and Instagram stay a simple text box —
  those channels don't carry formatting, subjects or Cc.)
- *Start a brand-new conversation with a customer?* The **+** (top of the inbox
  list) → **Customer** tab → search the contact → pick **Send via** WhatsApp /
  Email / Instagram. Choosing **Email** opens the same rich Gmail-style writer
  with Subject, Cc and attachments; WhatsApp/Instagram show a simple first-
  message box.
- *How does the message box work?* It's laid out like WhatsApp: **emoji** on
  the left, the message box in the middle, **Praxis** (draft this reply) and
  the **paperclip** on the right. The round key on the far right is the
  **microphone** while the box is empty and turns into **Send** the moment you
  type — so a voice note is always one tap away. **Enter** sends,
  **Shift + Enter** starts a new line, and typing **/** opens your quick
  replies.
- *Attach something / send a stock answer?* Everything lives behind the one
  **paperclip**: Photos & videos · Document (Camera too, on a phone) ·
  **Our address** · **Opening hours** · Catalogue · Welcome form ·
  WhatsApp us · Quick reply. Tap a tile and the copy drops into the message
  box so you can edit it before sending.
- *Customer asks "where are you?" or "what time do you close?"* Paperclip →
  **Our address** or **Opening hours**. The address comes from
  **Settings → Business Setup** (the `address` field); the hours start as
  *Monday to Saturday, 9:00 AM – 8:00 PM*. Both land in the box as normal
  editable text — change the wording, then either just send it, or press
  **Save as default** on the chip above the box to make your wording the one
  that appears next time (per brand). Same pattern as the Welcome form and
  WhatsApp follow-up inserts.
- *Share products / a bundle / a service in a chat?* Open the conversation →
  the **paperclip** → **Catalogue** → pick Base / Styled / **Bundle** /
  Service items → **Send**. The customer gets photo cards plus one short
  order link (`/o/<slug>`) to pick, confirm delivery, and pay.
- *Send an IG/WhatsApp order link a customer pays in dollars?* In the same
  **Catalogue** picker, switch the footer toggle to **Pay in $** before
  **Send** (default **Pay in ₦**). The link shows each item at its catalogue
  USD price and charges dollars on Nomba; the customer can't switch it. A $
  link needs the dollar rate set first (Catalogue → **Config** → **Apply USD
  exchange rate**).
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

**Answering WhatsApp voice calls.** Customers tap the call button in the
brand's WhatsApp chat and it rings agents **inside the Hub** — browser +
headset, no phone system. You need `smartcomm` access to hear the ring and
**reply** permission on WhatsApp to answer. The conversation's assigned agent
rings first; after 15 seconds unanswered, everyone rings.
- *Answer a call?* Press **Answer** on the ring — wherever it appears. If
  you're already in that customer's chat the ring shows as a banner at the top
  of the conversation; anywhere else in the Hub it's a card in the top-right;
  with the Hub closed it's a notification on your phone or desktop with
  **Answer** / **Decline** buttons. All three answer the same call. The first
  answer of the session asks for **microphone** permission — allow it.
- *Take calls when the Hub is closed or you're signed out?* Allow
  **notifications** when the Hub asks (or Settings → **Notifications** →
  `/settings/notifications` → *Incoming call* → Push). Tapping **Answer**
  on that notification opens the Hub and connects the call — signing in first
  if you were signed out. **On iPhone** this only works once the Hub is added
  to your Home Screen (Share → *Add to Home Screen*), then opened from there.
- *The ring appears but makes no sound?* Tap **Tap to enable ring sound** on
  the ring card — browsers block audio until you've clicked the page once, and
  one tap fixes it for the rest of the session. To silence rings deliberately,
  turn the notification sound off in the notification bell menu.
- *Covering both brands?* Calls for **every brand you have access to** ring
  you, and each ring card names its brand. Answering doesn't move the app off
  the brand you're working in.
- *A call ended and it's asking for an outcome?* Every completed call needs a
  disposition (deal closed, order placed, follow up, …). It's recorded on the
  customer's conversation as a call card, next to their messages.
- *Nobody answered?* The customer gets an automatic WhatsApp reply, a
  **high-priority task** lands on the conversation's owner, and a *Missed
  WhatsApp call* notification goes to them.
- *Turn calling on for a number?* Messaging → the **settings gear** →
  **WhatsApp** → *Voice calling* (needs `messaging_accounts`). See
  `docs/WHATSAPP_CALLING.md`.

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
- *Add Care & Accessories to a campaign (Pixie Girl)?* Open the campaign builder
  → Products step → **Add care** → tick live care items. Only items you add are
  sold on that landing page; they never count as an extra wig in wig deals or get
  head-size premiums, and online orders with care items are **pickup only** for
  now (the page shows EXTRA DELIVERY FEES MAY APPLY).
- *What ₦/$ rate does a campaign show dollar prices at?* The catalogue's live
  rate (Catalogue → **Config** → **Apply USD exchange rate**) and each
  product's catalogue USD price — the same as the website. The campaign
  builder has no dollar-rate field and no payment-gateway switches any more:
  every sale pays on Nomba in ₦ or $. Changing the catalogue rate changes a
  live campaign's dollar prices for new orders (placed orders keep theirs).
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
  (`/settings/payment-gateways`). **Nomba** is the only gateway checkouts use
  (Naira and US Dollars); Paystack/Stripe settings no longer take payments.
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
- *Looking for an employee's contract, NIN or passport photograph?* Not here —
  employee documents are deliberately excluded from this module and from global
  search, however wide someone's `documents` permission is. They live on the
  person: HR → **Directory** → open them → **Documents** tab
  (`/hr/employees/<profileId>`), and the employee's own copy is in Workspace →
  **My HR** → **My documents**.

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
- *Create or edit a website popup (newsletter, promo, exit-intent)?* Storefront
  Studio → **Popups** → pick one from the list (or **+ New popup**). Set what it
  says, when it shows (trigger, who sees it, how often), then **Save draft** and
  **Publish**.
- *Stop a popup from showing on the website?* Storefront Studio → **Popups** →
  open it → **Take down**. That pulls it off the site immediately and keeps your
  draft and content, so you can publish it again later. **Delete** is different —
  it removes the popup and its content for good.
- *I switched a popup to "Active: off" but visitors still see it?* The **Active**
  toggle is part of the *draft*, so it only reaches visitors when you **Publish**.
  To take a live popup down right now, use **Take down** (above). The pill next to
  each popup in the list tells you the truth: **live** = on the site now,
  **live · edited** = on the site with unpublished draft changes, **off** =
  published but switched off, **draft** = never published.
- *Where do customers buy Care & Accessories (Pixie Girl)?* On the shop website
  at `/care-and-accessories` (the list) and `/care-and-accessories/<slug>` (one
  item, with its size/option picker) — wigs stay on `/product/<slug>`. Only
  **published** care items appear. Staff can also send them in a WhatsApp or
  Instagram order link (Messaging → catalogue picker → **Care & Accessories**).
  Taxable care items show "Plus X% VAT, added at checkout", and the bag/checkout
  add that VAT to the total. Online orders with care items are **pickup only**
  for now and show **EXTRA DELIVERY FEES MAY APPLY**.

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
- Record a payment on an order → open the order → `/sales/orders/<id>` → Record
  Payment (inline in the Payments card; needs the amount + bank reference +
  bank name; settles the order's invoice at the same moment)
- See who accepted a payment and when → open the order → `/sales/orders/<id>` →
  Payments ledger (also on the invoice's Payments list)
- Jump from an invoice to its order (or back) → open either → click the
  order/invoice number, or View Order / View Invoice; or use the Order column
  on the Invoices list / the Invoice column on the Orders list
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
- Issue a credit note → Invoicing → `/invoicing` (Refunds)
- See overdue customers → Invoicing → `/invoicing` (Owed to Us)

**Money out**
- **Create a cash request** → Cash Requests (Finance) → `/cash-requests` (New Cash Request)
- Approve a cash request → Cash Requests → `/cash-requests` (Approval Queue)
- Settle a cash request with receipts → open the request → Settlement wizard
- Claim an expense / reimbursement → Expenses (Finance) → `/expenses` (New Expense)
- Log an expense from a receipt/invoice (photo or PDF + optional voice note) → Expenses → `/expenses` (Scan Receipt)
- Settle a cash advance → Expenses → `/expenses` (Advance settlement)
- Raise a purchase order → Purchasing (Operate) → `/purchasing` (Create PO)
- Fund the China factory → Production (Operate) → `/production` (Factory Account)
- Start a production run with products and costs → Production (Operate) →
  `/production` (Production Runs → New Run)
- Record what the factory charged for a batch → Production → `/production`
  (open the run → Add Cost)
- Add more products to an open run → Production → `/production` (open the run →
  Add Products)
- Receive finished production units into stock → Production → `/production`
  (open the run → Receive Units)
- See a batch's landed cost / per-unit cost → Production → `/production`
  (open the run in Production Runs)

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
- Dispatch a delivery → Logistics (Operate) → `/logistics` (Queue → Ready to dispatch → Book delivery)
- Send the customer her delivery details → automatic on Book delivery; resend at Logistics → `/logistics` (open the delivery → Customer updates → Resend)
- Check if the customer got / opened the delivery details → Logistics → `/logistics` (open the delivery → Customer updates)
- Edit the delivery-booked message or its channel → Messaging → settings → Automated Messages Studio (Delivery Booked)
- Mark a delivery completed → Logistics → `/logistics` (open the delivery → Mark delivered)
- See who completed a delivery → Logistics → `/logistics` (Delivered)
- Record what a delivery cost → Logistics → `/logistics` (open the delivery → Delivery cost → Add cost)
- See delivery losses / margin by courier → Logistics → `/logistics` (Reconciliation)
- Track / fix a failed delivery → Logistics → `/logistics` (Active / Issues)
- Set shipping rates → Logistics → `/logistics` (Shipping Rates)
- Set how a courier is paid → Logistics → `/logistics` (Agencies)

**People & pay**
- Onboard a new staff member → HR (People) → `/hr` (Onboarding) or `/contacts/staff/new`
- Open an employee file → HR → `/hr/employees/<id>`
- Upload an employee's contract / guarantor form / NIN / passport photo → HR → `/hr/employees/<id>` (Documents → Upload)
- Add a new employee document type → HR → `/hr/employees/<id>` (Documents → Upload → New type)
- See which employees are missing required paperwork → HR → `/hr/employees/<id>` (Documents — the missing-documents strip)
- See my own HR documents → Workspace → `/workspace` (My HR → My documents)
- Approve leave → HR → `/hr` (Leave)
- Run payroll → Payroll (People) → `/payroll`
- See one employee's full pay breakdown (lateness, deductions, bonuses) → Payroll → open the run → click the employee
- Waive or uphold a lateness deduction → Payroll → open the run → click the employee → Lateness & attendance (needs `hr_payroll` approve)
- See my own payslip / request leave → Workspace → `/workspace` (My HR)
- Clock in/out → top-bar Clock in button
- Start an appraisal → Performance (People) → `/performance` (Cycles → New cycle)
- See Sales Exec of the Month / who closed the most sales → Performance → `/performance` (Insights)
- See the attendance report (present/late/absent, on-time %) → Performance → `/performance` (Insights)
- Post a job vacancy / advertise a role (AI-drafted, voice intake) → HR → `/hr` (Vacancies)
- Track applicants / AI-shortlist candidates → HR → `/hr` (Vacancies → open a vacancy → Applicants / AI Screening)
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
