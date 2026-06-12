# Revenue → Sales → Accounting — End-to-End Validation

**Principle being validated (user directive).** *Every revenue- or discount-bearing event,
no matter where it originates, must resolve in the **Sales** module (a `sales_orders` row),
and the **General Ledger must balance**. Nothing flows in a silo.*

**Method.** Host-authoritative static trace (Read/Grep) of every revenue entry point through
to `sales_orders` and the GL journal. No `node`/bash execution — the linter validates syntax;
the bash mount serves truncated copies of fresh files so it is not used for validation.

**Date:** 2026-06-11.

---

## 1. Revenue entry points → do they resolve in Sales?

| Entry point | Path to `sales_orders` | Resolves in Sales? | GL |
|---|---|---|---|
| **Direct sale** (`POST /sales/orders` + `/payments`) | `sales.createOrder` → `addPayment` → `markPaid` | ✅ native | `order.paid` → GL |
| **POS** | `pos.service` → `salesService.createOrder` (L419) + `addPayment` (L481); "last split trips markPaid" | ✅ via Sales | `order.paid` → GL |
| **Storefront order-form** (public, no login) | `storefront.submitOrderForm` → `public_form` sales order; payment confirmed later by webhook | ✅ via Sales | `order.paid` → GL |
| **Paystack webhook** (`charge.success`) | `webhooks.service.confirmPaystackCharge` → `salesService.addPayment(metadata.order_id)` (H-4) | ✅ via Sales | `order.paid` → GL |
| **Campaign discount** | applied inside `createOrder` (discount engine) → `sales_order_discounts` (`source='campaign'`) | ✅ in the order | reduces revenue in GL |
| **Coupon** (`input.coupon_code`) | **NEW 2026-06-11** — applied inside `createOrder`: pre-VAT line distribution (or zero shipping), `sales_order_discounts` (`source='coupon'`) + `coupon_redemptions` linked to the order + usage bump under the coupon row lock | ✅ in the order | reduces revenue + VAT in GL |
| **Intercompany / retail-partners / service-jobs** | post sales + mirrored/partner GL (existing, prior audits) | ✅ | balanced |

**Result:** every active revenue path resolves in `sales_orders` and posts through the single
`order.paid` → outbox → `accounting` GL path. ✅

---

## 2. Does accounting balance?

The sale journal (`accounting.subscribers.postSaleJournal`) posts:

```
DR 1100 Cash                 total
DR 5000 COGS                 cogs            (if cost known)
   CR 4xxx Revenue (channel) net  = subtotal − discount
   CR 4200 Shipping Revenue  shipping
   CR 2100 VAT Output        tax
   CR 1300 Inventory         cogs            (if cost known)
```

Debits = `total + cogs`. Credits = `net + shipping + tax + cogs`. Since
`total = (subtotal − discount) + shipping + tax = net + shipping + tax`, **debits = credits**.
The per-brand `fn_journal_entry_balance_check` trigger re-asserts this on every posting, so an
unbalanced entry is rejected at the DB.

**Coupon correctness:** because the coupon discount is distributed across taxable lines
*pre-VAT*, `net`, `tax`, and `total` on the order are all reduced consistently — so the GL posts
the true (post-coupon) revenue and VAT, and still balances. A free-shipping coupon reduces
`shipping_fee_ngn` (and thus 4200 Shipping Revenue) directly. ✅

---

## 3. Gaps — value that does NOT yet resolve in Sales (remaining wires)

These are the end-to-end connections still to make for the principle to hold completely:

| # | Source | Today | Required wire |
|---|---|---|---|
| W-A | **Coupons** | ✅ **CLOSED 2026-06-11** — applied in `createOrder` across direct/POS/storefront | — |
| W-D | **Loyalty-points redemption** | ✅ **CLOSED 2026-06-11** — `redeem_points` accepted on all three channels; `createOrder` converts points→NGN (`loyalty_settings.naira_per_point`, default ₦10, PD §6.23.3), applies it floor-respecting alongside the coupon (shared headroom), records a `sales_order_discounts` row (`source='loyalty_points'`) and the negative `loyalty_ledger` entry referencing the order — atomic | — |
| W-E | **Referral** | ✅ N/A — referral rewards the *referrer* with loyalty points (and may issue the referee a coupon, which flows through the coupon path); it is not an order-level discount, so no `createOrder` wiring is required | — |
| W-B | **Bundle offers** (F-2) | `priceBundle` computes a discount, but nothing applies it at order placement | Carry a `bundle_id` on the order input; in `createOrder`, validate the bundle's components are present, apply its discount like the coupon path (pre-VAT distribution, shared floor headroom), record a `sales_order_discounts` row, bump bundle usage |
| W-C | **Wig subscription billing** (F-1) | Plan/lifecycle built; **no cron creates the per-cycle order**, so subscription revenue never reaches Sales | Billing cron: claim due subscriptions (`FOR UPDATE SKIP LOCKED`), charge via Paystack `charge_authorization`, on success **create a `sales_orders` row** (channel `subscription`) → `markPaid` → GL, stamp `subscription_billing_attempts.created_order_id`. Money-moving → validate on staging first |

> **Validator gap caught during this pass:** the authenticated `orderCreate` schema (`.strict()`)
> did not list `coupon_code`, so a direct `/sales/orders` request carrying a coupon would have been
> rejected outright (it only worked because storefront/POS call `createOrder` directly). Fixed:
> `coupon_code` + `redeem_points` added to `orderCreate`, and `redeem_points` to the storefront/POS
> order inputs. So both discount surfaces now reach Sales on every channel.

> **Accounting balance is structural:** every GL entry posts through `accounting.postEntry`, which
> rejects any entry where debits ≠ credits (`JOURNAL_UNBALANCED`), and the per-brand
> `fn_journal_entry_balance_check` trigger re-asserts it at the database. The ledger therefore
> cannot hold an unbalanced entry. Intercompany posts its mirrored journals through `postEntry`, so
> cross-brand trade balances in both books by construction.

Each follows the coupon pattern now in `createOrder` (validate → distribute pre-VAT → record a
`sales_order_discounts` row → update the source ledger, atomically in the order transaction), so
they're mechanical extensions rather than new designs.

---

## 4. What this validation pass changed

- **Coupons resolve in Sales (W-A).** `sales.service.createOrder` now applies the coupon inside
  the order transaction: validates + locks the coupon (`FOR UPDATE`), distributes the discount
  across taxable lines pre-VAT (or zeroes shipping for free-shipping), stores `coupon_code` on
  the order (added to the repo column list), records a `sales_order_discounts` row
  (`source='coupon'`) and a `coupon_redemptions` row referencing the order, and bumps usage —
  all atomic. The paid order's GL then posts revenue/VAT net of the coupon and balances.

**Net:** the four channels + campaigns + coupons all resolve in Sales and balance in the GL.
Bundles (W-B), subscription billing (W-C), and loyalty redemption (W-D) are the remaining
end-to-end wires, each a mechanical extension of the coupon pattern; W-C moves real money and
should be validated on staging before enablement.

---

## 5. Cross-check: `campaigns` vs `sales_campaigns` (revenue resolution)

`sales_campaigns` (§6.22) is the flash-sale / landing-page / discount engine; the comms
`email_campaigns` + `marketing` modules are NOT revenue surfaces (there is no separate
`campaigns` module in pixie). Tracing the `sales_campaigns` revenue path:

- **Campaign landing page** (`campaigns.public.service`) does `getLanding` / `getStock` /
  `signup` — **lead capture, not checkout.** A campaign never creates its own order.
- **The purchase** happens through the normal order path with `sales_campaign_id` /
  `campaign_slug` attached: `sales.createOrder` resolves the discount via the campaign engine
  (single source of truth, floor-clamped), records a `sales_order_discounts` row
  (`source='campaign'`), and stamps `sales_campaign_id` on the order. On `markPaid`,
  `discount.recordUsage` updates the campaign's revenue/discount counters. ✅ resolves in Sales.

**Two gaps this cross-check found and fixed (2026-06-11):**

1. **Storefront orders couldn't use campaigns or coupons.** `storefront.submitOrderForm` routes
   through `sales.createOrder` (good) but did **not** forward `sales_campaign_id` / `campaign_slug`
   / `coupon_code` — so public-channel orders silently skipped both discount surfaces. **Fixed:**
   the order-form validator now accepts those fields and `submitOrderForm` forwards them, so
   storefront orders price identically to direct/POS and resolve fully in Sales.

2. **Coupon × campaign stacking — now per the PD.** The PD (§6.23/§6.25) states: *"loyalty can
   never push a price below floor — and the CEO sets whether discounts may stack on already-
   discounted sale items."* Implemented exactly:
   - **Floor is always enforced.** The coupon consumes only each line's headroom above the
     variant `min_price` (distributed proportionally), so a stacked discount can never sell below
     floor. (Campaign discounts were already floor-clamped.)
   - **Stacking is CEO-configurable.** `business_config.loyalty_settings.allow_stacking_on_sale`
     (editable via the config editor) gates it. When a sale campaign already discounts the order
     and stacking is not enabled, the coupon is rejected (`COUPON_NOT_STACKABLE`); with no active
     campaign, coupons always apply. Default off (conservative).

Both keep revenue resolving in Sales with correct margins, a balanced GL, and the PD's discount
rules.
