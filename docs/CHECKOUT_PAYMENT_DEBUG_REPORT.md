# Checkout / Payment Failure — Debugging Report

**Date:** 23 June 2026
**Affected flow:** Public storefront checkout (`sales.faitlynhair.com` and `sales.pixiegirlglobal.com`) → payment via Paystack / Nomba
**Reported symptom:** Customer reaches checkout, sees *“Your order is saved but we couldn’t start the payment. Please tap pay again to retry.”* Payment never starts.

---

## Executive summary

The payment gateways (Paystack and Nomba) are **working correctly**. The checkout failures were caused by **three separate problems** uncovered in sequence. The first two were software defects and have been **fixed in code**. The third is also a **software gap** — the checkout does not price *styled products* from the styled-product tables where their price is held, so a styled item is priced at ₦0 and payment is refused. It requires development work, summarised below.

| # | Problem | Type | Status |
|---|---------|------|--------|
| 1 | Customer address could not be saved (`address_type` value not allowed) | Code defect | ✅ Fixed |
| 2 | Order could not be created (`coupon_code` column missing on `sales_orders`) | Code/DB defect | ✅ Fixed (code + DB migration) |
| 3 | Checkout prices styled products from the wrong table → order total ₦0 → payment refused | **Code gap** | ⚠️ **Requires development** |

---

## What was verified as healthy

- **Payment gateways work.** A direct test against both providers returned valid checkout links:
  - Nomba → `https://pay.nomba.com/checkout/…`
  - Paystack → `https://checkout.paystack.com/…`
- Gateway credentials are correctly configured for the brand, and the active routing chain is **Nomba → Paystack** as intended.

So the “couldn’t start the payment” message was **not** a gateway, key, or credentials problem.

---

## Problem 1 — Address could not be saved (FIXED)

**Error:** `INVALID_VALUE — a value violates a domain constraint`

The checkout saved the customer’s delivery address with the type `"shipping"`, but the database only permits `delivery`, `billing`, `office`, `home`, or `other`. Every checkout failed at this step.

**Fix:** The checkout now uses `"delivery"` (the correct, allowed value). *(Code change.)*

---

## Problem 2 — Order could not be created (FIXED)

**Error:** `column "coupon_code" of relation "sales_orders" does not exist`

The order-creation code always writes a `coupon_code` value into the `sales_orders` table, but that column was never added to the table (it existed only on `quotations`). This caused **every** checkout to fail when creating the order — on **both** brands (pixiegirl and faitlynhair).

**Fix:**
- Added the `coupon_code` column to the `sales_orders` table definition (for any new installs).
- Added database migration `000047_business_sales_orders_coupon_code` to add the column to existing databases.
- Applied the column to the live database (both brand schemas).

*(Code + database change.)*

---

## Problem 3 — Checkout prices styled products from the wrong table → order total ₦0 (REQUIRES DEVELOPMENT)

**Error:** `Order created but payment could not be initiated` → underlying reason: *“Order has no outstanding balance.”*

After fixes 1 and 2, the order is now created successfully — **but for ₦0**. Investigation showed:

- The item purchased — **“Black Straight HD6x6 Left Part Pixie Wig – Small”** — is a **styled product**. By design, a styled product’s price lives in the **styled** tables (`styled_products.retail_price_ngn` and `styled_product_variants.price_override_ngn`), **not** in the base `product_variants` table.
- The checkout, however, prices order lines **only** from `product_variants`. Its cart-to-line logic resolves a `bundle_id` or a base `product_id` to a `product_variants` row and nothing else — there is **no path for styled-product pricing**. (The styled data-access modules are even imported into the checkout file but are never used.)
- So the styled wig was priced from its **base** `product_variants` row, which is intentionally **₦0** for a styled product. The order line booked at **₦0.00**, the order total was **₦0**, and the payment system correctly **refused to start a payment for a ₦0 order** — the message the customer saw.

**This is a software gap, not a catalogue data problem.** The styled price is correctly set in the styled tables — confirmed directly in the database:

- Styled product **“Classic Mini Frontal Black”** → `retail_price_ngn` = **₦355,000**
- Size-S variant (`FLH-STY-0031-BLABD-S-6X6`) → `price_override_ngn` = **₦365,000** (exactly the price the customer saw)

So the ₦365,000 the storefront displayed **is** in the database — the checkout just doesn’t read it. Two concrete gaps confirmed in the code:

1. The checkout’s cart accepts only `bundle_id` or `product_id` — there is **no field for a styled variant** — so the storefront cannot even tell the checkout which styled item was bought.
2. The checkout prices solely from `product_variants`, with **no branch** for styled pricing (the styled data modules are imported into the checkout file but never called).

### What needs to be built (development team)

1. **Carry the styled identity through the cart.** The storefront/landing cart must send the **styled variant** (`styled_variant_id`, or `styled_id` + colour + size) for styled items, not just the base `product_id`.
2. **Price styled items from the styled tables in checkout.** The order-pricing path must resolve a styled item’s price from `styled_product_variants.price_override_ngn`, falling back to `styled_products.retail_price_ngn` (+ any size-tier premium) — instead of the base `product_variants` price.
3. **Verify the styled price data** for the products in this sale (a query is available) to confirm the values are populated, so the only remaining work is the code path above.

### Interim option

If the sale must go live before the styled-pricing path is built, a **temporary** workaround is to set `price_storefront_ngn` on the base variant of each affected styled product to its intended sale price. This is a stop-gap only — it duplicates the price into a second place and will drift from the styled tables, so it should be removed once the proper styled-pricing path ships.

---

## Recommendations (to prevent recurrence)

1. **Fail fast on mispriced items.** Add a guard so the checkout rejects any ₦0-priced line with a clear message (e.g. “This product is not available for purchase right now”), instead of silently creating a ₦0 order that dies later at the payment step with a confusing message.
2. **One pricing source for the order pipeline.** Make the checkout resolve price through a single function that knows about both base and styled products, so a styled item can never fall back to a ₦0 base price.
3. **Validate the displayed price against the charged price** when a sale is published, so the figure a customer sees can never diverge from what the order will charge.
4. **Clean up test data.** A ₦0 test order (`bdfc8365-715a-4fb7-8c11-650dbe728e36`) was created during diagnosis and should be deleted.

---

## Current status

- Gateways: **healthy.**
- Software defects (Problems 1 & 2): **fixed.**
- Remaining blocker (Problem 3): **the checkout does not price styled products** — it reads the base `product_variants` price (₦0) instead of the styled tables. This needs a code change (cart must carry the styled variant; checkout must price from the styled tables). Once that ships, checkout will complete through to Paystack/Nomba.
