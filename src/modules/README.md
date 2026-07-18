# Modules

37 modules — one per major V2.2 spec section, plus auth + audit.

Each module is **self-contained**: routes, controller, service, repo, validator, events, README. Cross-module dependencies go through `src/services/` (shared helpers) or `events` (loose coupling via EventEmitter).

## Module map

| Module              | Spec                                 | Permission key      |
| ------------------- | ------------------------------------ | ------------------- |
| `crm`               | 6.1 Customer Management              | `crm`               |
| `sales`             | 6.2 Sales & Quotations               | `sales`             |
| `pos`               | 6.3 Point of Sale                    | `pos`               |
| `storefront`        | 6.4 E-Commerce Storefront            | `storefront`        |
| `invoicing`         | 6.5 Invoicing & Billing              | `invoicing`         |
| `accounting`        | 6.6 Accounting & Finance             | `accounting`        |
| `expenses`          | 6.7 Expense Management               | `expenses`          |
| `purchasing`        | 6.8 Purchasing & Imports             | `purchasing`        |
| `stock`             | 6.9 Stock SSOT                       | `stock`             |
| `logistics`         | 6.10 Logistics & Delivery            | `logistics`         |
| `hr_payroll`        | 6.11 HR & Payroll                    | `hr_payroll`        |
| `attendance`        | 6.11.1 Geolocation Clock-In          | `attendance`        |
| `contacts`          | 6.12 Contacts & Directory            | `contacts`          |
| `documents`         | 6.13 Documents & Signatures          | `documents`         |
| `social_media`      | 6.14 Social Media Management         | `social`            |
| `email_campaigns`   | 6.16 Email Campaigns                 | `email_campaigns`   |
| `smartcomm`         | 6.17 Messaging                       | `smartcomm`         |
| `calendar`          | 6.18 Calendar & Scheduling           | `calendar`          |
| `tasks`             | 6.19 Tasks & To-Do                   | `tasks`             |
| `dashboards`        | 6.20 Dashboards & Reports            | `dashboards`        |
| `business_setup`    | 6.21 Business Setup                  | `business_setup`    |
| `sales_campaigns`   | 6.22 Sales Campaigns                 | `sales_campaigns`   |
| `retention`         | 6.23 Customer Retention & Loyalty    | `retention`         |
| `production`        | 6.24 Production & Landed Cost        | `production`        |
| `service_jobs`      | 6.24 Service Job Tracker (FLH)       | `service_jobs`      |
| `pricing`           | 6.25 Pricing Engine                  | `pricing`           |
| `stylist_programme` | 6.26 Stylist Partner Programme (PXG) | `stylist_programme` |
| `org_workflow`      | 6.27 Org & Workflow Builder          | `org_workflow`      |
| `storefront_studio` | 6.28 Storefront Studio               | `storefront_studio` |
| `intercompany`      | 5.1 Inter-Company Trade              | `intercompany`      |
| `praxis_ai`         | 6.29 Praxis AI Agent                 | `praxis_ai`         |
| `ai_insights`       | 6.30 AI Insights & Briefings         | `ai_insights`       |
| `ai_governance`     | 6.31 AI Control & Governance         | `ai_governance`     |
| `retail_partners`   | Wholesale & consignment (cross-cut)  | `retail_partners`   |
| `cash_request`      | 6.32 Cash Request & Disbursement     | `expenses`          |
| `audit`             | Audit log (read-only)                | `audit`             |

## Conventions

```
<module>.routes.js       Express router; thin URL → controller binding
<module>.controller.js   HTTP handlers; pulls req fields, calls service
<module>.service.js      Business logic; transactions; events; audit
<module>.repo.js         Parameterised SQL only
<module>.validator.js    Zod schemas
<module>.events.js       Domain events for realtime + AI subscribers
README.md                Module-specific notes
```

Stick to it. Anything broader belongs in `src/services/`.
