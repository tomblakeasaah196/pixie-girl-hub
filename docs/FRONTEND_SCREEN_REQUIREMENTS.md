# Pixie Girl Hub — Frontend Screen Requirements

**Audience:** Frontend engineering team building the React PWA admin + Next.js storefront.
**Companion to:** `ADMIN_UI_REQUIREMENTS.md` (backend CRUD tables).
**Stack:** React PWA (admin), Next.js (storefront), Tailwind, Socket.io, shadcn/ui (recommended)

This document tells the frontend team **what screens to build, where they live in the navigation, and how users interact with them.** The backend doc tells you _what tables CRUD_; this doc tells you _what the user sees and clicks_.

## Guiding principles

1. **Brand-switcher is global.** The top-bar brand selector toggles every screen between PXG and FLH context. All API calls auto-include the active brand. Cross-brand views (inter-company, AI insights cross-brand briefings) live on a third "Group" view.
2. **Permission-aware rendering.** Every screen reads the user's permission matrix on mount. Buttons disable, sections hide, menus collapse based on what the user is allowed to do. Never render an action a user can't perform.
3. **Mobile-first for staff screens.** POS, clock-in, stylist assignments, expense submissions, service job updates — all mobile-first PWA. Manager dashboards and pricing engine can be desktop-first.
4. **Real-time everywhere it matters.** Socket.io rooms for: stock levels, POS sessions, deliveries, service jobs, AI pending actions, dashboard widgets, sales campaign metrics, AI usage meter.
5. **Workflows are transparent.** Anywhere an action triggers a `workflow_definition`, the UI shows the chain: "→ Manager → CEO (if > ₦200k)" _before_ submission, then progress after.
6. **Draft/publish is universal.** Storefront themes, pages, navigation, email templates, sales campaigns, price proposals — all have a draft state with preview, then explicit publish.

---

## TOP-LEVEL NAVIGATION

The admin shell has three persistent UI elements:

### 1. Top bar

- Brand switcher (PXG / FLH / Group view)
- Search (Cmd-K global search across all entities)
- Notifications bell (unread count from `shared.notifications`)
- Praxis voice button (mic icon, opens AI agent panel)
- AI usage meter (live ₦ counter from `ai_usage_daily`, expandable to detail)
- User profile menu

### 2. Left sidebar (collapsible)

Module navigation grouped into 8 sections:

| Section                | Modules                                                                                                           | Default icon |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| **Sell**               | Sales · Quotations · POS · Storefront · Sales Campaigns · Stylist Programme                                       | Shopping bag |
| **Customers**          | CRM · Contacts · Reviews · Subscriptions · Loyalty · Referrals                                                    | People       |
| **Stock & Production** | Catalogue · Stock · Purchasing · Production · Service Jobs (FLH only) · Pricing Engine · Retail Partners          | Box          |
| **Operations**         | Invoicing · Accounting · Expenses · Logistics · Inter-Company · Tax Filings · Bank Rec                            | Receipt      |
| **People**             | HR · Staff · Performance · Payroll · Clock-In · Org Chart                                                         | User badge   |
| **Communicate**        | Smartcomm · Email Campaigns · Social Media · Documents                                             | Chat bubble  |
| **AI & Insights**      | Praxis Chat · Briefings · Insights · Reports · Dashboards                                                         | Sparkle      |
| **Settings**           | Business Setup · Workflows · Custom Fields · Pipelines · Roles · AI Governance · Storefront Studio · Integrations | Cog          |

Each module collapses to show its sub-pages.

### 3. Right-side Praxis panel (slide-out)

Persistent on every screen. Shows:

- Active conversation
- Voice/text input toggle
- Pending action confirmation cards (when Praxis proposes a write)
- Recent briefings inbox

---

## SCREENS BY MODULE

### 6.1 CRM

| Screen                      | Purpose                                            | Key components                                                                                                                                     |
| --------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contacts list               | All customers + suppliers + stylists across brands | Filter by brand, type, tags, last activity. Bulk select for segments.                                                                              |
| Contact detail              | 360° view of one person                            | Tabs: Overview · Orders · Deals · Activities · Notes · Loyalty · Documents · Measurements · Preferences. Side panel: pinned notes, next milestone. |
| Pipeline board (Kanban)     | Drag-and-drop deals across stages                  | Per-pipeline view. Column = stage. Card = deal with value, age in stage, owner. Stale-card visual indicator when over SLA.                         |
| Pipeline list view          | Same data, table format                            | Sortable columns; bulk reassign; export.                                                                                                           |
| Deal detail                 | One opportunity's journey                          | Stage stepper top. Tabs: Products · Activities · Notes · Quotes · Stage history · Linked order.                                                    |
| New deal modal              | Quick add from any screen                          | Contact picker (or create new); pipeline + stage; expected value + close date.                                                                     |
| Activity logger             | Add call/message/meeting                           | Type picker, outcome dropdown, follow-up date. Inline from contact/deal screen.                                                                    |
| Customer preferences editor | Wig curation inputs                                | Multi-select texture/lace/length/colour; budget range; allergies.                                                                                  |
| Customer measurements form  | Head measurements                                  | Diagram with cm inputs; current vs history view.                                                                                                   |
| Churn risk dashboard        | At-risk customers                                  | Card grid sorted by risk score; one-click "trigger win-back workflow" button.                                                                      |
| Milestones calendar         | Upcoming birthdays / anniversaries                 | Calendar view + list view.                                                                                                                         |

### 6.2 Sales & Quotations

| Screen                      | Purpose                     | Key components                                                                                                                                   |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sales orders list           | All confirmed orders        | Filters: channel, type (walk-in/dispatch), status, date range, custom-order toggle, IC toggle. Quick actions: print, send tracking, refund.      |
| Sales order detail          | One order's lifecycle       | Status stepper; lines; payments; discounts; cancellation timer (live countdown if within free window); linked invoice + delivery + service jobs. |
| Sales order create          | New order builder           | Variant picker with stock check; channel + type; discount lookup (coupon/loyalty/campaign); split payment entry. Mobile-optimised.               |
| Quotations list             | Open quotes                 | Filter by status; expiring soon indicator.                                                                                                       |
| Quotation builder           | Build + send a quote        | Line editor; multi-currency; preview; send via WhatsApp/email/PDF.                                                                               |
| Cancellation request review | Approve/reject cancellation | Shows free-window timer + computed fee + refund amount.                                                                                          |

### 6.3 POS

POS screens are **mobile-first, tablet-optimised, offline-capable**. Treat as a separate PWA bundle.

| Screen                             | Purpose                        | Key components                                                                                                       |
| ---------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Terminal login                     | Staff PIN entry                | 4-digit PIN pad; lockout indicator; recent users.                                                                    |
| Session open                       | Start a shift                  | Confirm opening cash float; one-tap "open".                                                                          |
| Sale screen                        | Build a sale                   | Product grid (search/scan); cart side panel; "walk-in vs dispatch" toggle; customer attach (optional).               |
| Checkout                           | Process payment                | Split payment entry (cash + card + transfer); change calculation; receipt destination picker (print/email/WhatsApp). |
| Cash drop                          | Mid-shift safe deposit         | Amount, destination, witness.                                                                                        |
| Void                               | Void line or transaction       | Reason picker; manager PIN if post-payment.                                                                          |
| Session close                      | End-of-shift                   | Cash count entry; system comparison; variance explanation if non-zero.                                               |
| Z-report                           | Generated end-of-shift summary | Read-only screen; auto-prints.                                                                                       |
| Terminal admin (separate, desktop) | Configure terminals + PINs     | CRUD terminals, reset PINs.                                                                                          |

### 6.4 E-Commerce Storefront

Storefront screens are the **public customer-facing site** built in Next.js. Admin screens for managing the storefront live under "Storefront Studio" (Module 6.28).

| Customer-facing screen           | Purpose                                                                   |
| -------------------------------- | ------------------------------------------------------------------------- |
| Home                             | Hero, featured collections, social proof                                  |
| Category page                    | Filtered product grid (texture, length, colour, density facets)           |
| Collection page                  | Curated/rule-based                                                        |
| Product detail                   | Gallery + video + variants + reviews + related products + chatbot trigger |
| Cart                             | Editable line items; coupon code; loyalty redemption preview              |
| Checkout                         | Multi-step or single-page; address; shipping method; payment; review      |
| Order confirmation               | Thank-you + tracking link                                                 |
| Tracking page (public, no login) | `/track/{token}` — order timeline, ETA, current status                    |
| Customer account                 | Order history; subscriptions; preferences; reviews; wishlist              |
| Login / signup                   | Email + OTP or password                                                   |
| Sales campaign landing           | `/sale/{slug}` — three states: before / live / ended                      |

### 6.5 Invoicing

| Screen                     | Purpose                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| Invoices list              | All invoices with status filters; aging buckets sidebar                             |
| Invoice detail             | Full invoice; payment history; reminder timeline; send/resend actions; download PDF |
| Invoice builder            | Auto-fills from sales order; manual entry option; multi-currency; WHT toggle        |
| Credit notes list + detail | Returns/refunds                                                                     |
| Receipts list              | Customer-facing payment receipts                                                    |
| Reminders queue            | Scheduled + sent; per-channel breakdown                                             |

### 6.6 Accounting

| Screen               | Purpose                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| Chart of accounts    | Tree view; CRUD; control account indicator                                        |
| Journal entries list | Filter by source type, period, status; bulk post                                  |
| Journal entry detail | Header + balanced lines view; immutability indicator when posted; reversal button |
| Manual journal entry | Builder with balanced-debits/credits enforcement                                  |
| Trial balance        | Per-period; drill into any account                                                |
| Balance sheet        | Standard format; comparison toggles                                               |
| Income statement     | P&L; period selector; channel breakdown filter                                    |
| Cash flow statement  | Standard 3-section format                                                         |
| Fiscal periods       | List with status pills; "close period" action with checklist                      |
| Bank statements      | Import (CSV/PDF/API); list view                                                   |
| Bank reconciliation  | Side-by-side: book vs statement; auto-match suggestions; manual match drag-drop   |
| FX revaluation       | Run + post; per-account impact preview                                            |
| Tax filings          | List by type; filing builder with auto-populated totals; submission tracker       |

### 6.7 Expenses

| Screen                   | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| My expenses (staff)      | Submit + track own expenses; "Pending / Approved / Paid" tabs |
| Expense submit form      | Categories dropdown; OCR receipt upload; line items           |
| Cash advance request     | Amount + purpose + currency + recipient                       |
| Cash advance settle      | Return receipts + change; auto-computed shortfall/excess      |
| Approval queue           | Pending approvals for managers                                |
| Expense detail           | Full record with approval chain                               |
| Expense categories admin | CRUD with GL account mapping                                  |

### 6.8 Purchasing

| Screen                  | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| Suppliers list + detail | Master CRUD with banking, performance rating                            |
| Supplier products tab   | Variant ↔ supplier SKU mapping                                          |
| RFQs list + detail      | Comparison view across suppliers                                        |
| RFQ builder             | Add lines, invite suppliers, send                                       |
| Purchase orders list    | Status-grouped; factory state machine indicators                        |
| PO detail               | Lifecycle stepper; lines; GRNs; supplier invoices                       |
| Goods received note     | Receipt against PO; quantity + QC entry; photo upload                   |
| Supplier invoices list  | Three-way match status indicators                                       |
| Three-way match screen  | PO + GRN + invoice side-by-side; variance highlights; override approval |

### 6.9 Stock SSOT

| Screen                   | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| Stock dashboard          | Total value, low stock count, today's movements, in-transit         |
| Stock levels (real-time) | Per-variant × location grid; available / on-hand / reserved columns |
| Stock movements ledger   | Filterable history; reference linking                               |
| Stock adjustment         | Count vs damage vs found; line entry; workflow approval             |
| Stock transfer           | From/to location; line entry; dispatch + receipt screens            |
| Inbound shipments        | Active shipments with state stepper; ETA                            |
| Inbound shipment detail  | Lines; cost roll-up; linked PO; expected vs received                |
| Stock alerts             | Low / out / overstock / stale; acknowledge + raise reorder buttons  |
| Stock locations admin    | CRUD                                                                |

### 6.10 Logistics

| Screen                   | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| Today's deliveries       | Courier-grouped Kanban (Queued → Picked Up → In Transit → Delivered) |
| Delivery list            | Filters; courier breakdown                                           |
| Delivery detail          | Full state history; attempts; proofs; courier webhook log            |
| Book delivery            | From paid order; courier picker with rate comparison                 |
| POD reconciliation queue | Cash collections pending courier remittance                          |
| Courier admin            | CRUD with rate cards                                                 |

### 6.11 HR & Payroll

| Screen                             | Purpose                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff directory                    | Filter by department, status, role                                                                                                           |
| Staff profile                      | Personal info; **probation tracker** (V2.2); leave balances; assets; documents; performance history; clock-in history                        |
| Probation review                   | Pending probation outcomes; pass/fail/extend                                                                                                 |
| Leave requests list                | Pending approvals + calendar view                                                                                                            |
| Leave request form                 | Type picker (annual, sick, **special_event_in_lieu**, etc.); date range; balance preview                                                     |
| Performance cycles                 | Open cycles, scoring progress                                                                                                                |
| Performance review form            | Per-KPI raw score entry (4 KPIs with **40/25/20/15** weights visible); weighted total computed live; calibration warning if score is outlier |
| Performance review (employee view) | Read review; acknowledge + add response                                                                                                      |
| Bonuses list                       | Pending approvals + awarded history                                                                                                          |
| Payroll runs                       | Monthly runs; calculate → review → approve → pay                                                                                             |
| Payslips                           | Per-staff slip; download/email; admin sees all, staff sees own                                                                               |
| Commission earned                  | Per-staff per-period; sale_channel breakdown (Instagram/Website/WhatsApp/Walk-in)                                                            |

### 6.11.1 Geolocation Clock-In

**Mobile PWA** — staff opens the app to clock in/out.

| Screen                       | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| Clock in/out (staff mobile)  | Big button; live GPS; geofence check; off-site warning |
| Today's attendance (manager) | Live grid showing who's in / out / off-site            |
| Attendance history           | Per-staff timesheet view                               |
| Geofences admin              | Map UI to draw or set radius                           |

### 6.12 Contacts

Covered under CRM (same `shared.contacts` table). Suppliers and stylists have their own screens under Purchasing and Stylist Programme.

### 6.13 Documents

| Screen            | Purpose                                                 |
| ----------------- | ------------------------------------------------------- |
| Documents library | Filter by type, brand, linked entity; preview; download |
| Upload            | Drag-and-drop; auto-categorisation by entity link       |

### 6.14 Social Media

| Screen                | Purpose                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| Social accounts admin | Connect/disconnect; OAuth flow                                                          |
| Post composer         | Multi-platform with platform-specific preview; product tagging; scheduling; A/B variant |
| Posts calendar        | Schedule view                                                                           |
| Post metrics          | Per-post engagement; daily rollup chart                                                 |

### 6.15 Ad Analytics — retired

Ad analytics was removed from the platform (no ad accounts are connected and
none will be). Marketing is email-only: see 6.16.

### 6.16 Email Campaigns

| Screen                  | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| Email templates library | List + preview + version history                                  |
| Template editor         | Gmail-style rich text editor with Personalise pills (no HTML); framed live preview with sample data |
| Brand frame (Design)    | Per-brand email header/footer config, seeded with premium defaults |
| Milestone rules admin   | Birthday / anniversary / cart abandonment configurator            |
| Campaigns list          | Status-grouped (draft / scheduled / sending / completed)          |
| Campaign builder        | Audience picker (segment); template; A/B variants; schedule       |
| Campaign report         | Open/click/bounce charts; revenue attribution; per-variant winner |

### 6.17 Smartcomm

| Screen        | Purpose                                                   |
| ------------- | --------------------------------------------------------- |
| Inbox         | Unified WhatsApp + Instagram DM + Email + SMS threads     |
| Thread view   | Reply across channels; templates; contact context sidebar |
| Channel admin | Connect accounts; signature management                    |

### 6.18 Calendar

| Screen        | Purpose                                       |
| ------------- | --------------------------------------------- |
| Calendar view | Day / week / month; event types color-coded   |
| Event detail  | Participants, resources, linked entities      |
| Create event  | Quick add with participant + resource pickers |

### 6.19 Tasks

| Screen                | Purpose                                                             |
| --------------------- | ------------------------------------------------------------------- |
| My tasks              | Today / This week / Overdue tabs; priority sort                     |
| Task detail           | Subtasks; linked entity (deal, service job, etc.); assignment chain |
| Team tasks (managers) | Filter by assignee; bulk reassign                                   |
| Task creation         | Quick-add inline from any screen                                    |

### 6.20 Dashboards

| Screen             | Purpose                                                               |
| ------------------ | --------------------------------------------------------------------- |
| Default dashboard  | Per-user landing dashboard with default widgets                       |
| Dashboard switcher | Saved dashboards dropdown                                             |
| Dashboard editor   | Drag-and-drop widget layout; resize; add/remove widgets               |
| Widget library     | Browse + add system widgets; custom widget builder (SQL/saved-report) |
| Saved reports      | Build, save, schedule, export                                         |

### 6.21 Business Setup (Module 18)

| Screen                          | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| Brand profile                   | Identity, legal, branding fields                                     |
| Loyalty config                  | Edit tiers, multipliers, earning rate, redemption rate               |
| Cancellation policy             | Free-window hours, restocking %, custom-non-refundable %             |
| Inter-company config            | Min margin, partner brand link, default GL accounts                  |
| FX settings                     | Default fallback rate, allowed display currencies, charm rounding    |
| **PXG quantity discount** rules | Per-quantity discount tiers ($10/$22 off equivalents)                |
| Document numbering              | View next number per type; reset (admin only, before first issuance) |

### 6.22 Sales Campaigns

| Screen                  | Purpose                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Campaigns list          | Active / Scheduled / Ended; performance summary cards                                 |
| Campaign builder        | Multi-step wizard: details → audience → products → landing page → schedule → approval |
| Landing page editor     | Drag-and-drop blocks (hero, products, testimonials); preview before/live/ended states |
| Campaign live dashboard | Real-time visitors, signups, conversion rate, revenue ticker                          |
| Pre-launch signups list | Export, blast notification on go-live                                                 |

### 6.23 Retention / Loyalty

| Screen                         | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| Loyalty dashboard              | Tier distribution, top-earning customers, redemption rate |
| Loyalty ledger                 | Per-customer point history                                |
| Coupons admin                  | CRUD with bulk generation; usage tracking                 |
| Subscriptions list             | Active / paused / cancelled; renewal monitoring           |
| Subscription detail            | Billing history; pause/resume                             |
| Bundle offers admin            | CRUD with components builder                              |
| Maintenance plans admin        | CRUD (Faitlyn salon plans)                                |
| Maintenance subscriptions list | Active subscriptions with visit usage                     |
| Retention workflows admin      | Trigger-action rule builder                               |
| Workflow executions log        | Per-rule run history with outcomes                        |
| Referrals admin                | Code generator; redemption tracker with fraud flags       |

### 6.24 Production & Landed Cost + Service Job Tracker

#### Production (PXG-focused)

| Screen                | Purpose                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Production runs list  | State-grouped (planned → funded → in_production → ... → received)                                      |
| Production run detail | State stepper; unit-level grid; cost components ledger; landed cost breakdown card; per-unit cost view |
| Cost component entry  | Add factory/freight/customs/etc. cost with FX context                                                  |
| Funding sources list  | Active funding pools with depleted indicator                                                           |
| Funding source detail | NGN → USD → RMB chain; effective rate; drawdown history                                                |
| Landed cost snapshots | Historical per-run cost recomputes                                                                     |

#### Service Job Tracker (FLH-focused — V2.2)

| Screen                          | Purpose                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Service jobs board (Kanban)     | Pending → In Progress → Completed                                                                            | Card = job with stylist avatar, customer, hair, service type |
| Service jobs list               | Filterable history                                                                                           |
| Service job detail              | Hair link, stylist link, customer link, status changes, before/after photos, chemicals used, customer rating |
| Service job assignment          | Create job + auto-create stylist task (V2.2 behaviour)                                                       |
| Service types admin             | The 5-item taxonomy editor: cost, turnaround, recipe                                                         |
| Chemical recipes admin          | Recipe builder with ingredients table                                                                        |
| Monthly chemical reconciliation | Variance report with investigate/resolve actions                                                             |
| Anti-pocketing dashboard (V2.2) | Service jobs completed with no matching sale — flagged                                                       |

### 6.25 Pricing Engine

| Screen                  | Purpose                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Pricing rules admin     | List + CRUD with priority + scope                                                                                          |
| Pricing floors admin    | Hard min-margin / min-price rules                                                                                          |
| Scenario builder        | Slider-based UI: FX, freight, styling, target margin → live preview of per-variant new prices and margin sensitivity table |
| Scenario comparison     | Side-by-side multiple scenarios                                                                                            |
| Price proposal review   | CEO-approval screen showing all proposed changes + impact summary                                                          |
| Price history           | Per-variant historical chart                                                                                               |
| Channel overrides       | Active override list with expiry                                                                                           |
| Cost pass-through admin | Charm rounding rules + PXG quantity-discount layers                                                                        |

### 6.26 Stylist Partner Programme

| Screen                   | Purpose                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| Stylists directory       | Filter by tier, location, speciality, availability                             |
| Stylist profile          | Personal info; certifications with expiry; specialities; capacity; performance |
| Stylist onboarding       | Multi-step: profile → credentials → speciality rates → certification           |
| Assignments board        | Open offers + accepted assignments per stylist                                 |
| Assignment offer creator | Multi-stylist routing with priority                                            |
| Payouts list             | Monthly per-stylist payable runs                                               |
| Payout detail            | Lines breakdown; mark paid                                                     |
| Certifications admin     | Award/revoke tier; track expiry                                                |

### 6.27 Org & Workflow Builder

| Screen                    | Purpose                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| Org chart                 | Visual hierarchy; drag to reorganise; solid (line) + dotted (dashed line) relationships           |
| Position editor           | Set holder; **solid manager**; dotted-line superiors; **deputy flag**; **approval threshold (₦)** |
| Workflow definitions list | All approval flows                                                                                |
| Workflow visual builder   | Stage flow with triggers, conditions, approvers, thresholds, deputy fallback, timeouts            |
| Workflow instances queue  | Pending approvals across the org                                                                  |
| My approvals              | Personal pending approval list                                                                    |
| Roles + permissions       | Matrix grid with bulk-edit                                                                        |

### 6.28 Storefront Studio

| Screen             | Purpose                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| Theme editor       | Tokens panel (colors, typography, logo, buttons); live preview iframe; draft → publish |
| Pages list         | Per-brand pages with status badges                                                     |
| Page editor        | Slot-based content editor; preview; draft → publish                                    |
| Navigation editor  | Drag-and-drop header + footer menus; draft → publish                                   |
| Storefront preview | Iframe with brand selector                                                             |
| Revisions history  | Per-entity timeline with one-click rollback                                            |

### 6.29 Praxis AI Agent

| Screen                                    | Purpose                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| Praxis chat panel (slide-out, persistent) | Right-side panel on every admin screen                                               |
| Conversation list                         | Past conversations; resume                                                           |
| Conversation detail                       | Message thread; voice replay; pending action cards                                   |
| Pending action card                       | Plain-language summary + payload preview + Confirm/Reject buttons + expiry countdown |
| Voice input                               | Mic button; live transcription preview; submit                                       |

### 6.30 AI Insights

| Screen                        | Purpose                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| Insights inbox                | Open insights across all 6 categories; severity badges; acknowledge / resolve actions |
| Insight detail                | Drill from insight to underlying data (e.g. stock alert → variant detail)             |
| Briefings inbox               | AI-generated narrations; unread count                                                 |
| Briefing detail               | Read narration with linked insight cards                                              |
| Weekly Sales Report (V2.2)    | Auto-generated; staff confirmation screen Saturday 8 PM with edit-then-send flow      |
| Weekly Customer Report (V2.2) | Same pattern                                                                          |
| Report templates admin        | Cadence, sections, recipients editor                                                  |
| Report run history            | Past runs with confirmation status                                                    |

### 6.31 AI Control & Governance

| Screen               | Purpose                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| AI dashboard         | Live spend meter; per-feature breakdown; per-vendor breakdown; budget remaining         |
| Feature flags admin  | Toggle each AI capability on/off; provider/model picker                                 |
| Vendor credentials   | DeepSeek / Groq / OpenAI key entry (encrypted on save); rotation button; per-vendor cap |
| Access grants matrix | User × feature grid                                                                     |
| Budget periods       | Monthly cap setup; breach alerts                                                        |
| Action catalogue     | Auto-generated list; bulk enable/disable; min-confidence slider per action              |
| Knowledge base       | RAG corpus management; upload SOPs; per-chunk access-scope tags                         |
| Usage ledger         | Per-call drill-down                                                                     |

---

## CROSS-CUTTING UI PATTERNS

### A. Brand-switcher behaviour

- Visible top-bar dropdown showing current brand
- Switching emits a global event; all screens re-fetch
- Cross-brand screens (Group view) explicitly opt-in; clearly marked

### B. Permission gating

- Use a `<RequirePermission module="..." action="...">` wrapper
- Disabled buttons show tooltip explaining missing permission
- Sidebar items hide entirely if user has zero permissions on that module

### C. Workflow surfacing

- Any action behind a workflow shows the chain _before_ submitting
- After submission, an inline progress strip shows current stage + ETA
- "My Approvals" badge in top bar with count

### D. Draft / publish pattern

Used in: Storefront themes/pages/nav, email templates, sales campaigns, price proposals, expense submissions, journal entries, PO submissions, payroll runs.

Components:

- Status badge: Draft (grey) / Pending Review (yellow) / Approved (blue) / Published or Posted (green)
- "Publish" / "Submit for approval" / "Post" buttons gated by status
- Audit strip: who created, who approved, when
- Edit becomes disabled in terminal states

### E. State machine visualisation

Used in: sales orders, POs, deliveries, production runs, service jobs, IC transactions, supplier invoices.

Components:

- Horizontal stepper showing all states
- Current state highlighted with timestamp
- Hover for state-transition history
- "Advance state" button (workflow-gated)

### F. Multi-currency display

- Customer-facing: show in their preferred currency with subtle "≈₦X" tooltip
- Admin-facing: show NGN as primary, original currency as secondary
- All input fields tagged with current currency
- FX rate used always visible on financial documents

### G. Real-time elements (Socket.io rooms)

| Subscription                           | Updates                                                  |
| -------------------------------------- | -------------------------------------------------------- |
| `brand:{brand}:stock`                  | Stock level changes across all screens showing inventory |
| `brand:{brand}:deliveries`             | Delivery state changes for ops dashboards                |
| `brand:{brand}:service_jobs`           | Service job status for FLH stylist board                 |
| `brand:{brand}:pos_session:{id}`       | Live POS transaction stream during a session             |
| `brand:{brand}:campaign:{id}`          | Sales campaign metrics during live state                 |
| `user:{id}:notifications`              | Per-user notification bell                               |
| `user:{id}:ai_pending`                 | Pending action push to Praxis panel                      |
| `system:ai_usage_meter`                | Live AI spend ticker in top bar                          |
| `brand:{brand}:order_timeline:{token}` | Customer tracking page live updates                      |

### H. Search (Cmd-K)

Global search across:

- Contacts (name, phone, email, NIN)
- Orders (number, customer)
- Products (name, SKU)
- Documents (number, type)
- Stylists
- Suppliers
- "Recent screens" history per user

### I. Bulk operations

Patterns common to list screens:

- Checkbox column with "select all on page" + "select all matching filters"
- Floating action bar appears with: export, bulk edit, bulk delete (if permitted), bulk assign, bulk apply tag

### J. Empty states

Every list/dashboard needs an empty state showing:

- Illustration or icon
- "No X yet" caption
- Primary CTA to create the first one
- Secondary link to docs / Praxis chat for help

### K. Loading + error states

- Skeleton loaders for tables and dashboards
- Toast notifications for errors with retry where possible
- Network-offline banner (PWA capability) — POS especially

### L. Mobile-specific screens

The following are mobile-first (the rest are desktop-first):

- POS (all screens)
- Clock-in
- Stylist task list
- Expense submission with OCR
- Service job status update (stylist)
- Praxis voice
- Order tracking (customer-facing)
- Storefront checkout

### M. Storefront-specific UI

Beyond admin, the customer-facing Next.js storefront needs:

- SEO-friendly product pages (meta tags from `product_seo`)
- Structured data (JSON-LD) for products
- Responsive image rendering from `product_images.responsive_paths`
- Theme tokens injected from `storefront_themes.tokens` at build / runtime
- Page templates rendering `storefront_pages.slots` JSONB
- Live cart sync with `shared.carts` table
- Customer account portal (Module 6.23 self-service)

### N. Cancellation timer (V2.2 §6.4)

On the order detail screen, when within the free-cancellation window:

- Live countdown timer (HH:MM:SS until `free_cancel_until`)
- Big "Cancel within free window" button
- Past the window: cancel button shows the fee that will be deducted

### O. Anti-pocketing alert (V2.2 §6.30)

On the Service Jobs dashboard, a sentinel widget:

- "N completed service jobs with no matching sale" — drill-down list
- Auto-refreshed when the AI insight runs

---

## DESIGN TOKENS & THEMING

Per `shared.storefront_themes.tokens`, the storefront supports per-brand colours, typography, etc. The **admin app** itself stays consistent across brands (otherwise CEO toggling between brands would be visually jarring). Suggested admin tokens:

| Token   | Value                                                         |
| ------- | ------------------------------------------------------------- |
| primary | A neutral but warm brand colour (suggest: indigo or charcoal) |
| accent  | Brand colour chosen by CEO                                    |
| success | Green                                                         |
| warning | Amber                                                         |
| danger  | Red                                                           |
| muted   | Slate gray                                                    |

The brand context indicator (badge near top-bar brand switcher) is the ONE place admin UI tints to the current brand colour.

---

## DEVELOPMENT PRIORITISATION

Suggested build order for the frontend team, mapped to value:

### Phase 1 — Core operations (weeks 1-4)

- Login + brand switcher + permission gating
- CRM (contacts list, contact detail, deals board)
- Sales orders (list, detail, create)
- POS (session, sale, checkout, close — all mobile)
- Stock dashboard + levels
- Invoicing (list, detail, builder)

### Phase 2 — Configuration (weeks 5-7)

- Business Setup (Module 18)
- Workflow builder (Module 6.27)
- Roles + permissions matrix
- Custom fields admin
- Document numbering view
- Storefront Studio basics

### Phase 3 — Finance (weeks 8-10)

- COA + journal entries
- Bank reconciliation
- Fiscal periods + close flow
- Tax filings
- Expenses (staff submit + manager approve)
- Payroll runs + payslips

### Phase 4 — Production & service (weeks 11-13)

- Production runs + landed cost
- Service Job Tracker (FLH critical)
- Service types + chemical recipes admin
- Stylist directory + assignments

### Phase 5 — Growth (weeks 14-16)

- Sales campaigns + landing pages
- Email campaigns + templates
- Pricing engine + scenarios + proposals
- Retention workflows
- Loyalty + referrals UI

### Phase 6 — Intelligence (weeks 17-18)

- Praxis chat panel (text)
- Praxis voice
- Insights inbox + briefings
- Dashboards + saved reports
- V2.2 Weekly Sales + Customer Reports
- AI governance screens

### Phase 7 — Polish (weeks 19-20)

- Mobile PWA optimisations
- Offline-capable POS
- Public order tracking page
- Customer storefront account portal
- Bulk operation flows
- Empty + error states across all screens

---

## SHARED COMPONENTS LIBRARY

Build these once, use everywhere:

| Component                           | Used in                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `<EntityPicker>`                    | Picking contacts, products, variants, suppliers, stylists across forms |
| `<MoneyInput currency>`             | All financial input fields                                             |
| `<MoneyDisplay ngn display>`        | Multi-currency money rendering                                         |
| `<StatusBadge>`                     | All entities with state machines                                       |
| `<StateMachineStepper>`             | Sales orders, POs, deliveries, production runs, service jobs           |
| `<WorkflowChain>`                   | Anywhere approvals are involved                                        |
| `<DraftPublishBar>`                 | Storefront, templates, campaigns, journals                             |
| `<RequirePermission>`               | Permission-gated rendering                                             |
| `<BrandIndicator>`                  | Top-bar brand switcher                                                 |
| `<PraxisPanel>`                     | Right-side AI agent panel                                              |
| `<AuditTrail>`                      | Show who-what-when on any entity                                       |
| `<FilterBar>`                       | Standard filter+search+date-range on list screens                      |
| `<BulkActionBar>`                   | Floating bar for bulk operations                                       |
| `<RealtimeBadge>`                   | Indicates live-updating section                                        |
| `<CurrencyDisplay>`                 | Smart currency formatting with FX context                              |
| `<CountdownTimer>`                  | Cancellation window, AI pending action expiry                          |
| `<KPIWidget>`                       | Dashboard widget container                                             |
| `<EmptyState illustration ctaText>` | Standard empty state                                                   |

---

## OPEN QUESTIONS / DESIGN DECISIONS NEEDED

These warrant a conversation with the CEO/owner before implementation:

1. **Storefront templates** — V2 spec says "fixed Next.js templates with content slots, not full CMS." What's the initial set? Suggest: home_hero_v1, about_simple, contact_card, lookbook_grid, returns_policy.

2. **Brand colour palette for FLH** — needs confirmation. PXG presumably has an existing palette.

3. **Praxis personality** — formal, friendly, neutral? Affects all generated copy in briefings, drafts, voice responses.

4. **Mobile vs desktop for managers** — managers approve expenses, leave, payroll. Are they always at a desk? If they're field-mobile, all approval queues need solid mobile UX.

5. **Stylist app** — separate PWA bundle, or part of the main admin app with role-restricted view? V2 spec suggests stylist credentials are a separate JWT class; consider separate app.

6. **Customer reviews moderation** — moderation queue UX. Auto-approve verified-purchase reviews, hold others for manual review?

7. **Storefront localisation** — supports 6 currencies; does it also need language switching (English-only for V1)?

8. **POS hardware** — receipt printer integration via what API? Bluetooth thermal printer is standard but app needs the bridge.

9. **Customer-facing tracking page design** — the public `/track/{token}` page is the customer's first sense of the brand post-purchase. Needs design love.

10. **Praxis interruption** — when Praxis proposes a write, does the pending-action card block the user or just notify? Recommend: notify (toast + Praxis panel update), don't block.

---

## SUMMARY

The frontend team has roughly **~120 distinct screens to build**, organised across 31 modules. The patterns above (brand-switcher, permission gating, workflow surfacing, draft/publish, state-machine stepper, real-time updates) recur enough that a strong shared-components library will save weeks.

The backend `ADMIN_UI_REQUIREMENTS.md` document is the contract: every Tier-1 table needs a CRUD screen, every Tier-2 table needs an editable but seeded screen, every Tier-3 table needs a read/action-only screen. This document tells you _which screens those translate to_ and _what user interactions they support_.

Build the shared components first; the screens come quickly after.
