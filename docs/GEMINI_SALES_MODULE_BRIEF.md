# Sales Module Frontend Build Brief
## For: Gemini Pro Extended (UI/UX Frontend Specialist)
## Prepared by: Senior Engineer / Scrum Master (Claude)

---

## YOUR ROLE

You are the **junior UI/UX frontend specialist** on this project. You have full-stack strengths but your job here is **frontend only**. You do NOT edit backend `.js` files. You build clean, error-free React TypeScript frontend files for the `apps/admin/` app. After building, you provide a **Backend Wiring Guide** — a concise report of what the senior engineer (Claude) needs to wire/edit on the backend to integrate your work.

---

## CRITICAL: THE 10-QUESTION GATE

Before writing ANY code, you **MUST** run the question gate defined in `docs/FRONTEND_INSTRUCTION_MUST_READ.md` (Section 0). Ask **10-15 questions** in A/B/C format with your recommendation. These must cover:

1. The exact tab structure: Orders tab + Quick Sale tab — confirm layout
2. Product type toggling (Base/Styled/Bundle) — how should autocomplete behave per type?
3. Client QR code flow — scan to self-fill vs staff quick-add: which is primary?
4. VAT toggle default — from `business_config.vat_rate` or manual per-sale?
5. Currency handling — default NGN with selector, or detect from product?
6. Walk-in vs Delivery — default walk-in? Google Maps integration for delivery address?
7. Payment link delivery — email only, WhatsApp only, or let staff choose?
8. Sales channel attribution — pill bar, dropdown, or auto-detected?
9. Quotation-to-order conversion — inline or separate tab?
10. Mobile-first layout — stepper wizard or progressive disclosure accordion?

Plus any additional questions about edge cases, multi-currency display, empty states, etc.

**Wait for answers before writing code.**

---

## WHAT YOU ARE BUILDING

### The Sales Module — Two Main Tabs

**Tab 1: Quick Sale** (the primary operational screen — replaces POS entirely)
**Tab 2: Orders** (all orders from all channels, with detail view)

Plus: Quotations sub-flow (B2B path: Quotation → accepted → converts to Order)

### The Sales Page URL: `/sales`

---

## CRITICAL BUSINESS RULES (NON-NEGOTIABLE)

### Rule 1: NO STOCK DEDUCTION WITHOUT PAYMENT GATEWAY CONFIRMATION
**NEVER.** Every sale must have a webhook confirmation from an authorized payment gateway (Paystack, Opay, Nomba, or Stripe) before stock is deducted. The backend handles this — your job is to make the UX flow enforce this:
- Quick Sale form creates an order in `pending_payment` status
- Sends invoice with payment link to client
- Client pays through gateway
- Webhook confirms → backend deducts stock, flips to `paid`
- Order appears in Orders tab as confirmed

### Rule 2: NO POS MODULE
Quick Sale replaces POS entirely. Faith does not want any payment outside authorized gateways. Every transaction has gateway webhook confirmation attached.

### Rule 3: MULTI-CHANNEL SALES SOURCE
Sales come from: Instagram DM, WhatsApp DM, Websites, Sales Campaigns, Walk-in, Phone, Facebook, TikTok, Public Form, Events, Wholesale, Partner, Stylist. The Quick Sale form must capture where the sale came from (`sales_channel` field).

### Rule 4: MULTI-CURRENCY
Products have prices in different currencies. During Quick Sale, staff picks the currency. The form displays in that currency. Backend stores everything in NGN with `display_currency` + `fx_rate_used` snapshot.

### Rule 5: PAYMENT MODEL AWARENESS
Products can be: `full_payment_only`, `layaway` (pay over time, ships when fully paid), or `deposit_triggered` (pay deposit %, unlocks production). The form must show the payment model badge and handle accordingly.

---

## QUICK SALE FORM — UX SPECIFICATION

Progressive disclosure flow (each section expands after previous is complete):

### Step 1: Sales Channel
Pill bar at top. Options: `walk_in`, `instagram`, `whatsapp`, `phone`, `website`, `facebook`, `tiktok`, `campaign`, `public_form`, `event`, `wholesale`, `partner`, `stylist_routed`. Default: `walk_in`.

### Step 2: Client Selection
- **Search box** with autocomplete (searches `GET /api/v1/contacts?search=...`)
- If found: select, show name + phone + email summary pill
- If NOT found, two options:
  - **"Client Fills Themselves"** button → renders QR code on screen. Client scans, lands on a mini-form (public endpoint), fills name/phone/email/birthday. On submit, contact created, auto-selected in form via real-time update
  - **"Quick Add"** button → inline mini-form: first name, last name, phone, email, day/month of birth. Creates contact via `POST /api/v1/contacts`, auto-selects

### Step 3: Product Type Selector
Toggle: **Base Product** | **Styled Product** | **Bundle**
This changes the autocomplete source for Step 4.

### Step 4: Product/Bundle Picker
- Autocomplete search filtered by type:
  - Base: `GET /api/v1/catalogue/products?search=...` → shows variants
  - Styled: `GET /api/v1/catalogue/styled-products?search=...` → shows styled variants
  - Bundle: `GET /api/v1/retention/bundles?search=...` → shows bundles with components
- Shows: thumbnail, name, SKU, price in selected currency, stock status
- On select: adds to line items table
- **Line Items Table**: product name, variant, qty (editable), unit price (read-only from pricing), line total, remove button
- Can add multiple items (mix types by toggling selector)

### Step 5: Order Configuration
- **Currency selector** (from active currencies: NGN, USD, GBP, EUR, CAD, GHS)
- **VAT toggle** (on/off, default from `business_config.vat_rate`)
- **Coupon code** field (optional, validated on blur via backend)
- **Loyalty points redemption** (optional, shows available points)

### Step 6: Fulfilment Type
- **Walk-in** (default) — customer picks up
- **Delivery** → expands:
  - Google Maps address autocomplete (`AddressAutocomplete` component exists)
  - Delivery fee auto-calculated or manual entry

### Step 7: Summary Card
Glassmorphic card showing:
- Subtotal, Discount (if any), VAT amount, Shipping fee, **Total**
- Payment model badge (Full Payment / Layaway / Deposit Required)
- Currency display

### Step 8: Action
- **"Send Invoice & Payment Link"** button
  - Choose delivery method: Email | WhatsApp | Both
  - Creates order via `POST /api/v1/sales/orders`
  - Generates payment link via `POST /api/v1/sales/orders/{id}/payment-link`
  - Sends invoice with link
  - Shows success state: "Invoice sent! Waiting for payment..."
  - Real-time: when webhook confirms payment → toast notification + order appears in Orders tab

---

## ORDERS TAB — SPECIFICATION

### Orders List (DataTable)
- **Columns**: Order #, Client Name, Date, Total (MoneyText), Status (StatusPill), Source Channel, Fulfilment Type, Payment Model
- **Filters**: Status (all/pending_payment/paid/in_production/fulfilled/cancelled), Source Channel, Date range, Search (order number, client name)
- **KPI Strip** (top): Total Orders MTD, Revenue MTD, Pending Payment Count, Average Order Value
- **Row click**: Opens Order Detail (drawer on desktop, full page on mobile)

### Order Detail
- **Header**: Order #, status pill, created date, client info
- **Line items table**: products, qty, unit price, line total
- **Payment Workbench** (critical):
  - Balance ribbon: Total | Paid | Balance Due | Payment Model badge
  - Payments ledger: every payment row (date, amount, gateway, reference, status)
  - Three action buttons:
    1. "Send Pay-Link" — resend payment link
    2. "View Customer Self-Serve" — preview the public pay page
    3. "Record Manual Payment" — HIDDEN unless `business_config.allow_staff_manual_payments === true` (Decision D-8)
- **Timeline**: Order lifecycle events
- **Actions**: Cancel (if unpaid), Generate Receipt PDF

---

## QUOTATIONS — SPECIFICATION

### Quotations View
Accessible from Sales page (could be a third tab or sub-navigation).
- **List**: Quotation #, Client, Total, Status (draft/sent/viewed/accepted/rejected/converted), Created Date
- **Filters**: Status, search
- **"New Quotation" button** → opens QuoteFormModal (4-step wizard)

### Quote Form Modal (4 Steps)
1. **Customer selection** (same autocomplete as Quick Sale)
2. **Line items** (product search, add items, qty, price — can override price here unlike Quick Sale)
3. **Terms & Config**: valid_until date, payment terms text, delivery type, notes, internal notes, coupon, shipping fee
4. **Review & Create**: summary, create button

### Quote Detail
- Header with status timeline (Draft → Sent → Viewed → Accepted/Rejected)
- Line items table
- Actions: Send (via email/WhatsApp), Accept, Reject, **Convert to Order** (creates a sales order from the quotation)

---

## FILE STRUCTURE TO CREATE

All files go in `apps/admin/src/pages/sales/`:

```
apps/admin/src/pages/sales/
  types.ts              — TypeScript interfaces (Response 1)
  constants.ts          — Status metadata, filter options, labels (Response 1)
  api.ts                — REST API calls (Response 1)
  hooks.ts              — TanStack Query hooks (Response 1)
  SalesPage.tsx         — Main page with tabs (Response 2)
  QuickSaleForm.tsx     — Quick Sale tab content (Response 2)
  OrdersView.tsx        — Orders tab with DataTable (Response 2)
  OrderDetail.tsx       — Order detail drawer/page (Response 2)
  QuotationsView.tsx    — Quotations list (Response 3)
  QuoteFormModal.tsx    — 4-step quotation builder (Response 3)
  QuoteDetail.tsx       — Quotation detail view (Response 3)
  SalesModals.tsx       — Shared modals (send quote, record payment, etc.) (Response 3)
  SalesKpiStrip.tsx     — KPI cards component (Response 2)
  ClientFinder.tsx      — Client search + QR + quick-add component (Response 2)
  ProductPicker.tsx     — Product type toggle + autocomplete (Response 2)
  PaymentWorkbench.tsx  — Balance ribbon + ledger + action buttons (Response 2)
```

---

## RESPONSE BREAKDOWN (MANDATORY — DO NOT DUMP ALL AT ONCE)

### Response 1: Foundation + Questions
- Ask your 10-15 questions (wait for answers)
- After answers: deliver `types.ts`, `constants.ts`, `api.ts`, `hooks.ts`
- These are the data layer — types, API calls, React Query hooks

### Response 2: Quick Sale + Orders
- `SalesPage.tsx` (main page with tab layout)
- `QuickSaleForm.tsx` (the progressive disclosure form)
- `ClientFinder.tsx` (client search + QR + quick-add)
- `ProductPicker.tsx` (type toggle + autocomplete)
- `OrdersView.tsx` (orders DataTable)
- `OrderDetail.tsx` (order detail with payment workbench)
- `PaymentWorkbench.tsx` (balance + ledger + buttons)
- `SalesKpiStrip.tsx` (KPI strip)

### Response 3: Quotations + Modals + Backend Wiring Guide
- `QuotationsView.tsx`
- `QuoteFormModal.tsx`
- `QuoteDetail.tsx`
- `SalesModals.tsx` (SendQuoteModal, RecordPaymentModal, etc.)
- **Backend Wiring Guide** (for the senior engineer):
  - Router changes needed (`apps/admin/src/router.tsx`)
  - Any new backend endpoints needed
  - Sidebar navigation updates
  - Any middleware or config changes
  - What to test

---

## PATTERNS TO FOLLOW (FROM EXISTING CODEBASE)

### API Pattern (from `apps/admin/src/pages/contacts/api.ts`)
```typescript
import { api } from '@/lib/api';
const BASE = '/sales';

export const listOrders = (params: OrderListParams) =>
  api.get<PaginatedResponse<SalesOrder>>(`${BASE}/orders${qs(params)}`);

export const createOrder = (input: OrderCreateInput) =>
  api.post<SalesOrder>(`${BASE}/orders`, input);
// etc.
```

### Hooks Pattern (from `apps/admin/src/pages/contacts/hooks.ts`)
```typescript
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useBusinessStore } from '@/stores/business';
import * as salesApi from './api';

const useBiz = () => useBusinessStore((s) => s.activeKey);

export function useOrders(params: OrderListParams = {}) {
  const biz = useBiz();
  return useQuery({
    queryKey: ['sales-orders', biz, params],
    queryFn: () => salesApi.listOrders(params),
    placeholderData: keepPreviousData,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: OrderCreateInput) => salesApi.createOrder(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-orders', biz] }),
  });
}
```

### Page Pattern
```typescript
import { useBreadcrumbs } from '@/stores/breadcrumbs';
import { useAuthStore } from '@/stores/auth';
import { DeniedState } from '@/components/ui/controls';

export default function SalesPage() {
  useBreadcrumbs([{ label: 'Sales' }]);
  const can = useAuthStore((s) => s.can);

  if (!can('sales', 'view')) return <DeniedState />;

  // ... tabs, content
}
```

### Component Imports Available
```typescript
// UI Primitives
import { Button, Card, Pill, StatusPill, Skeleton, EmptyState, KpiTile, MoneyText } from '@/components/ui/primitives';
import { FormSection, FormGrid, Field, TextInput, SaveBar } from '@/components/ui/Form';
import { Select, MultiSelect, Toggle, NumberField, Checkbox, DeniedState, ErrorState } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Timeline } from '@/components/ui/Timeline';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
// Shell
import { PageActions } from '@/components/shell/PageActions';
// Stores
import { useAuthStore } from '@/stores/auth';
import { useBusinessStore } from '@/stores/business';
import { useBreadcrumbs } from '@/stores/breadcrumbs';
// API
import { api } from '@/lib/api';
```

---

## BACKEND API ENDPOINTS AVAILABLE (DO NOT INVENT NEW ONES)

### Sales Orders
```
GET    /api/v1/sales/orders                    — List orders (filters: status, contact_id, sales_channel, search, page, page_size)
POST   /api/v1/sales/orders                    — Create order
GET    /api/v1/sales/orders/:id                — Get order detail (includes lines, payments, discounts)
PATCH  /api/v1/sales/orders/:id                — Update order header
POST   /api/v1/sales/orders/:id/payments       — Record payment
POST   /api/v1/sales/orders/:id/payment-link   — Generate payment link
POST   /api/v1/sales/orders/:id/cancel         — Cancel order
POST   /api/v1/sales/orders/:id/receipt        — Generate receipt PDF
GET    /api/v1/sales/orders/:id/timeline        — Order timeline events
```

### Quotations
```
GET    /api/v1/sales/quotations                — List quotations
POST   /api/v1/sales/quotations                — Create quotation
GET    /api/v1/sales/quotations/:quoId         — Get quotation detail
POST   /api/v1/sales/quotations/:quoId/send    — Send quotation
POST   /api/v1/sales/quotations/:quoId/accept  — Accept quotation
POST   /api/v1/sales/quotations/:quoId/reject  — Reject quotation
POST   /api/v1/sales/quotations/:quoId/convert — Convert to order
```

### Cancellations
```
POST   /api/v1/sales/orders/:id/cancellation   — Request cancellation
GET    /api/v1/sales/cancellations             — List cancellation requests
POST   /api/v1/sales/cancellations/:reqId/approve — Approve
POST   /api/v1/sales/cancellations/:reqId/reject  — Reject
```

### Supporting Endpoints (for autocomplete/lookup)
```
GET    /api/v1/contacts?search=...             — Search contacts
POST   /api/v1/contacts                        — Create contact (quick-add)
GET    /api/v1/catalogue/products?search=...   — Search base products
GET    /api/v1/catalogue/products/:id/variants — Get variants for product
GET    /api/v1/catalogue/styled-products?search=... — Search styled products
GET    /api/v1/retention/bundles?search=...    — Search bundles
```

---

## VALIDATOR SCHEMAS (EXACT FIELDS FOR API CALLS)

### Order Create Payload
```typescript
{
  contact_id: string;           // UUID - required
  sales_channel: SalesChannel;  // required
  order_type?: 'walk_in' | 'dispatch' | 'digital' | 'collection';
  is_custom_order?: boolean;
  lines: Array<{
    variant_id: string;         // UUID
    quantity: number;           // int > 0
    unit_price_ngn?: number;    // optional override
    notes?: string;             // max 500 chars
  }>;                          // min 1 line
  sales_campaign_id?: string;
  campaign_slug?: string;
  coupon_code?: string;         // max 60 chars
  redeem_points?: number;       // int > 0
  bundle_id?: string;
  client_idempotency_key?: string; // max 80 chars
  shipping_fee_ngn?: number;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}
```

### Payment Create Payload
```typescript
{
  method: PaymentMethod;        // required
  amount_ngn: number;           // > 0, required
  provider?: string;
  provider_reference?: string;
  paid_currency?: string;       // 3-char ISO
  paid_amount?: number;
  fx_rate_used?: number;
  fee_ngn?: number;
  payment_path?: 'tokenized_link' | 'customer_account' | 'staff_recorded' | 'pos' | 'intercompany' | 'subscription_charge';
  client_idempotency_key?: string;
}
```

### Payment Methods Enum
```typescript
type PaymentMethod =
  | 'paystack_card' | 'paystack_transfer' | 'paystack_ussd'
  | 'opay' | 'nomba_terminal'
  | 'bank_transfer' | 'cash' | 'pos_card'
  | 'pay_on_delivery' | 'wallet' | 'points'
  | 'subscription_recurring';
```

### Sales Channels Enum
```typescript
type SalesChannel =
  | 'storefront' | 'pos' | 'woocommerce'
  | 'instagram' | 'whatsapp' | 'wholesale'
  | 'partner' | 'stylist_routed' | 'subscription'
  | 'phone' | 'event' | 'public_form'
  | 'facebook' | 'tiktok' | 'intercompany';
```

### Quotation Create Payload
```typescript
{
  contact_id: string;           // UUID - required
  deal_id?: string;             // UUID, CRM link
  lines: Array<{
    variant_id: string;
    quantity: number;           // int > 0
    unit_price_ngn?: number;
    line_discount_ngn?: number;
    notes?: string;
  }>;                          // min 1 line
  valid_until?: string;         // ISO date
  payment_terms?: string;       // max 300
  notes?: string;               // max 2000
  internal_notes?: string;      // max 2000
  delivery_type?: 'walk_in' | 'dispatch' | 'digital' | 'collection';
  coupon_code?: string;
  shipping_fee_ngn?: number;
}
```

### Payment Link Payload
```typescript
{
  amount_ngn?: number;          // default: outstanding balance
  currency?: string;            // default: "NGN"
}
```

---

## DESIGN SYSTEM RULES (FROM THE CANON)

1. **Palette "Maroon Noir"**: dark default, accent `#690909`. Never inline hex — use CSS variable tokens
2. **Glassmorphism** on all overlays, dropdowns, drawers, menus
3. **Typography**: Playfair Display (headings), Montserrat (body), JetBrains Mono (money)
4. **Money via `MoneyText`**: NGN-based, never recompute with live FX
5. **Four states every screen**: Loading skeleton, Empty (with CTA), Error (with retry), Permission-denied
6. **Permission-aware**: Hide controls user lacks permission for (`useAuthStore().can()`)
7. **Entity scope**: Include `biz` (activeKey) in every TanStack Query key
8. **Mobile-first**: Design for mobile, enhance for desktop
9. **Status pills**: Use `StatusPill` with tone system (success/warn/danger/info)
10. **Workflow-gated writes**: Submit to `workflow_instances`, not directly to target tables

---

## DO NOT

- Do NOT create any new backend files or edit `.js` files
- Do NOT invent API endpoints that don't exist in the list above
- Do NOT hardcode business values (VAT rate, currency list, etc.) — read from config/API
- Do NOT use `localStorage` for auth tokens
- Do NOT use `.then()` chains — async/await only
- Do NOT skip the 10-question gate
- Do NOT dump all files in one response — split into 3 responses
- Do NOT use emojis in code
- Do NOT create README or documentation files
- Do NOT use inline styles — use CSS variables and utility classes
- Do NOT handle money with plain JavaScript Number — use string representation from API, display via `MoneyText`

---

## BACKEND WIRING GUIDE FORMAT (Response 3)

At the end of Response 3, include a section titled **"Backend Wiring Guide for Senior Engineer"** covering:

1. **Router updates**: Exact lines to add in `apps/admin/src/router.tsx`
2. **Sidebar navigation**: What to add in `apps/admin/src/components/shell/Sidebar.tsx`
3. **New backend endpoints needed** (if any — you should NOT need new ones, but flag if the UX requires something the API doesn't support)
4. **QR code endpoint**: The Quick Sale QR code for client self-fill may need a new public endpoint or use the existing `/api/public/order-capture` flow
5. **Real-time events**: Which Socket.io events to subscribe to (e.g., `order.payment` for live payment confirmation)
6. **Business config fields**: Any `business_config` fields the frontend reads that need to be confirmed on backend
7. **Testing checklist**: What the senior engineer should verify after wiring
