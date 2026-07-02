/**
 * Sales (V2.2 §6.2) — order lifecycle + cross-module wiring.
 *
 * createOrder:  builds line snapshots, applies the campaign discount via the
 *   Sales-Campaigns discount engine (single source of truth), clamps every
 *   line to the variant's min_price (the §6.25 margin floor), computes VAT
 *   and totals, persists order + lines + discount rows.
 * addPayment → markPaid:  when paid in full, deducts stock through the Stock
 *   SSOT (negative 'sale' movement), records campaign usage, and emits
 *   `order.paid` for Invoicing + Accounting to consume.
 */

"use strict";

const repo = require("./sales.repo");
const events = require("./sales.events");
const outbox = require("../../shared/outbox/outbox");
const discount = require("../sales_campaigns/campaigns.discount.service");
const couponService = require("../retention/coupon.service");
const couponRepo = require("../retention/coupon.repo");
const retentionRepo = require("../retention/retention.repo");
const bundleRepo = require("../retention/bundle.repo");
const bundleService = require("../retention/bundle.service");
const campaignsRepo = require("../sales_campaigns/campaigns.repo");
const campaignsService = require("../sales_campaigns/campaigns.service");
const pdf = require("../../services/pdf.service");
const brandDocs = require("../../services/pdf.brand-docs");
const docCopy = require("../../services/document-copy");
const emailRender = require("../email_campaigns/email-render");
const stockService = require("../stock/stock.service");
const stockRepo = require("../stock/stock.repo");
const businessConfig = require("../business_setup/business-config.repo");
const salesReportExport = require("./sales-report.export");
const { audit } = require("../../middleware/audit");
const { transaction, query } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { toUtc, formatTz } = require("../../utils/dates");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const { channelPrice } = require("./pricing/channel-price");
const { createDiscountAllocator } = require("./pricing/allocator");
const { clampToMarginFloor } = require("./pricing/margin-floor");
const {
  resolveCouponApplication,
  campaignDiscountTotal,
} = require("./pricing/coupon");
const { computePointsRedemption } = require("./pricing/points");
const { assertBundleComplete, computeBundleDiscount } = require("./pricing/bundle");
const { exitIntentMatches } = require("./pricing/exit-intent");
const { computeTotalsAndLines, computeDepositPolicy } = require("./pricing/totals");

const PAID_STATES = new Set(["paid", "awaiting_dispatch", "completed"]);

// Per-gateway Payment Processing Fees GL accounts (V2.2 §6.6 A-7 / seed 000035).
// Stripe is split per settlement currency.
const GATEWAY_FEE_ACCOUNT = {
  paystack: "5511",
  opay: "5512",
  nomba: "5513",
};
const STRIPE_FEE_ACCOUNT_BY_CCY = {
  USD: "5514",
  GBP: "5515",
  EUR: "5516",
  CAD: "5517",
  GHS: "5518",
};
function gatewayFeeAccount(provider, paid_currency) {
  if (provider === "stripe")
    return (
      STRIPE_FEE_ACCOUNT_BY_CCY[(paid_currency || "USD").toUpperCase()] ||
      "5514"
    );
  return GATEWAY_FEE_ACCOUNT[provider] || null;
}

async function createOrder({ brand, user, request_id, input }) {
  // Idempotency (H-9): a double-submitted public checkout must not create two
  // orders. Fast path returns the existing order; the partial UNIQUE index is
  // the race backstop (handled in the catch below).
  if (input.client_idempotency_key) {
    const existingId = await repo.findByIdempotencyKey({
      brand,
      key: input.client_idempotency_key,
    });
    if (existingId) return repo.findById({ brand, id: existingId });
  }
  try {
    return await createOrderTx({ brand, user, request_id, input });
  } catch (err) {
    if (err && err.code === "23505" && input.client_idempotency_key) {
      const existingId = await repo.findByIdempotencyKey({
        brand,
        key: input.client_idempotency_key,
      });
      if (existingId) return repo.findById({ brand, id: existingId });
    }
    throw err;
  }
}

async function createOrderTx({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const cfg = await businessConfig.findByKey(brand);
    if (!cfg) {
      throw new AppError(
        "BUSINESS_CONFIG_MISSING",
        `Business configuration not found for brand "${brand}"`,
        500,
        "System configuration error — please contact support",
      );
    }
    // VAT rate is read from business_config as SSOT. The DB guarantees a row
    // exists (migration 000239 set DEFAULT 0) so cfg.vat_rate is always present.
    // No JS-level fallback: if vat_rate is 0 we apply 0; if it is ever changed
    // in settings that change takes effect here immediately.
    const defaultVat = money(cfg.vat_rate);

    // 1. Resolve line pricing context + base unit prices.
    const built = [];
    for (const li of input.lines) {
      // A line is EITHER a product variant or a service offering (PR3). A
      // service ctx has null product_id/min_price/cost, so the campaign,
      // margin-floor, stock and COGS steps below all skip it naturally.
      const ctx =
        !li.variant_id && li.service_offering_id
          ? await repo.serviceOfferingContext({
              client,
              brand,
              service_id: li.service_offering_id,
            })
          : await repo.variantContext({
              client,
              brand,
              variant_id: li.variant_id,
            });
      if (!ctx)
        throw new AppError(
          "REFERENCE_INVALID",
          li.service_offering_id
            ? `Service ${li.service_offering_id} not found`
            : `Variant ${li.variant_id} not found`,
          409,
        );
      const unit = money(
        li.unit_price_ngn !== null && li.unit_price_ngn !== undefined
          ? li.unit_price_ngn
          : (channelPrice(ctx, input.sales_channel) ?? 0),
      );
      built.push({ li, ctx, unit, perUnitDiscount: money(0) });
    }

    // 2. Campaign discount (engine = single source of truth), if attached.
    let campaign = null;
    const campaignRef = input.sales_campaign_id
      ? { campaign_id: input.sales_campaign_id }
      : input.campaign_slug
        ? { slug: input.campaign_slug }
        : null;
    if (campaignRef) {
      // Determine real eligibility flags for this contact so first-time-buyer
      // and segment-targeted campaigns actually fire. is_first_time = no prior
      // paid order on this brand. segment_ids cannot be populated yet (no
      // contact→segment membership table; see CONFORMANCE_GAPS G-2).
      const isFirstTime = input.contact_id
        ? !(await repo.hasPaidOrder({
            client,
            brand,
            contact_id: input.contact_id,
          }))
        : false;
      const res = await discount.resolveDiscount({
        brand,
        campaignRef,
        cart: {
          items: built.map((b) => ({
            product_id: b.ctx.product_id,
            category_id: b.ctx.category_id || null,
            unit_price_ngn: toCurrencyString(b.unit),
            quantity: b.li.quantity,
          })),
        },
        contact: { is_first_time: isFirstTime, segment_ids: [] },
        allowStacking: false,
      });
      if (res.eligible) {
        campaign = res;
        const perUnitByProduct = new Map();
        for (const rl of res.lines) {
          perUnitByProduct.set(
            rl.product_id,
            money(rl.unit_price_ngn).minus(money(rl.discounted_unit_price_ngn)),
          );
        }
        for (const b of built) {
          const pu = perUnitByProduct.get(b.ctx.product_id);
          if (pu) b.perUnitDiscount = pu;
        }
      }
    }

    // 3. Margin-floor clamp (§6.25): never below the variant's min_price
    // (pure — pricing/margin-floor.js).
    clampToMarginFloor(built);

    // 3.5 Coupon (F-3) — resolve the coupon IN Sales. Distribute the discount
    // across taxable lines pre-VAT (tax is computed on the post-coupon price);
    // a free_shipping coupon zeroes the shipping fee instead. The order's
    // discount/total reflect it and a coupon_redemption links back to the order
    // (recorded after the order row exists). The coupon row is locked
    // FOR UPDATE for this transaction so the usage limit + bump are atomic.
    const shipping0 = money(input.shipping_fee_ngn || 0);
    let couponShipping = money(0);
    let couponLineTotal = money(0);
    let pointsLineTotal = money(0);
    let pointsUsed = 0;
    let couponMeta = null;
    // Exit-intent "stay" promo (§6.22): the campaign's exit_intent_code is a
    // flat ₦-off shown in the exit modal and typed into the SAME promo field as
    // a coupon — but it is NOT a retention coupon, so it is resolved against the
    // live campaign here (below) rather than via couponService.
    let exitIntentMeta = null;
    let exitIntentLineTotal = money(0);
    // Soft, buyer-facing notices (e.g. "we applied the bigger saving") and
    // pre-order lines — threaded onto the returned order so the public checkout
    // can show them without ever blocking the sale.
    const notices = [];
    // Order-level discount allocation (coupon / points / bundle / deal
    // ladder). The §6.25 headroom ledger + proportional allocation live in
    // pricing/allocator.js; the arrays destructured here are the allocator's
    // live state (mutated as each stage applies).
    const alloc = createDiscountAllocator(built);
    const { preNet, preNetByIdx, extraShareByIdx } = alloc;
    const applyOrderDiscount = alloc.applyOrderDiscount;

    // Exit-intent code (§6.22). When the entered code matches the LIVE
    // campaign's exit_intent_code, apply exit_intent_discount_ngn as a flat,
    // floor-respecting order-level discount and skip the coupon path entirely
    // (the same code would otherwise be rejected as COUPON_INVALID, which is
    // exactly why "the amount off was never added" — the exit-intent fields
    // were never wired into pricing). The discount stacks on top of the live
    // sale; applyOrderDiscount only ever consumes remaining margin-floor
    // headroom, so it can never sell below the variant floor.
    if (input.coupon_code && campaignRef) {
      const campRow = campaignRef.campaign_id
        ? await campaignsRepo.findById({
            client,
            brand,
            id: campaignRef.campaign_id,
          })
        : await campaignsRepo.findBySlug({
            client,
            brand,
            slug: campaignRef.slug,
          });
      const entered = String(input.coupon_code).trim().toUpperCase();
      const liveState = campRow
        ? campaignsService.resolveState(campRow)
        : null;
      if (exitIntentMatches(campRow, entered, liveState)) {
        // The code is recognised as this campaign's exit-intent promo — claim
        // it so it never falls through to the coupon validator (which would
        // reject it as COUPON_INVALID). The applied amount may be 0 if the live
        // sale already consumed all margin-floor headroom.
        exitIntentMeta = {
          campaign_id: campRow.campaign_id,
          code: campRow.exit_intent_code,
        };
        let want = money(campRow.exit_intent_discount_ngn);
        if (want.gt(preNet)) want = preNet;
        exitIntentLineTotal = applyOrderDiscount(want);
        if (exitIntentLineTotal.gt(money(0))) {
          notices.push({
            code: "EXIT_INTENT_APPLIED",
            message: `Code ${campRow.exit_intent_code} applied — ${toCurrencyString(
              exitIntentLineTotal,
            )} off.`,
          });
        }
      }
    }

    // Coupon (F-3) — skipped when the code was already consumed as the
    // campaign's exit-intent promo above.
    if (input.coupon_code && !exitIntentMeta) {
      const cr = await couponService.validateCoupon({
        brand,
        code: input.coupon_code,
        contact_id: input.contact_id,
        order_subtotal_ngn: toCurrencyString(preNet),
        client,
      });
      if (!cr.valid)
        throw new AppError(
          "COUPON_INVALID",
          `Coupon not applicable: ${cr.reason}`,
          409,
        );
      couponMeta = cr.coupon;
      // PD §6.23/§6.25: the CEO sets whether discounts may stack on already-
      // discounted sale items (floor is always enforced above). The decision
      // (free-shipping / stack / better-of-sale-vs-coupon) is pure —
      // pricing/coupon.js — returning what to allocate + any buyer notice.
      const decision = resolveCouponApplication({
        coupon: cr,
        discount_ngn: cr.discount_ngn,
        campaignActive: !!campaign,
        allowStacking: !!(
          cfg &&
          cfg.loyalty_settings &&
          cfg.loyalty_settings.allow_stacking_on_sale
        ),
        campaignDiscountTotal: campaignDiscountTotal(built),
        preNet,
      });
      if (decision.kind === "free_shipping") {
        couponShipping = shipping0;
      } else if (decision.kind === "keep_sale") {
        // Sale is the better deal — drop the coupon (no redemption recorded).
        couponMeta = null;
        notices.push(decision.notice);
      } else {
        couponLineTotal = applyOrderDiscount(decision.requested);
        if (decision.notice) notices.push(decision.notice);
      }
    }

    // Loyalty points redemption (§6.23.3): "Apply points as a discount at
    // checkout (e.g., 100 points = ₦1,000 off). The conversion rate is
    // configurable." 1 point = loyalty_settings.naira_per_point (default ₦10).
    // Floor-respecting; only the points actually applied are deducted.
    if (input.redeem_points && input.contact_id) {
      const pts = Math.floor(Number(input.redeem_points));
      if (pts > 0) {
        const state = await retentionRepo.getLoyaltyState({
          client,
          brand,
          contact_id: input.contact_id,
        });
        const balance = state ? state.current_balance : 0;
        if (balance < pts)
          throw new AppError(
            "INSUFFICIENT_POINTS",
            "Not enough points to redeem",
            409,
          );
        const { usePts, value } = computePointsRedemption({
          points: pts,
          nairaPerPoint:
            cfg && cfg.loyalty_settings && cfg.loyalty_settings.naira_per_point,
          headroomAvailable: alloc.headroomLeft(),
        });
        if (usePts > 0) {
          applyOrderDiscount(value);
          pointsUsed = usePts;
          pointsLineTotal = value;
        }
      }
    }

    // 3.7 Bundle (F-2 / §6.23.4): if the order carries a bundle_id, verify its
    // core components are all present in the cart, then apply the bundle
    // discount on the component subtotal (floor-respecting, shared headroom).
    let bundleMeta = null;
    let bundleLineTotal = money(0);
    if (input.bundle_id) {
      const bundle = await bundleRepo.getById({ brand, id: input.bundle_id });
      if (!bundle || !bundle.is_active)
        throw new AppError(
          "BUNDLE_INVALID",
          "Bundle not found or inactive",
          409,
        );
      // Component verification + discount amount are pure — pricing/bundle.js
      // (quantity models delegate to retention's quantityBundleDiscount).
      assertBundleComplete(bundle, built);
      const d = computeBundleDiscount({
        bundle,
        built,
        preNetByIdx,
        quantityBundleDiscount: bundleService.quantityBundleDiscount,
      });
      bundleMeta = bundle;
      bundleLineTotal = applyOrderDiscount(d);
    }

    // 3.8 Campaign deal ladder (v3): the per-wig position ladder, the bundle
    // stacking bonus, the cart-level quantity-tier ladder and the reseller/bulk
    // tiers. These are pre-computed by the caller (the public quote + checkout
    // flow in sales_campaigns), where the cart semantics they depend on — wig
    // units, distinct bundles, raw-vs-styled — are still known (they're lost
    // once the cart is flattened to variant lines here). The amount is a fixed ₦
    // total applied order-level.
    //
    // OWNER DECISION (see CONFORMANCE_GAPS G-1): campaign deal discounts do NOT
    // consider the §6.25 margin floor. The cart/checkout quote the buyer sees is
    // computed floor-free, so the charge must be too — otherwise the till could
    // clamp a discount the buyer was shown and overcharge them. Unlike
    // coupons/points/bundles above (which stay floor-respecting), this allocates
    // against each line's full remaining value, down to ₦0 (never negative), so
    // a campaign may sell below the variant min_price. Runs last; nothing after
    // it consumes line headroom.
    let dealLineTotal = money(0);
    if (input.campaign_deal_discount_ngn) {
      const want = money(input.campaign_deal_discount_ngn);
      if (want.gt(money(0))) {
        // Floor-IGNORING allocation (pricing/allocator.js): consumes each
        // line's full remaining net value, matching the floor-free quote the
        // buyer was shown. Runs last; nothing after it consumes headroom.
        dealLineTotal = alloc.applyFloorFreeDiscount(want);
      }
    }

    // 4. Totals + VAT + persistable line snapshots (pure — pricing/totals.js).
    const { subtotal, discountTotal, taxTotal, lineRows } =
      computeTotalsAndLines({ built, extraShareByIdx, defaultVat });
    const shipping = shipping0.minus(couponShipping);
    const total = subtotal.minus(discountTotal).plus(taxTotal).plus(shipping);

    // 4b. Payment model + deposit policy (V2.2 §6.2) — pricing/totals.js.
    const { paymentModel, requiredDepositPct, requiredDepositNgn } =
      computeDepositPolicy({
        built,
        installmentSettings: (cfg && cfg.installment_settings) || {},
        input,
        total,
      });

    // 5. Persist.
    const order_number = await repo.nextNumber({
      client,
      brand,
      type: "sales_order",
    });
    const order = await repo.createOrder({
      client,
      brand,
      order: {
        order_number,
        contact_id: input.contact_id,
        sales_channel: input.sales_channel,
        order_type: input.order_type || "dispatch",
        is_custom_order: input.is_custom_order || false,
        sales_campaign_id:
          input.sales_campaign_id || (campaign ? campaign.campaign_id : null),
        utm_source: input.utm_source,
        utm_medium: input.utm_medium,
        utm_campaign: input.utm_campaign || (campaign ? campaign.slug : null),
        status: "pending_payment",
        subtotal_ngn: toCurrencyString(subtotal),
        discount_amount_ngn: toCurrencyString(discountTotal),
        tax_amount_ngn: toCurrencyString(taxTotal),
        shipping_fee_ngn: toCurrencyString(shipping),
        total_ngn: toCurrencyString(total),
        coupon_code: input.coupon_code || null,
        client_idempotency_key: input.client_idempotency_key || null,
        payment_model: paymentModel,
        required_deposit_pct:
          requiredDepositPct !== null && requiredDepositPct !== undefined
            ? requiredDepositPct.toFixed(2)
            : null,
        required_deposit_ngn:
          requiredDepositNgn !== null && requiredDepositNgn !== undefined
            ? toCurrencyString(requiredDepositNgn)
            : null,
      },
    });

    for (const lr of lineRows) {
      // Strip the internal helper field before persisting — it is not a DB column.
      const { _campaign_resolve_discount_ngn, ...lineForDb } = lr;
      const line = await repo.insertLine({
        client,
        brand,
        line: { ...lineForDb, order_id: order.order_id },
      });
      // Per-line campaign discount row: record only the resolveDiscount share
      // (percentage / fixed / price-override). Order-level discounts (coupon,
      // points, bundle, deal-ladder) each have their own breakdown rows below,
      // so using the full line_discount_ngn here would double-count them all.
      if (
        campaign &&
        _campaign_resolve_discount_ngn &&
        money(_campaign_resolve_discount_ngn).gt(0)
      ) {
        await repo.insertDiscount({
          client,
          brand,
          disc: {
            order_id: order.order_id,
            source: "campaign",
            source_reference: campaign.slug,
            sales_campaign_id: campaign.campaign_id,
            applied_to_line_id: line.line_id,
            amount_ngn: _campaign_resolve_discount_ngn,
            discount_type:
              campaign.discount_type === "percentage"
                ? "percentage"
                : campaign.discount_type === "free_shipping"
                  ? "free_shipping"
                  : "fixed",
          },
        });
      }
    }

    // 5a. Record the coupon discount IN Sales + log the redemption against this
    // order (so the coupon resolves end-to-end: order totals, GL, and the
    // redemption all reference the same order). Usage is bumped under the lock
    // taken in step 3.5.
    if (couponMeta) {
      const couponAmt = couponLineTotal.plus(couponShipping);
      if (couponAmt.gt(0)) {
        await repo.insertDiscount({
          client,
          brand,
          disc: {
            order_id: order.order_id,
            source: "coupon",
            source_reference: input.coupon_code,
            amount_ngn: toCurrencyString(couponAmt),
            discount_type:
              couponMeta.discount_type === "percentage"
                ? "percentage"
                : couponMeta.discount_type === "free_shipping"
                  ? "free_shipping"
                  : "fixed",
          },
        });
        await couponRepo.recordRedemption({
          client,
          redemption: {
            coupon_id: couponMeta.coupon_id,
            contact_id: input.contact_id,
            business: brand,
            reference_type: "sales_order",
            reference_id: order.order_id,
            discount_applied: toCurrencyString(couponAmt),
          },
        });
        await couponRepo.bumpUsage({
          client,
          coupon_id: couponMeta.coupon_id,
          discount_ngn: toCurrencyString(couponAmt),
        });
      }
    }

    // 5a-i. Record the exit-intent promo as an order-level campaign discount
    // (source 'campaign', referenced by the entered code so it is distinct from
    // the per-line sale rows, which reference the campaign slug).
    if (exitIntentMeta && exitIntentLineTotal.gt(money(0))) {
      await repo.insertDiscount({
        client,
        brand,
        disc: {
          order_id: order.order_id,
          source: "campaign",
          source_reference: exitIntentMeta.code,
          sales_campaign_id: exitIntentMeta.campaign_id,
          amount_ngn: toCurrencyString(exitIntentLineTotal),
          discount_type: "fixed",
        },
      });
    }

    // 5a-ii. Record loyalty points redemption IN Sales (§6.23.3): a
    // sales_order_discounts row + the negative loyalty-ledger entry, both
    // referencing this order, so the points discount resolves end-to-end and
    // the customer's balance is debited atomically with the order.
    if (pointsUsed > 0 && pointsLineTotal.gt(0)) {
      await repo.insertDiscount({
        client,
        brand,
        disc: {
          order_id: order.order_id,
          source: "loyalty_points",
          source_reference: `${pointsUsed} pts`,
          amount_ngn: toCurrencyString(pointsLineTotal),
          discount_type: "points_redemption",
        },
      });
      await retentionRepo.insertLoyaltyLedger({
        client,
        brand,
        entry: {
          contact_id: input.contact_id,
          transaction_type: "redeemed",
          points: -Math.abs(pointsUsed),
          reference_type: "sales_order",
          reference_id: order.order_id,
          notes: `Redeemed ${pointsUsed} pts on ${order_number}`,
          created_by: user.user_id,
        },
      });
    }

    // 5a-iii. Record the bundle discount IN Sales + bump bundle usage.
    if (bundleMeta && bundleLineTotal.gt(0)) {
      await repo.insertDiscount({
        client,
        brand,
        disc: {
          order_id: order.order_id,
          source: "bundle",
          source_reference: bundleMeta.bundle_code,
          amount_ngn: toCurrencyString(bundleLineTotal),
          discount_type:
            bundleMeta.pricing_model === "pct_off" ? "percentage" : "fixed",
        },
      });
      await bundleRepo.bumpUsage({
        client,
        brand,
        bundle_id: bundleMeta.bundle_id,
      });
    }

    // 5a-iv. Record the campaign deal-ladder discount IN Sales (position
    // ladder + stacking bonus + quantity tier + reseller/bulk). Logged under
    // the 'quantity_rule' source and linked to the campaign so the order's
    // discount breakdown is complete and the figure ties out end-to-end.
    if (dealLineTotal.gt(0)) {
      await repo.insertDiscount({
        client,
        brand,
        disc: {
          order_id: order.order_id,
          source: "quantity_rule",
          source_reference: campaign ? campaign.slug : "campaign_deal",
          sales_campaign_id: campaign ? campaign.campaign_id : null,
          amount_ngn: toCurrencyString(dealLineTotal),
          discount_type: "fixed",
        },
      });
    }

    // 5b. Layaway reserves stock at placement (V2.2 §6.2): the unit is held
    // but no work begins until paid in full.
    //
    // CRITICAL (the #1 cause of INTERNAL_ERROR at checkout): the Stock SSOT
    // enforces `reserved <= on_hand`, so reserving an out-of-stock, unstocked,
    // or oversold item RAISEs a constraint error. A bare try/catch does NOT
    // rescue this — once a statement errors mid-transaction Postgres aborts the
    // whole transaction, and the next write (audit/outbox/findById) fails with
    // 25P02, which surfaces to the buyer as a generic 500 and loses the order.
    //
    // Each reserve therefore runs inside its OWN SAVEPOINT. If it fails, we roll
    // back just that savepoint (the transaction stays healthy) and record the
    // line as a PRE-ORDER. We accept pre-orders, so checkout never fails on
    // stock — the buyer is told the item ships on the pre-order timeline.
    const preorderLines = [];
    if (paymentModel === "layaway") {
      const loc = await stockRepo.getDefaultLocation({ client, brand });
      for (const lr of lineRows) {
        if (!lr.variant_id) continue;
        if (!loc) {
          preorderLines.push(lr);
          continue;
        }
        await client.query("SAVEPOINT pgh_reserve");
        try {
          await stockService.reserveForOrder({
            client,
            brand,
            variant_id: lr.variant_id,
            location_id: loc.location_id,
            quantity: lr.quantity,
            reference_id: order.order_id,
            user_id: user.user_id,
          });
          await client.query("RELEASE SAVEPOINT pgh_reserve");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT pgh_reserve");
          await client.query("RELEASE SAVEPOINT pgh_reserve").catch(() => {});
          preorderLines.push(lr);
          logger.info(
            {
              err: err.message,
              order_id: order.order_id,
              variant_id: lr.variant_id,
            },
            "stock short — line recorded as pre-order",
          );
        }
      }
    }
    if (preorderLines.length) {
      notices.push({
        code: "PREORDER_ITEMS",
        message:
          "Some items in your order are pre-order and will ship on the pre-order timeline.",
      });
    }

    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.create",
      target_type: "sales_order",
      target_id: order.order_id,
      after: { order_number, total_ngn: toCurrencyString(total) },
      request_id,
    });
    events.emit("order.created", {
      brand,
      order_id: order.order_id,
      contact_id: order.contact_id,
    });
    // A confirmed dispatch order goes straight to the logistics queue (H-2):
    // enqueue `order.confirmed` so logistics auto-creates a queued delivery —
    // covers pay-on-delivery orders that never fire `order.paid` before they
    // ship. Idempotent downstream (no-ops if a delivery already exists).
    if ((input.order_type || "dispatch") === "dispatch") {
      await outbox.enqueue(client, {
        business: brand,
        event_type: "order.confirmed",
        payload: {
          brand,
          order_id: order.order_id,
          contact_id: order.contact_id,
        },
        dedup_key: `order.confirmed:${order.order_id}`,
      });
    }
    const finalOrder = await repo.findById({
      client,
      brand,
      id: order.order_id,
    });
    // Thread soft notices + pre-order detail back to the caller (public
    // checkout) without persisting them on the row. Non-enumerable so they
    // never leak into JSON serialisation of the order itself.
    if (finalOrder && (notices.length || preorderLines.length)) {
      Object.defineProperty(finalOrder, "_notices", {
        value: notices,
        enumerable: false,
      });
      Object.defineProperty(finalOrder, "_preorder", {
        value: {
          is_preorder: preorderLines.length > 0,
          line_count: preorderLines.length,
          variant_ids: preorderLines.map((l) => l.variant_id),
          names: preorderLines
            .map((l) => l.product_name_snapshot)
            .filter(Boolean),
        },
        enumerable: false,
      });
    }
    return finalOrder;
  });
}

function listOrders({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listOrders({ brand, filters, page, page_size, offset });
}
async function getById({ brand, id }) {
  const o = await repo.findById({ brand, id });
  if (!o) throw new NotFoundError("Order");
  o.payments = await repo.listPayments({ brand, order_id: id });
  o.discounts = await repo.listDiscounts({ brand, order_id: id });
  return o;
}

// Edit an order while it is still editable (draft / pending_payment): header
// fields only — line edits go through dedicated add/remove-line endpoints.
async function updateOrder({ brand, user, request_id, id, patch }) {
  return transaction(async (client) => {
    const before = await repo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("Order");
    if (!["draft", "pending_payment"].includes(before.status)) {
      throw new AppError(
        "INVALID_STATE",
        `A '${before.status}' order cannot be edited`,
        409,
      );
    }
    const updated = await repo.updateOrderHeader({ client, brand, id, patch });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.update",
      target_type: "sales_order",
      target_id: id,
      before,
      after: updated,
      request_id,
    });
    events.emit("order.updated", { brand, order_id: id });
    return updated;
  });
}

async function setDeliveryFee({ brand, user, request_id, id, fee_ngn }) {
  return transaction(async (client) => {
    const before = await repo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("Order");
    if (["cancelled", "refunded"].includes(before.status)) {
      throw new AppError(
        "INVALID_STATE",
        `Cannot update delivery fee on a ${before.status} order`,
        409,
      );
    }
    const updated = await repo.setDeliveryFee({ client, brand, id, fee_ngn });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.delivery_fee_set",
      target_type: "sales_order",
      target_id: id,
      before: {
        shipping_fee_ngn: before.shipping_fee_ngn,
        total_ngn: before.total_ngn,
      },
      after: {
        shipping_fee_ngn: updated.shipping_fee_ngn,
        total_ngn: updated.total_ngn,
      },
      request_id,
    });
    events.emit("order.updated", { brand, order_id: id });
    return updated;
  });
}

async function addPayment({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const order = await repo.findById({ client, brand, id });
    if (!order) throw new NotFoundError("Order");
    if (["cancelled", "refunded"].includes(order.status))
      throw new AppError(
        "INVALID_STATE",
        `Cannot pay a ${order.status} order`,
        409,
      );

    // ── Gateway-only enforcement ────────────────────────────────
    // Non-negotiable: stock can never leave without a verified payment-
    // gateway webhook (Paystack / Opay / Nomba / Stripe). Staff-recorded
    // and POS-originated payments are blocked at the service layer as
    // defense-in-depth (the validator also blocks them at the HTTP edge).
    if (input.payment_path !== "gateway") {
      throw new AppError(
        "PAYMENT_PATH_BLOCKED",
        "Payments may only be recorded through an authorized payment gateway. Manual payment entry is disabled.",
        403,
      );
    }

    const payment_number = await repo.nextNumber({
      client,
      brand,
      type: "sales_order_payment",
    });
    const paymentRow = await repo.addPayment({
      client,
      brand,
      payment: {
        payment_number,
        order_id: id,
        method: input.method,
        provider: input.provider,
        provider_reference: input.provider_reference,
        amount_ngn: input.amount_ngn,
        paid_currency: input.paid_currency || null,
        paid_amount: input.paid_amount || null,
        fx_rate_used: input.fx_rate_used || null,
        fee_ngn: input.fee_ngn || 0,
        payment_path: input.payment_path,
        client_idempotency_key: input.client_idempotency_key,
        status: "captured",
        captured_at: new Date().toISOString(),
      },
    });

    // P1-2: a re-delivered webhook or a retried request resolves to the same
    // (provider, provider_reference) / (order_id, client_idempotency_key) row
    // instead of inserting a duplicate (see sales.repo.addPayment). The fee/FX
    // journals and the paid-state transition already ran the first time this
    // payment was recorded — re-running them now would double-post. No-op.
    if (paymentRow._alreadyExisted) {
      logger.info(
        { brand, order_id: id, payment_id: paymentRow.payment_id },
        "addPayment: payment already recorded — idempotent no-op",
      );
      return repo.findById({ client, brand, id });
    }

    // Per-gateway processing fee (§6.6/§6.21): book the fee to the gateway's
    // dedicated 551x expense account, contra the same cash account the sale
    // journal debits — so cash nets to the actual settlement (net_received).
    const feeNgn = money(input.fee_ngn || 0);
    const feeAccount = gatewayFeeAccount(input.provider, input.paid_currency);
    if (feeNgn.gt(0) && feeAccount) {
      const accounting = require("../accounting/accounting.service");
      const feeStr = toCurrencyString(feeNgn);
      await accounting.postEntry({
        client,
        brand,
        user_id: user.user_id,
        entry: {
          source_type: "payment",
          source_table: "sales_order_payments",
          source_id: paymentRow.payment_id,
          reference: order.order_number,
          description: `${input.provider} processing fee — ${order.order_number}`,
          idempotency_key: `payment_fee:${paymentRow.payment_id}`,
        },
        lines: [
          {
            account_code: feeAccount,
            debit_ngn: feeStr,
            description: `${input.provider} processing fee`,
          },
          {
            account_code: "1100",
            credit_ngn: feeStr,
            description: `${input.provider} fee settled from cash`,
          },
        ],
      });
    }

    // Realised FX gain/loss (V2.2 §6.6): if the customer settled in a foreign
    // currency, the NGN actually received differs from the amount the order
    // booked at its captured rate. Post the variance to the realised FX
    // account, atomic with the payment.
    if (
      input.paid_currency &&
      input.paid_currency !== "NGN" &&
      input.paid_amount &&
      order.fx_rate_used
    ) {
      const accounting = require("../accounting/accounting.service");
      const bookedNgn = money(input.paid_amount).times(
        money(order.fx_rate_used),
      );
      const deltaNgn = money(input.amount_ngn).minus(bookedNgn);
      await accounting.postFxGainLoss({
        client,
        brand,
        delta_ngn: toCurrencyString(deltaNgn),
        reference: order.order_number,
        description: `Realised FX on ${order.order_number} (${input.paid_currency})`,
        source_id: order.order_id,
        user_id: user.user_id,
        idempotency_key: `fx_revaluation:${paymentRow.payment_id}`,
      });
    }

    // Trigger recomputed amount_paid_ngn; re-read.
    const updated = await repo.findById({ client, brand, id });
    let result = updated;
    if (
      !PAID_STATES.has(updated.status) &&
      money(updated.amount_paid_ngn).gte(money(updated.total_ngn))
    ) {
      result = await markPaid({
        client,
        brand,
        user,
        request_id,
        order: updated,
      });
    } else if (
      updated.payment_model === "deposit_triggered" &&
      !updated.deposit_met_at &&
      updated.required_deposit_ngn !== null &&
      updated.required_deposit_ngn !== undefined &&
      money(updated.amount_paid_ngn).gte(money(updated.required_deposit_ngn))
    ) {
      // Deposit cleared (V2.2 §6.2): unlock production now; the balance is
      // collected before dispatch via the normal full-payment path.
      const flipped = await repo.markDepositMet({ client, brand, id });
      if (flipped) {
        result = flipped;
        events.emit("order.deposit_met", {
          brand,
          order_id: id,
          contact_id: flipped.contact_id,
          required_deposit_ngn: flipped.required_deposit_ngn,
          amount_paid_ngn: flipped.amount_paid_ngn,
        });
        // Durable + post-commit (H-2): Service Jobs opens a styling job for the
        // committed order. Keeps the in-process emit for realtime.
        await outbox.enqueue(client, {
          business: brand,
          event_type: "order.deposit_met",
          payload: {
            brand,
            order_id: id,
            contact_id: flipped.contact_id,
            required_deposit_ngn: flipped.required_deposit_ngn,
            amount_paid_ngn: flipped.amount_paid_ngn,
          },
          dedup_key: `order.deposit_met:${id}`,
        });
      }
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.payment",
      target_type: "sales_order",
      target_id: id,
      after: { amount_ngn: input.amount_ngn, status: result.status },
      request_id,
    });
    events.emit("order.payment", {
      brand,
      order_id: id,
      status: result.status,
    });
    return result;
  });
}

async function markPaid({ client, brand, user, _request_id, order }) {
  const loc = await stockRepo.getDefaultLocation({ client, brand });
  if (!loc)
    throw new AppError(
      "NO_STOCK_LOCATION",
      "No active stock location to fulfil from",
      409,
    );

  for (const line of order.lines) {
    if (line.variant_id) {
      // Layaway held the unit on placement — release the reservation first
      // so the 'sale' deduction keeps reserved <= on_hand valid.
      if (order.payment_model === "layaway") {
        try {
          await stockService.releaseReservation({
            client,
            brand,
            variant_id: line.variant_id,
            location_id: loc.location_id,
            quantity: line.quantity,
            reference_id: order.order_id,
            user_id: user.user_id,
            reason: "layaway paid in full",
          });
        } catch (err) {
          logger.warn(
            { err, order_id: order.order_id, variant_id: line.variant_id },
            "layaway release on markPaid skipped",
          );
        }
      }
      // GAP-3: when styled_product_id is on the line, COGS = base cost + style addon
      let costForCogs = line.unit_cost_ngn;
      if (line.styled_product_id) {
        try {
          const spRow = await client.query(
            `SELECT style_addon_price_ngn FROM ${brand}.styled_products WHERE styled_product_id = $1`,
            [line.styled_product_id],
          );
          if (spRow.rows[0] && spRow.rows[0].style_addon_price_ngn) {
            costForCogs = String(
              Number(costForCogs || 0) +
                Number(spRow.rows[0].style_addon_price_ngn),
            );
          }
        } catch (err) {
          logger.warn(
            { err, styled_product_id: line.styled_product_id },
            "styled addon lookup skipped",
          );
        }
      }
      await stockService.deductForSale({
        client,
        brand,
        variant_id: line.variant_id,
        location_id: loc.location_id,
        quantity: line.quantity,
        reference_id: order.order_id,
        sales_channel: order.sales_channel,
        unit_cost_ngn: costForCogs,
        user_id: user.user_id,
      });
    }
  }
  if (order.sales_campaign_id) {
    // Sum only rows attributed to this campaign (source = 'campaign' or
    // 'quantity_rule') — coupon/points/bundle discounts must not inflate
    // the campaign's analytics figures.
    const campaignDiscountNgn = await repo.sumCampaignDiscount({
      client,
      brand,
      order_id: order.order_id,
      campaign_id: order.sales_campaign_id,
    });
    await discount.recordUsage({
      client,
      brand,
      campaign_id: order.sales_campaign_id,
      revenue_ngn: order.total_ngn,
      discount_ngn: campaignDiscountNgn,
    });
  }
  const paid = await repo.setStatus({
    client,
    brand,
    id: order.order_id,
    status: "paid",
  });
  // Cross-module fan-out (H-2): enqueue `order.paid` to the transactional
  // outbox atomically with this transaction. After COMMIT the worker's
  // dispatcher invokes every registered consumer (accounting GL, invoicing,
  // commission, logistics dispatch, retention loyalty/stars, notifications)
  // post-commit, idempotently, with retry. No pre-commit emit — consumers must
  // never act on an uncommitted order.
  await outbox.enqueue(client, {
    business: brand,
    event_type: "order.paid",
    payload: {
      brand,
      order_id: order.order_id,
      contact_id: order.contact_id,
      total_ngn: order.total_ngn,
      tax_amount_ngn: order.tax_amount_ngn,
      sales_campaign_id: order.sales_campaign_id,
      // Referral code captured at checkout (sales_orders.referral_code_used).
      // The retention subscriber auto-redeems it on full settlement (§6.23).
      referral_code: order.referral_code_used || null,
    },
    dedup_key: `order.paid:${order.order_id}`,
  });
  return paid;
}

/**
 * Subscription billing charge (W-C / §6.23.5): record a successful recurring
 * charge as a paid Sales order so subscription revenue resolves in Sales and
 * posts to the GL. A flat charge (no product lines); the wig fulfilment/
 * selection is handled separately. Idempotent on client_idempotency_key.
 */
async function recordSubscriptionCharge({
  brand,
  contact_id,
  amount_ngn,
  provider_reference,
  client_idempotency_key,
}) {
  if (client_idempotency_key) {
    const existingId = await repo.findByIdempotencyKey({
      brand,
      key: client_idempotency_key,
    });
    if (existingId) return repo.findById({ brand, id: existingId });
  }
  const amt = toCurrencyString(money(amount_ngn));
  return transaction(async (client) => {
    const order_number = await repo.nextNumber({
      client,
      brand,
      type: "sales_order",
    });
    const order = await repo.createOrder({
      client,
      brand,
      order: {
        order_number,
        contact_id,
        sales_channel: "subscription",
        order_type: "digital",
        status: "pending_payment",
        subtotal_ngn: amt,
        discount_amount_ngn: "0",
        tax_amount_ngn: "0",
        shipping_fee_ngn: "0",
        total_ngn: amt,
        payment_model: "full_payment_only",
        client_idempotency_key: client_idempotency_key || null,
      },
    });
    const payment_number = await repo.nextNumber({
      client,
      brand,
      type: "sales_order_payment",
    });
    await repo.addPayment({
      client,
      brand,
      payment: {
        payment_number,
        order_id: order.order_id,
        method: "subscription_recurring",
        provider: "paystack",
        provider_reference,
        amount_ngn: amt,
        payment_path: "gateway",
        client_idempotency_key: client_idempotency_key || null,
        status: "captured",
        captured_at: new Date().toISOString(),
      },
    });
    const full = await repo.findById({ client, brand, id: order.order_id });
    await markPaid({ client, brand, user: { user_id: null }, order: full });
    return repo.findById({ client, brand, id: order.order_id });
  });
}

async function cancelOrder({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const order = await repo.findById({ client, brand, id });
    if (!order) throw new NotFoundError("Order");
    if (PAID_STATES.has(order.status))
      throw new AppError(
        "INVALID_STATE",
        "Paid orders cannot be cancelled here (use refund)",
        409,
      );
    // Release any layaway hold so the units return to available stock.
    if (order.payment_model === "layaway") {
      const loc = await stockRepo.getDefaultLocation({ client, brand });
      if (loc) {
        for (const line of order.lines || []) {
          if (!line.variant_id) continue;
          try {
            await stockService.releaseReservation({
              client,
              brand,
              variant_id: line.variant_id,
              location_id: loc.location_id,
              quantity: line.quantity,
              reference_id: order.order_id,
              user_id: user.user_id,
              reason: "order cancelled",
            });
          } catch (err) {
            logger.warn(
              { err, order_id: id, variant_id: line.variant_id },
              "layaway release on cancel skipped",
            );
          }
        }
      }
    }
    const o = await repo.setStatus({ client, brand, id, status: "cancelled" });
    // Persist why/when when a reason is supplied (e.g. system auto-cancel of a
    // superseded duplicate) so the order detail explains the cancellation.
    if (reason) {
      await repo.setCancellationReason({ client, brand, id, reason });
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.cancel",
      target_type: "sales_order",
      target_id: id,
      request_id,
      metadata: reason ? { reason } : undefined,
    });
    events.emit("order.cancelled", {
      brand,
      order_id: id,
      reason: reason || null,
    });
    return o;
  });
}

// ── Quotations ───────────────────────────────────────────
async function buildQuotationLines({
  client,
  brand,
  lines,
  channel = "storefront",
}) {
  const cfg = await businessConfig.findByKey(brand);
  const defaultVat =
    cfg && cfg.vat_rate !== null && cfg.vat_rate !== undefined
      ? money(cfg.vat_rate)
      : money("0");
  let subtotal = money(0),
    discountTotal = money(0),
    taxTotal = money(0);
  const out = [];
  for (const [idx, li] of lines.entries()) {
    const ctx = await repo.variantContext({
      client,
      brand,
      variant_id: li.variant_id,
    });
    if (!ctx)
      throw new AppError(
        "REFERENCE_INVALID",
        `Variant ${li.variant_id} not found`,
        409,
      );
    const unit = money(
      li.unit_price_ngn !== undefined
        ? li.unit_price_ngn
        : (channelPrice(ctx, channel) ?? 0),
    );
    const lineDiscount = money(li.line_discount_ngn || 0);
    const taxable = ctx.taxable !== false;
    const rate = taxable
      ? ctx.product_vat !== null && ctx.product_vat !== undefined
        ? money(ctx.product_vat)
        : defaultVat
      : money(0);
    const base = unit.times(li.quantity).minus(lineDiscount);
    const tax = base.times(rate);
    subtotal = subtotal.plus(unit.times(li.quantity));
    discountTotal = discountTotal.plus(lineDiscount);
    taxTotal = taxTotal.plus(tax);
    out.push({
      product_id: ctx.product_id,
      variant_id: li.variant_id,
      product_name_snapshot: ctx.product_name,
      variant_label_snapshot: ctx.variant_name,
      sku_snapshot: ctx.sku,
      quantity: li.quantity,
      unit_price_ngn: toCurrencyString(unit),
      line_discount_ngn: toCurrencyString(lineDiscount),
      tax_rate: rate.toFixed(4),
      line_total_ngn: toCurrencyString(base.plus(tax)),
      display_order: idx,
      notes: li.notes,
    });
  }
  return { lines: out, subtotal, discountTotal, taxTotal };
}

function listQuotations({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listQuotations({ brand, filters, page, page_size, offset });
}
async function getQuotation({ brand, id }) {
  const q = await repo.findQuotationById({ brand, id });
  if (!q) throw new NotFoundError("Quotation");
  return q;
}
async function createQuotation({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const built = await buildQuotationLines({
      client,
      brand,
      lines: input.lines,
      channel: input.delivery_type,
    });
    const shipping = money(input.shipping_fee_ngn || 0);
    const total = built.subtotal
      .minus(built.discountTotal)
      .plus(built.taxTotal)
      .plus(shipping);
    const quotation_number = await repo.nextNumber({
      client,
      brand,
      type: "quotation",
    });
    const q = await repo.createQuotation({
      client,
      brand,
      user_id: user.user_id,
      quote: {
        quotation_number,
        deal_id: input.deal_id,
        contact_id: input.contact_id,
        status: "draft",
        subtotal_ngn: toCurrencyString(built.subtotal),
        discount_amount_ngn: toCurrencyString(built.discountTotal),
        tax_amount_ngn: toCurrencyString(built.taxTotal),
        shipping_fee_ngn: toCurrencyString(shipping),
        total_ngn: toCurrencyString(total),
        valid_until: input.valid_until,
        payment_terms: input.payment_terms,
        notes: input.notes,
        internal_notes: input.internal_notes,
        delivery_type: input.delivery_type,
        coupon_code: input.coupon_code,
      },
    });
    for (const lr of built.lines)
      await repo.insertQuotationLine({
        client,
        brand,
        line: { ...lr, quotation_id: q.quotation_id },
      });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.quotation.create",
      target_type: "quotation",
      target_id: q.quotation_id,
      after: { quotation_number },
      request_id,
    });
    events.emit("quotation.created", { brand, quotation_id: q.quotation_id });
    return repo.findQuotationById({ client, brand, id: q.quotation_id });
  });
}
async function sendQuotation({ brand, user, request_id, id, input = {} }) {
  const updated = await transaction(async (client) => {
    const q = await repo.findQuotationById({ client, brand, id });
    if (!q) throw new NotFoundError("Quotation");
    if (!["draft", "sent"].includes(q.status))
      throw new AppError(
        "INVALID_STATE",
        `Cannot send a '${q.status}' quotation`,
        409,
      );
    const u = await repo.setQuotationStatus({
      client,
      brand,
      id,
      status: "sent",
      extra: {
        sent_via: input.sent_via || "email",
        sent_at: new Date().toISOString(),
      },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.quotation.send",
      target_type: "quotation",
      target_id: id,
      after: { sent_via: input.sent_via },
      request_id,
    });
    events.emit("quotation.sent", { brand, quotation_id: id });
    return u;
  });
  // Best-effort: archive the quotation PDF in Documents (non-blocking; skipped
  // cleanly if PDF rendering is disabled).
  archiveQuotationPdf({ brand, user, id }).catch(() => {});
  return updated;
}

const QUOTATION_STATUS_LABEL = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  rejected: "Declined",
  expired: "Expired",
  converted: "Converted",
  cancelled: "Cancelled",
};

/** Map a quotation (+ lines + contact) → the brand-doc renderer shape. */
function buildQuotationDoc({ quotation, brandObj, copy, contact }) {
  const subtotal = Number(quotation.subtotal_ngn || 0);
  const discount = Number(quotation.discount_amount_ngn || 0);
  const tax = Number(quotation.tax_amount_ngn || 0);
  const base = subtotal - discount;
  const taxRate = tax > 0 && base > 0 ? tax / base : null;
  const first =
    String((contact && contact.display_name) || "")
      .trim()
      .split(/\s+/)[0] || "";
  const tokens = {
    first_name: first,
    brand_name: brandObj.brand_name,
    quotation_number: quotation.quotation_number || "",
    order_number: "",
    total: quotation.total_ngn,
  };
  const c = (copy.quotation && copy.quotation.pdf) || {};
  // Prefer the operator's own customer-facing terms/notes; fall back to copy.
  const noteText =
    [quotation.payment_terms, quotation.notes].filter(Boolean).join("\n\n") ||
    docCopy.fillTokens(c.note, tokens);

  return {
    status_label: QUOTATION_STATUS_LABEL[quotation.status] || quotation.status,
    status_tone: "due",
    from: {
      name: brandObj.brand_legal_name || brandObj.brand_name,
      address: brandObj.brand_address,
      phone: brandObj.brand_phone,
      email: brandObj.support_email,
    },
    bill_to: contact
      ? {
          name: contact.display_name,
          phone: contact.primary_phone,
          email: contact.email,
        }
      : null,
    meta: [
      ["Quote #", quotation.quotation_number],
      ["Issue date", _dayISO(quotation.created_at)],
      [
        "Valid until",
        quotation.valid_until ? _dayISO(quotation.valid_until) : "—",
      ],
    ],
    lines: (quotation.lines || []).map((l) => ({
      description:
        l.description ||
        [l.product_name_snapshot, l.variant_label_snapshot]
          .filter(Boolean)
          .join(" — "),
      quantity: l.quantity,
      unit_price_ngn: l.unit_price_ngn,
      line_total_ngn: l.line_total_ngn,
    })),
    subtotal_ngn: quotation.subtotal_ngn,
    discount_amount_ngn: quotation.discount_amount_ngn,
    shipping_fee_ngn: quotation.shipping_fee_ngn,
    tax_amount_ngn: quotation.tax_amount_ngn,
    tax_rate: taxRate,
    total_ngn: quotation.total_ngn,
    notes_label: c.note_label,
    notes: noteText,
    thanks: docCopy.fillTokens(c.message, tokens),
  };
}

/** Resolve brand identity + copy and render the quotation PDF into Documents. */
async function _renderQuotationPdf({ brand, user, id }) {
  const full = await repo.findQuotationById({ brand, id });
  if (!full) return null;
  const [tokens, copy, contactRows] = await Promise.all([
    emailRender.resolveBrandTokens(brand),
    docCopy.resolveCopy(brand),
    full.contact_id
      ? query(
          `SELECT display_name, primary_phone, email FROM shared.contacts WHERE contact_id = $1`,
          [full.contact_id],
        )
      : Promise.resolve({ rows: [] }),
  ]);
  const contact = contactRows.rows[0] || null;
  const brandObj = brandDocs.brandFromTokens(tokens);
  const html = brandDocs.quotationHtml(
    brandObj,
    buildQuotationDoc({ quotation: full, brandObj, copy, contact }),
  );
  return pdf.renderAndStore({
    brand,
    user_id: user ? user.user_id : null,
    html,
    title: `Quotation ${full.quotation_number || id}`,
    document_type: "quotation",
    reference_type: "quotation",
    reference_id: id,
    pdfOptions: brandDocs.PDF_OPTIONS,
  });
}

/** Render the quotation to PDF and register it in shared.documents. */
async function archiveQuotationPdf({ brand, user, id }) {
  await _renderQuotationPdf({ brand, user, id });
}

/** On-demand quotation PDF (route POST /quotations/:id/pdf). */
async function quotationPdf({ brand, user, id }) {
  const stored = await _renderQuotationPdf({ brand, user, id });
  if (!stored) throw new NotFoundError("Quotation");
  return stored;
}
async function decideQuotation({
  brand,
  user,
  request_id,
  id,
  decision,
  reason,
}) {
  const status = decision === "accept" ? "accepted" : "rejected";
  const extra =
    decision === "accept"
      ? { accepted_at: new Date().toISOString() }
      : {
          rejected_at: new Date().toISOString(),
          rejection_reason: reason || null,
        };
  const updated = await repo.setQuotationStatus({ brand, id, status, extra });
  if (!updated) throw new NotFoundError("Quotation");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: `sales.quotation.${decision}`,
    target_type: "quotation",
    target_id: id,
    after: { status },
    request_id,
  });
  return updated;
}
async function convertQuotation({ brand, user, request_id, id, input = {} }) {
  const q = await repo.findQuotationById({ brand, id });
  if (!q) throw new NotFoundError("Quotation");
  if (q.status === "converted")
    throw new AppError("INVALID_STATE", "Quotation already converted", 409);
  // Build a sales order from the quotation's lines.
  const order = await createOrder({
    brand,
    user,
    request_id,
    input: {
      contact_id: q.contact_id,
      sales_channel: input.sales_channel || "phone",
      order_type: q.delivery_type || "dispatch",
      lines: q.lines
        .filter((l) => l.variant_id)
        .map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
          unit_price_ngn: l.unit_price_ngn,
        })),
      shipping_fee_ngn: q.shipping_fee_ngn,
    },
  });
  await repo.setQuotationStatus({
    brand,
    id,
    status: "converted",
    extra: { converted_sales_order_id: order.order_id },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "sales.quotation.convert",
    target_type: "quotation",
    target_id: id,
    after: { order_id: order.order_id },
    request_id,
  });
  events.emit("quotation.converted", {
    brand,
    quotation_id: id,
    order_id: order.order_id,
  });
  return order;
}

// ── Cancellation requests (§6.4 cancellation timer) ──────
function listCancellations({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listCancellations({ brand, filters, page, page_size, offset });
}
async function getCancellation({ brand, id }) {
  const c = await repo.findCancellationById({ brand, id });
  if (!c) throw new NotFoundError("Cancellation request");
  return c;
}
async function requestCancellation({
  brand,
  user,
  request_id,
  order_id,
  input,
}) {
  return transaction(async (client) => {
    const order = await repo.findById({ client, brand, id: order_id });
    if (!order) throw new NotFoundError("Order");
    if (
      ["cancelled", "refunded", "delivered", "completed"].includes(order.status)
    ) {
      throw new AppError(
        "INVALID_STATE",
        `Cannot cancel a '${order.status}' order`,
        409,
      );
    }
    const cfg = await businessConfig.findByKey(brand);
    const cs = (cfg && cfg.cancellation_settings) || {};
    const freeHours = Number(cs.free_window_hours ?? 3);
    const restockPct = Number(cs.restocking_fee_pct ?? 10);
    const customPct = Number(cs.custom_order_non_refundable_pct ?? 50);
    const freeUntil = new Date(
      new Date(order.created_at).getTime() + freeHours * 3600_000,
    );
    const withinFree = new Date() < freeUntil;
    const isCustom = order.is_custom_order === true;
    const feePct = withinFree ? 0 : isCustom ? customPct : restockPct;
    const total = money(order.total_ngn);
    const fee = total.times(money(feePct).dividedBy(100));
    const refund = total.minus(fee);
    const request_number = await repo.nextNumber({
      client,
      brand,
      type: "cancellation_request",
    });
    const cr = await repo.createCancellation({
      client,
      brand,
      row: {
        request_number,
        order_id,
        requested_by_contact_id: input.requested_by_contact_id,
        requested_by_user_id: user.user_id,
        reason: input.reason,
        reason_category: input.reason_category,
        within_free_window: withinFree,
        order_total_ngn: toCurrencyString(total),
        is_custom_order: isCustom,
        applicable_fee_pct: feePct,
        fee_amount_ngn: toCurrencyString(fee),
        refund_amount_ngn: toCurrencyString(refund),
      },
    });
    await repo.setStatus({
      client,
      brand,
      id: order_id,
      status: "cancellation_requested",
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.cancellation.request",
      target_type: "cancellation_request",
      target_id: cr.request_id,
      after: { fee_pct: feePct, refund: toCurrencyString(refund) },
      request_id,
    });
    events.emit("cancellation.requested", {
      brand,
      order_id,
      request_id: cr.request_id,
    });
    return cr;
  });
}
async function reviewCancellation({
  brand,
  user,
  request_id,
  id,
  decision,
  notes,
}) {
  return transaction(async (client) => {
    const cr = await repo.findCancellationById({ client, brand, id });
    if (!cr) throw new NotFoundError("Cancellation request");
    if (cr.status !== "pending_review")
      throw new AppError("INVALID_STATE", `Already ${cr.status}`, 409);
    const status = decision === "approve" ? "approved" : "rejected";
    const updated = await repo.setCancellationStatus({
      client,
      brand,
      id,
      status,
      reviewer: user.user_id,
      notes,
    });
    if (decision === "approve") {
      await repo.setStatus({
        client,
        brand,
        id: cr.order_id,
        status: "cancelled",
      });
    } else {
      // Reverting: put the order back to pending_payment so it can proceed.
      await repo.setStatus({
        client,
        brand,
        id: cr.order_id,
        status: "pending_payment",
      });
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: `sales.cancellation.${decision}`,
      target_type: "cancellation_request",
      target_id: id,
      after: { status },
      request_id,
    });
    events.emit("cancellation.reviewed", { brand, request_id: id, status });
    return updated;
  });
}

/**
 * Sales Report export (V2.2 §6.2) — period-scoped, styled .xlsx.
 *
 * Resolves the chosen period into UTC bounds (interpreted in the business
 * timezone so "pick a month" matches Nigerian business days), pulls the
 * orders / lines / payments for the window, builds the workbook, and audits
 * the export (RBAC 'export' action). Read-only: never mutates order data.
 *
 * `from`/`to` are 'YYYY-MM-DD' (inclusive). Either may be omitted — omitting
 * both exports every order for the brand (useful for a full archival capture).
 */
async function exportSalesReport({ brand, user, request_id, filters = {} }) {
  const { from, to, status, sales_channel } = filters;
  // Inclusive day bounds in the business timezone → precise UTC for the query.
  const fromTs = from ? toUtc(`${from}T00:00:00.000`) : null;
  const toTs = to ? toUtc(`${to}T23:59:59.999`) : null;
  const repoFilters = { from: fromTs, to: toTs, status, sales_channel };

  const [orders, lines, payments, config] = await Promise.all([
    repo.reportOrders({ brand, filters: repoFilters }),
    repo.reportLines({ brand, filters: repoFilters }),
    repo.reportPayments({ brand, filters: repoFilters }),
    businessConfig.findByKey(brand).catch(() => null),
  ]);

  const buffer = await salesReportExport.buildWorkbook({
    brandLabel: (config && config.display_name) || brand,
    fromLabel: from || "Beginning",
    toLabel: to || "Today",
    generatedAt: formatTz(new Date(), "yyyy-MM-dd HH:mm zzz"),
    generatedBy: user ? user.display_name || user.email || null : null,
    orders,
    lines,
    payments,
  });

  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "sales.report.export",
    target_type: "sales_report",
    target_id: null,
    after: {
      from: from || null,
      to: to || null,
      status: status || null,
      sales_channel: sales_channel || null,
      order_count: orders.length,
    },
    request_id,
  });

  const stamp = `${from || "all"}_${to || "all"}`.replace(
    /[^0-9A-Za-z_-]/g,
    "",
  );
  const safeBrand = String((config && config.display_name) || brand)
    .replace(/[^0-9A-Za-z]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return {
    buffer,
    filename: `sales-report-${safeBrand}-${stamp}.xlsx`,
    order_count: orders.length,
  };
}

const PROVIDER_LABEL = {
  paystack: "Paystack",
  opay: "OPay",
  nomba: "Nomba",
  stripe: "Stripe",
  manual: "Manual",
};

/** Human "Paystack — card" style label from a payment row. */
function paymentMethodLabel(p) {
  if (!p) return null;
  const provider =
    PROVIDER_LABEL[p.provider] || (p.provider ? String(p.provider) : null);
  const m = String(p.method || "").toLowerCase();
  let kind = null;
  if (m.includes("card")) kind = "card";
  else if (m.includes("transfer")) kind = "transfer";
  else if (m.includes("ussd")) kind = "USSD";
  else if (m.includes("terminal")) kind = "terminal";
  else if (m.includes("online")) kind = "online";
  return [provider, kind].filter(Boolean).join(" — ") || provider || "Card";
}

const _dayISO = (v) => (v ? String(v).slice(0, 10) : "");

/**
 * Map a paid sales order (header + lines + payments + contact) → the normalised
 * document the brand-doc renderer expects. Receipts always carry the PAID stamp
 * and every money line (discount/delivery/VAT) prints with the real columns.
 */
function buildReceiptDoc({ order, brandObj, copy }) {
  const payments = Array.isArray(order.payments) ? order.payments : [];
  const lastPayment = payments[payments.length - 1] || null;
  const subtotal = Number(order.subtotal_ngn || 0);
  const discount = Number(order.discount_amount_ngn || 0);
  const tax = Number(order.tax_amount_ngn || 0);
  const base = subtotal - discount;
  const taxRate = tax > 0 && base > 0 ? tax / base : null;

  const first =
    String(order.contact_name || "")
      .trim()
      .split(/\s+/)[0] || "";
  const tokens = {
    first_name: first,
    brand_name: brandObj.brand_name,
    receipt_number: "",
    order_number: order.order_number || "",
    total: order.total_ngn,
  };
  const c = (copy.receipt && copy.receipt.pdf) || {};

  return {
    status_label: "Paid",
    status_tone: "paid",
    watermark: "Paid",
    watermark_tone: "paid",
    from: {
      name: brandObj.brand_legal_name || brandObj.brand_name,
      address: brandObj.brand_address,
      phone: brandObj.brand_phone,
      email: brandObj.support_email,
    },
    bill_to: {
      name: order.contact_name,
      phone: order.contact_phone,
      email: order.contact_email,
    },
    meta: [
      ["Order #", order.order_number],
      [
        "Paid on",
        _dayISO(
          order.paid_at ||
            (lastPayment &&
              (lastPayment.captured_at || lastPayment.recorded_at)) ||
            order.created_at,
        ),
      ],
      ["Method", paymentMethodLabel(lastPayment) || "—"],
    ],
    lines: (order.lines || []).map((l) => ({
      description:
        [l.product_name_snapshot, l.variant_label_snapshot]
          .filter(Boolean)
          .join(" — ") || l.product_name_snapshot,
      quantity: l.quantity,
      unit_price_ngn: l.unit_price_ngn,
      line_total_ngn: l.line_total_ngn,
    })),
    subtotal_ngn: order.subtotal_ngn,
    discount_amount_ngn: order.discount_amount_ngn,
    shipping_fee_ngn: order.shipping_fee_ngn,
    tax_amount_ngn: order.tax_amount_ngn,
    tax_rate: taxRate,
    total_ngn: order.total_ngn,
    notes_label: c.note_label,
    notes: docCopy.fillTokens(c.note, tokens),
    thanks: docCopy.fillTokens(c.message, tokens),
  };
}

/** Render a paid order to a receipt PDF and persist it via Documents (4.2).
 *  Brand-driven (logo/accent/copy from each brand's config + Settings). */
async function receiptPdf({ brand, user, id }) {
  const order = await getById({ brand, id });
  if (!order) throw new NotFoundError("Order");
  const [tokens, copy] = await Promise.all([
    emailRender.resolveBrandTokens(brand),
    docCopy.resolveCopy(brand),
  ]);
  const brandObj = brandDocs.brandFromTokens(tokens);
  const html = brandDocs.receiptHtml(
    brandObj,
    buildReceiptDoc({ order, brandObj, copy }),
  );
  return pdf.renderAndStore({
    brand,
    user_id: user ? user.user_id : null,
    html,
    title: `Receipt ${order.order_number || order.order_id || id}`,
    document_type: "receipt",
    reference_type: "sales_order",
    reference_id: order.order_id || id,
    pdfOptions: brandDocs.PDF_OPTIONS,
  });
}

/**
 * Auto-archive the receipt PDF for a paid order (order.paid subscriber).
 * Idempotent — skips if a receipt document already exists for this order.
 * Best-effort: never throws (a render hiccup must not fail the order.paid row).
 */
async function archiveReceiptPdf({ brand, order_id }) {
  try {
    const documents = require("../../shared/documents/documents.service");
    const existing = await documents.listForReference({
      brand,
      reference_type: "sales_order",
      reference_id: order_id,
    });
    if ((existing || []).some((d) => d.document_type === "receipt")) return;
    await receiptPdf({ brand, user: null, id: order_id });
  } catch (err) {
    logger.warn(
      { err: err.message, brand, order_id },
      "auto receipt archive failed — check PDF rendering (PDF_ENABLED / Chromium)",
    );
  }
}

module.exports = {
  listOrders,
  getById,
  receiptPdf,
  archiveReceiptPdf,
  exportSalesReport,
  createOrder,
  updateOrder,
  addPayment,
  recordSubscriptionCharge,
  cancelOrder, // orders are cancelled (the 'archive' equivalent), never hard-deleted
  listQuotations,
  getQuotation,
  quotationPdf,
  createQuotation,
  sendQuotation,
  decideQuotation,
  convertQuotation,
  listCancellations,
  getCancellation,
  requestCancellation,
  reviewCancellation,
  setDeliveryFee,
};
