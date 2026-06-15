# Pixie Girl Hub — Frontend Module Coverage

**Weighted coverage: 14%** &nbsp;·&nbsp; ✅ Done **5** · 🟡 Partial **1** · ⬜ To-do **34** · Total **40**

> Weighted = (Done + ½·Partial) / Total. Edit `docs/frontend-modules.json` and run `node scripts/build-frontend-coverage.js` to update (or `--set key=done`). The `.xlsx` has a Yes/Partial/No dropdown and a live coverage formula.

| # | Module | Group | Route | Connects with | Built? | Notes |
|--:|--------|-------|-------|---------------|:------:|-------|
| 1 | App Shell (sidebar · top bar · floating layer) | Foundation | `/app` | Login, Command Center, Settings, Notifications | ✅ Done | Hosts every module; business switcher, command palette, account menu. |
| 2 | Login / Auth (sign-in · PIN · reset · select-entity) | Foundation | `/login` | App Shell, Settings, Entity Selection | ✅ Done | DB-driven login_config; password + 6-digit PIN; geo welcome. |
| 3 | Entity Selection | Foundation | `/select-entity` | Login, App Shell | ✅ Done | Multi-brand/CEO brand picker; sets activeEntity. |
| 4 | Command Center (Home) | Foundation | `/home` | Dashboard, Praxis AI, App Shell | ✅ Done | App grid, greeting, clock, recent activity. |
| 5 | Dashboard / Metrics | Selling | `/dashboard` | Sales, Invoicing, Stock, Accounting, HR | ⬜ To-do | Global (CEO, ALL) or per-entity KPIs. |
| 6 | Sales & Quotations | Selling | `/sales` | CRM, Catalogue, Stock, Invoicing, Point of Sale, Logistics, Pricing Engine, Customer Retention | 🟡 Partial | Stub page exists; orders/quotes/installments to build. |
| 7 | CRM & Pipeline | Selling | `/crm` | Sales, Contacts, Customer Retention, Marketing, Messaging | ⬜ To-do | Deals, 360° customer profiles. |
| 8 | Point of Sale | Selling | `/pos` | Sales, Stock, Catalogue, HR, Invoicing | ⬜ To-do | Walk-in checkout; PIN-linked staff sales; offline idempotency. |
| 9 | E-Commerce / Storefront Admin | Selling | `/ecommerce` | Catalogue, Stock, Sales, Marketing, Customer Retention, Logistics, Storefront Studio | ⬜ To-do | Products, orders, collections, discounts, reviews, UGC, channel sync, public-form config. |
| 10 | Stock (SSOT) | Inventory & Ops | `/stock` | Catalogue, Purchasing, Production, Logistics, Point of Sale, Sales | ⬜ To-do | One true count; realtime stock events. |
| 11 | Catalogue (Products & Variants) | Inventory & Ops | `/catalogue` | Stock, Pricing Engine, Sales, Point of Sale, E-Commerce, Production | ⬜ To-do | Products, variants, media library. |
| 12 | Purchasing & Imports | Inventory & Ops | `/purchasing` | Stock, Accounting, Production, Contacts | ⬜ To-do | POs, supplier mgmt, landed-cost feed. |
| 13 | Logistics & Delivery | Inventory & Ops | `/logistics` | Sales, Stock, E-Commerce, Storefront Studio | ⬜ To-do | Couriers, delivery letters, tracking. |
| 14 | Production & Landed Cost | Inventory & Ops | `/production` | Stock, Purchasing, Pricing Engine, Catalogue | ⬜ To-do | Service jobs (Faitlyn), landed-cost rollup. |
| 15 | Pricing Engine | Inventory & Ops | `/pricing` | Catalogue, Sales, Accounting, Production | ⬜ To-do | Margin, per-channel/currency fee gross-up. |
| 16 | Invoicing & Billing | Finance | `/invoicing` | Sales, Accounting, Contacts | ⬜ To-do | Partial-payment-aware; live AR. |
| 17 | Accounting & Finance | Finance | `/accounting` | Invoicing, Expense Management, Purchasing, HR, Cash Request, Intercompany Reconciliation | ⬜ To-do | The books; NGN-based with FX. |
| 18 | Expense Management | Finance | `/expenses` | Accounting, Cash Request, HR | ⬜ To-do | Claims & advances. |
| 19 | Cash Request & Disbursement | Finance | `/cash-requests` | Accounting, Expense Management, HR | ⬜ To-do | My / Finance queue / CEO approval (6.32). |
| 20 | HR & Payroll | People | `/hr` | Contacts, Accounting, Point of Sale, Documents | ⬜ To-do | Attendance, commission, appraisal, payroll. |
| 21 | Contacts & Directory | People | `/contacts` | CRM, HR, Purchasing, Sales | ⬜ To-do | Shared directory across modules. |
| 22 | Org & Workflow Builder | People | `/org-builder` | HR, Settings, Accounting | ⬜ To-do | Roles, approval routing (6.27); gates workflow-bound writes. |
| 23 | Customer Retention & Loyalty | People | `/retention` | CRM, Sales, Marketing, Contacts | ⬜ To-do | Loyalty, coupons, subscriptions, bundles, referrals, analytics. |
| 24 | Sales Campaigns & Landing Pages | Marketing & Growth | `/campaigns` | Sales, Marketing, Customer Retention, Catalogue | ⬜ To-do | Flash-sale builder; 3-state. |
| 25 | Social Media Management | Marketing & Growth | `/social` | Marketing, Catalogue, E-Commerce | ⬜ To-do | Posts, scheduling, reach. |
| 26 | Marketing & Email Campaigns | Marketing & Growth | `/marketing` | CRM, Customer Retention, Contacts, Sales Campaigns | ⬜ To-do | Email, ads, newsletters. |
| 27 | Praxis AI | Marketing & Growth | `/praxis` | Command Center, AI Control, Messaging | ⬜ To-do | Global agent drawer; run-steps over Socket.io. |
| 28 | Stylist Partner Programme | Partners | `/stylists` | CRM, Customer Retention, HR, Logistics, Documents | ⬜ To-do | Leads, assignments, payouts, badge, contract. |
| 29 | Retail / Consignment Partners | Partners | `/retail-partners` | Stock, Sales, Accounting | ⬜ To-do | Consignment & settlements. |
| 30 | Messaging (SmartComm) | Communication | `/smartcomm` | CRM, Contacts, Notifications, Marketing | ⬜ To-do | Unified inbox (IG/WhatsApp/etc). |
| 31 | Documents & Signatures | Communication | `/documents` | HR, Sales, Accounting, Stylist Partner Programme | ⬜ To-do | Filing cabinet; e-sign (flagged, backend dep). |
| 32 | Calendar & Scheduling | Communication | `/calendar` | Tasks, HR, CRM | ⬜ To-do | Shared scheduling. |
| 33 | Tasks & To-Do | Communication | `/tasks` | Calendar, CRM | ⬜ To-do | Assignable tasks across modules. |
| 34 | Notifications & Feed | Communication | `/notifications` | App Shell, Messaging, Praxis AI | ⬜ To-do | Top-bar bell; realtime feed (6.30). |
| 35 | Settings (Business Setup · Money · Operations · Comms · Integrations) | System | `/settings` | Org, IAM, Help Center, Storefront Studio, App Shell, Login | ✅ Done | Full module: landing grid + Business Setup, Currencies/FX, Tax, Doc Numbering, Custom Fields, Pipelines, Gateways, Bank Accounts, Email Signatures, Document Templates, Notifications, Scheduled Reports, API Keys/Secrets, Businesses. Audit→IAM; Roles→Org; Policies→Studio. |
| 36 | Storefront Studio | System | `/storefront-studio` | E-Commerce, Catalogue, Logistics | ⬜ To-do | Timeline vocabulary, delivery-letter templates. |
| 37 | Intercompany Reconciliation | System | `/intercompany` | Accounting, Purchasing, Stock | ⬜ To-do | CEO/ALL aggregation; inter-brand settlement. |
| 38 | AI Control & Governance | System | `/ai-control` | Praxis AI, Settings | ⬜ To-do | Action catalogue, guardrails (6.31). |
| 39 | IAM & Security | System | `/iam-security` | Settings, Org, Login | ⬜ To-do | Audit log (moved here from Settings), security events, sessions, access reviews. Scope TBD; placeholder landing built. |
| 40 | Help Center | System | `/help` | Settings, App Shell | ⬜ To-do | DB-driven guides & FAQs (mirrors hub-system help-editor). Placeholder landing built. |

_Last generated: 2026-06-15._
