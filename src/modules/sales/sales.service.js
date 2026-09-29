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
 * addPayment (partial):    the FIRST payment of any size also commits the
 *   order to production — draws its stock as a real sale (drawStockForOrder,
 *   the same engine markPaid uses) and emits `order.deposit_met` so the
 *   Stylist Studio opens its job, without waiting for the balance to clear.
 *   A stock shortfall at either crossing flags the line as a formal
 *   pre-order rather than blocking the payment.
 */

"use strict";

const repo = require("./sales.repo");
const events = require("./sales.events");
const outbox = require("../../shared/outbox/outbox");
const discount = require("../sales_campaigns/campaigns.discount.service");
const couponService = require("../retention/coupon.service");
const couponRepo = require("../retention/coupon.repo");
const retentionRepo = require("../retention/retention.repo");
const referralConfigRepo = require("../retention/referral-config.repo");
const bundleRepo = require("../retention/bundle.repo");
const bundleService = require("../retention/bundle.service");
const campaignsRepo = require("../sales_campaigns/campaigns.repo");
const campaignsService = require("../sales_campaigns/campaigns.service");
const pdf = require("../../services/pdf.service");
const brandDocs = require("../../services/pdf.brand-docs");
const { formatDate } = require("../../utils/dates");
const docCopy = require("../../services/document-copy");
const emailRender = require("../email_campaigns/email-render");
const stockService = require("../stock/stock.service");
const stockRepo = require("../stock/stock.repo");
const serviceJobsRepo = require("../service_jobs/service-jobs.repo");
const rewigService = require("../catalogue/rewig.service");
const careGate = require("../catalogue/care-accessories.gate");
const businessConfig = require("../business_setup/business-config.repo");
const paymentSettings = require("./payment-settings.service");
const salesReportExport = require("./sales-report.export");
const { audit } = require("../../middleware/audit");
const { transaction, query, withSavepoint } = require("../../config/database");
const timelineRepo = require("./timeline.repo");
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
const { REVENUE_STATES } = require("./order-status");
const orderReadiness = require("./order-readiness");

// Fully-settled states: an order can only reach any of these once it was paid
// in full, so they gate "don't re-run markPaid / don't cancel here / don't send
// a part-payment receipt". SSOT lives in order-status.js.
const PAID_STATES = new Set(REVENUE_STATES);

// GL account codes resolved through the accounting posting map — the SSOT
// for all journal account codes (V2.2 §6.6, ratified policy Q4/Q7/Q8).
const {
  ACCOUNTS,
  gatewayFeeAccount,
  settlementAccountForProvider,
} = require("../accounting/posting-map");
const salesPostings = require("./sales.postings");
const paidCurrency = require("./paid-currency");

// A payment that takes an order more than this above its total raises
// order.overpaid (kobo-level noise never does).
const OVERPAYMENT_ALERT_FLOOR_NGN = "1.00";

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

/**
 * Rewig adjacency (000088) donor lookup for a stock-short order line.
 *
 * The decision itself lives in rewig.service (shared with the Change Order
 * reconciler, which needs the same answer for the same question); this is the
 * placement-time call site. Delegating rather than keeping a second copy here
 * is deliberate — two implementations of "which sibling size may this line be
 * filled from" is exactly the drift the shared module exists to prevent.
 */
function resolveRewigDonor({ client, brand, line, location_id }) {
  return rewigService.resolveDonorVariant({
    client,
    brand,
    line,
    quantity: line.quantity,
    location_id,
  });
}

async function createOrderTx({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const cfg = await businessConfig.findByKey(brand);
    if (!cfg) {
      throw new AppError(
        "BUSINESS_CONFIG_MISSING",
        `Business configuration not found for brand "${brand}"`,
        500,
        // AppError's 4th arg is an options object; a bare string here was
        // silently discarded and the internal message leaked to the client.
        { user_message: "System configuration error — please contact support" },
      );
    }
    // VAT rate is read from business_config as SSOT. The DB guarantees a row
    // exists (migration 000239 set DEFAULT 0) so cfg.vat_rate is always present.
    // No JS-level fallback: if vat_rate is 0 we apply 0; if it is ever changed
    // in settings that change takes effect here immediately.
    const defaultVat = money(cfg.vat_rate);

    // 1. Resolve line pricing context + base unit prices. Variant contexts
    //    come from ONE batch query — the old per-line lookup cost an N-line
    //    order N sequential round-trips inside the write transaction.
    //    Service lines (rare) stay individual. Lines are still walked in
    //    order, so a missing reference throws for the FIRST bad line exactly
    //    as before.
    const variantCtxById = await repo.variantContexts({
      client,
      brand,
      variant_ids: input.lines.map((li) => li.variant_id),
    });
    const built = [];
    for (const li of input.lines) {
      // A line is EITHER a product variant or a service offering (PR3). A
      // service ctx has null product_id/min_price/cost, so the campaign,
      // margin-floor, stock and COGS steps below all skip it naturally.
      let ctx;
      if (!li.variant_id && li.service_offering_id) {
        ctx = await repo.serviceOfferingContext({
          client,
          brand,
          service_id: li.service_offering_id,
        });
      } else {
        // Shallow copy so duplicate-variant lines never share one ctx object.
        const row = variantCtxById.get(li.variant_id);
        ctx = row ? { ...row } : null;
      }
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

    // ── Care & Accessories gate (PR 2) ──────────────────────
    // EVERY channel converges on createOrder, so this is the one place retail
    // lines are authorised for the whole system: PXG gate on, published,
    // undeleted, exact variant active. Retail-only orders pay IN FULL — the
    // instalment plan is an order-wide wig policy and never applies to a
    // care-only basket (mixed baskets keep the existing order-wide plan).
    const hasRetailLine = built.some(
      (b) => b.ctx.catalogue_role === "retail",
    );
    if (hasRetailLine) {
      await careGate.requireEnabled(brand); // 404 when gated off or non-PXG
      for (const b of built) {
        const c = b.ctx;
        if (c.catalogue_role !== "retail") continue;
        if (
          c.product_deleted ||
          c.retail_status !== "live" ||
          c.variant_active === false
        )
          throw new AppError(
            "REFERENCE_INVALID",
            `Care & Accessories SKU is not currently sellable (variant ${b.li.variant_id})`,
            409,
            {
              user_message:
                "One of your items is no longer available. Please remove it and try again.",
            },
          );
      }
    }
    const retailOnlyOrder =
      hasRetailLine &&
      built.length > 0 &&
      built.every((b) => b.ctx.catalogue_role === "retail");
    if (retailOnlyOrder) {
      if (input.payment_plan === "instalment")
        throw new AppError(
          "RETAIL_FULL_PAYMENT_REQUIRED",
          "Care-only orders are paid in full",
          409,
          {
            user_message:
              "Care & Accessories orders are paid in full. The instalment plan applies to wig orders.",
          },
        );
      if (input.is_custom_order)
        throw new AppError(
          "RETAIL_NOT_CUSTOM",
          "Care items are stock orders, never custom production",
          422,
        );
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
        // P1-5: lock the state row for the duration of the tx so two
        // concurrent orders can't both pass the balance check. The actual
        // ledger debit is deferred to order.paid (P1-3), but the CHECK
        // constraint (000353) plus this lock make the "insufficient
        // points" gate race-free.
        const state = await retentionRepo.getLoyaltyStateForUpdate({
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
    // 3.9 Customer referral (P0-3): a friend's order gets the discount
    // configured in referral_program_settings (percentage or fixed). Floor-
    // respecting — same allocator as coupons/points/bundles — so we never
    // sell below the variant min_price. Runs before the campaign_deal step
    // (floor-free) so the referral saving is bounded by real margin.
    //
    // Guarding: only apply when the code resolves in THIS brand, the
    // programme is active, the buyer isn't self-referring, and the config
    // has a non-zero discount. The redemption ledger + counter bumps still
    // happen in retention.subscribers on order.paid (see redeemReferral) —
    // this stage only applies the discount and stamps referral_code_used.
    let referralMeta = null;
    let referralLineTotal = money(0);
    if (input.customer_referral_code && input.contact_id) {
      const codeNorm = String(input.customer_referral_code).trim();
      if (codeNorm) {
        const ref = await retentionRepo.findReferralByCode({
          client,
          code: codeNorm,
          brand,
        });
        const settings = await referralConfigRepo
          .getSettings({ client, brand })
          .catch(() => null);
        const programmeOn = !settings || settings.is_active !== false;
        const notSelf = ref && ref.contact_id !== input.contact_id;
        const hasDiscount =
          settings &&
          settings.friend_discount_type &&
          settings.friend_discount_value != null &&
          Number(settings.friend_discount_value) > 0;
        if (ref && programmeOn && notSelf && hasDiscount) {
          const preTotalNow = preNet.reduce(
            (s, n) => s.plus(n),
            money(0),
          );
          const raw =
            settings.friend_discount_type === "percentage"
              ? preTotalNow.times(money(settings.friend_discount_value))
              : money(settings.friend_discount_value);
          if (raw.gt(money(0))) {
            referralLineTotal = applyOrderDiscount(raw);
            if (referralLineTotal.gt(money(0))) {
              referralMeta = {
                code: codeNorm,
                referrer_contact_id: ref.contact_id,
                discount_ngn: toCurrencyString(referralLineTotal),
              };
            }
          }
        }
      }
    }

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

    // 4b. Payment plan + deposit policy (V2.2 §6.2, Flexi Pay D1/D6) —
    // config-driven via pricing/totals.js. The buyer's explicit plan choice
    // is validated against the Sales → Payments configuration first.
    const installmentSettings = paymentSettings.withDefaults(
      (cfg && cfg.installment_settings) || {},
    );
    if (input.payment_plan === "instalment") {
      if (installmentSettings.channels[input.sales_channel] === false) {
        throw new AppError(
          "INSTALMENT_NOT_AVAILABLE",
          `Instalment plan is not offered on the ${input.sales_channel} channel`,
          409,
          {
            user_message: `${installmentSettings.plan_display_name} is not available for this order.`,
          },
        );
      }
      // Campaigns gate instalments per sale (D7): the campaign builder toggle
      // must be on for THIS campaign.
      if (input.sales_channel === "sales_campaign") {
        const campRow = input.sales_campaign_id
          ? await campaignsRepo.findById({
              client,
              brand,
              id: input.sales_campaign_id,
            })
          : input.campaign_slug
            ? await campaignsRepo.findBySlug({
                client,
                brand,
                slug: input.campaign_slug,
              })
            : null;
        if (!campRow || campRow.allow_instalments !== true) {
          throw new AppError(
            "INSTALMENT_NOT_AVAILABLE",
            "This campaign does not offer the instalment plan",
            409,
            {
              user_message: `${installmentSettings.plan_display_name} is not available on this sale.`,
            },
          );
        }
      }
    }
    const { paymentPlan, paymentModel, requiredDepositPct, requiredDepositNgn } =
      computeDepositPolicy({
        installmentSettings,
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
        // Back-pointer to the quote this order came from (convertQuotation
        // passes it). Lets an order answer "which quote produced me?" without
        // scanning quotations.converted_sales_order_id.
        quotation_id: input.quotation_id || null,
        client_idempotency_key: input.client_idempotency_key || null,
        stylist_referral_code: input.stylist_referral_code || null,
        // Staff attribution (Performance → Insights). The caller decides:
        // Quick Sale defaults it to the acting staff (set in the controller),
        // a catalogue-share checkout passes the link's sharer, and customer
        // self-service (storefront cart) leaves it null → counts toward the
        // company total but credited to no individual on the leaderboard.
        closed_by_user_id: input.closed_by_user_id || null,
        // P0-3: stamp the CUSTOMER referral code that actually applied so
        // the order.paid outbox handler can credit the referrer's points
        // and post the store-credit reward (see retention.subscribers).
        // Distinct from stylist_referral_code (§6.26 stylist rail).
        referral_code_used: referralMeta ? referralMeta.code : null,
        specific_instructions: (input.specific_instructions && String(input.specific_instructions).trim()) ? String(input.specific_instructions).trim().slice(0,2000) : null,
        payment_plan: paymentPlan,
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

    const insertedLines = [];
    for (const lr of lineRows) {
      // Strip the internal helper field before persisting — it is not a DB column.
      const { _campaign_resolve_discount_ngn, ...lineForDb } = lr;
      const line = await repo.insertLine({
        client,
        brand,
        line: { ...lineForDb, order_id: order.order_id },
      });
      insertedLines.push(line);
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

    // 5a. Record the coupon discount IN Sales (audit trail on the order —
    // must be immediate so invoices/totals reconcile). P1-3: the
    // coupon_redemptions row + coupons.total_redeemed bump used to happen
    // here too, which meant an abandoned checkout burned the buyer's
    // per_customer_limit for good. Both effects now defer to the
    // order.paid outbox handler (retention.subscribers.settleAfterPaid),
    // and the cancellation handler reverses them for a paid-then-cancelled
    // order.
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

    // 5a-ii. Record loyalty points redemption IN Sales (§6.23.3): the
    // sales_order_discounts row stays here so the order's discount
    // breakdown is complete + reconciled with total_ngn. P1-3: the actual
    // ledger debit (which burns the customer's balance) defers to the
    // order.paid handler so an abandoned checkout doesn't lose them their
    // points; the cancellation handler reverses it for a paid-then-
    // cancelled order.
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

    // 5a-iii-b. Record the customer referral (friend) discount IN Sales
    // (P0-3). This is the discount that just applied above — the redemption
    // ledger row + referrer counter bump land later on order.paid via
    // retention.subscribers.redeemReferral (already stamped as
    // referral_code_used on the order row above).
    if (referralMeta && referralLineTotal.gt(money(0))) {
      const settings = await referralConfigRepo
        .getSettings({ client, brand })
        .catch(() => null);
      await repo.insertDiscount({
        client,
        brand,
        disc: {
          order_id: order.order_id,
          source: "referral",
          source_reference: referralMeta.code,
          amount_ngn: toCurrencyString(referralLineTotal),
          discount_type:
            settings && settings.friend_discount_type === "percentage"
              ? "percentage"
              : "fixed",
        },
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

    // 5b. Stock is reserved at placement for EVERY order (Flexi Pay D8) —
    // full-plan orders hold their units through the payment window (the
    // abandoned-checkout sweep releases them if the buyer never pays), and
    // instalment orders hold them for the life of the plan.
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
    //
    // Universal pre-orders (000086): a stock-short line is recorded as a
    // PRE-ORDER and the buyer is told it ships on the production window
    // (Catalogue → Config, default 4–8 weeks). The only time a stock-short line
    // BLOCKS the sale is when pre-orders are switched off for the brand, or that
    // specific product is opted out (preorder_excluded) — a genuine "sold out".
    const preorderPolicy = await repo.getPreorderPolicy({ client, brand });
    const excludedPreorder = await repo.excludedPreorderProductIds({
      client,
      brand,
      product_ids: insertedLines.map((l) => l.product_id),
    });
    // Cross-channel decision (000086, gap-8): this guard is the ONE authority on
    // whether an out-of-stock line may pre-order, and it applies to EVERY channel
    // — storefront, order-links, quick-sale AND sales-campaigns — with no
    // exceptions. `preorder_excluded` is a deliberate per-product merchant opt-out
    // meaning "genuinely sold out when it hits zero — never back-order this", and
    // the brand master switch off means "this brand doesn't take pre-orders at
    // all". A campaign is just another sales channel; special-casing it to force a
    // pre-order would silently override the merchant's explicit intent and raise
    // an order they said should never exist. So we intentionally let createOrder
    // throw OUT_OF_STOCK for an excluded/switched-off product even inside a
    // campaign whose landing page shows "SOLD OUT — PRE-ORDER OPEN" (a display
    // built from the campaign's own preorder_enabled flag). With the default
    // switch ON and products NOT excluded — the overwhelmingly common case —
    // campaigns pre-order exactly like every other channel; the only divergence is
    // the deliberately-excluded edge, where OUT_OF_STOCK is the CORRECT outcome and
    // the campaign's badge is what should be corrected, not this backstop.
    const preorderAllowed = (line) =>
      preorderPolicy.enabled && !excludedPreorder.has(line.product_id);
    const blockSoldOut = (line) => {
      throw new AppError(
        "OUT_OF_STOCK",
        `stock short and pre-order unavailable (variant ${line.variant_id})`,
        409,
        {
          user_message: `${line.product_name_snapshot || "This item"} is out of stock.`,
        },
      );
    };
    const preorderLines = [];
    const rewigSubstitutions = [];
    {
      const loc = await stockRepo.getDefaultLocation({ client, brand });
      // One reserve attempt, isolated in its own savepoint so a failure leaves
      // the transaction healthy. Resolves to null on success, else the error.
      const tryReserve = async (variant_id, quantity) => {
        await client.query("SAVEPOINT pgh_reserve");
        try {
          await stockService.reserveForOrder({
            client,
            brand,
            variant_id,
            location_id: loc.location_id,
            quantity,
            reference_id: order.order_id,
            user_id: user.user_id,
          });
          await client.query("RELEASE SAVEPOINT pgh_reserve");
          return null;
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT pgh_reserve");
          await client.query("RELEASE SAVEPOINT pgh_reserve").catch(() => {});
          return err;
        }
      };

      for (const line of insertedLines) {
        if (!line.variant_id) continue;
        if (!loc) {
          if (!preorderAllowed(line)) blockSoldOut(line);
          preorderLines.push(line);
          logger.warn(
            { order_id: order.order_id, line_id: line.line_id },
            "no active stock location — line recorded as pre-order",
          );
          continue;
        }
        let err = await tryReserve(line.variant_id, line.quantity);
        if (!err) continue;

        // Rewig adjacency (000088) — the line's own base is short, so before
        // falling through to pre-order, try a size-adjacent sibling base that
        // can actually cover it at THIS location.
        //
        // This lives here, below every channel, on purpose. It used to sit only
        // in the three checkout callers (storefront, sales-campaigns, order
        // links), so Quick Sale and Quotations — which resolve a styled variant
        // to its base in the browser (apps/admin/src/lib/product-search.ts) and
        // post a bare variant_id — never consulted it at all, and pre-ordered
        // straight past a sibling sitting in stock. createOrder is the one point
        // every channel converges on, so putting the fallback here fixes those
        // paths and any channel added later. It is idempotent for the callers
        // that already resolved a donor: their reserve succeeds first try and
        // this block never runs.
        // Retail SKUs are stock-only: never resized from a sibling base.
        // (000094 already forbids them a size family; this is belt-and-braces.)
        const lineCtx = variantCtxById.get(line.variant_id);
        const donor =
          lineCtx && lineCtx.catalogue_role === "retail"
            ? null
            : await resolveRewigDonor({
                client,
                brand,
                line,
                location_id: loc.location_id,
              });
        if (donor) {
          const donorErr = await tryReserve(donor.variant_id, line.quantity);
          if (!donorErr) {
            const note = `Rewig substitution: fulfil from ${donor.product_name} (${donor.sku}) — resize to ${line.variant_label_snapshot || "the ordered size"}.`;
            await repo.repointLineVariant({
              client,
              brand,
              line_id: line.line_id,
              product_id: donor.product_id,
              variant_id: donor.variant_id,
              note,
            });
            // Keep the in-memory row in step: payment-time deductForSale reads
            // these same objects when the order is paid in the same request.
            line.product_id = donor.product_id;
            line.variant_id = donor.variant_id;
            rewigSubstitutions.push({
              line_id: line.line_id,
              from_variant_id: donor.origin_variant_id,
              to_variant_id: donor.variant_id,
              donor_sku: donor.sku,
              donor_product_name: donor.product_name,
            });
            logger.info(
              {
                order_id: order.order_id,
                line_id: line.line_id,
                donor_sku: donor.sku,
              },
              "rewig substitution — reserved from size-adjacent sibling base",
            );
            continue;
          }
          err = donorErr;
        }

        if (!preorderAllowed(line)) blockSoldOut(line);
        preorderLines.push(line);
        logger.info(
          {
            err: err.message,
            order_id: order.order_id,
            line_id: line.line_id,
            variant_id: line.variant_id,
            location_id: loc.location_id,
            quantity: line.quantity,
            rewig_donor_found: !!donor,
          },
          "stock short — line recorded as pre-order",
        );
      }
    }

    // Persist pre-order state (order + lines) so the Sales → Pre-orders tab,
    // the invoice and the confirmation email read it back. Deadline = placement
    // + the max production weeks. `preorderInfo` is also threaded to the caller.
    let preorderInfo = null;
    if (preorderLines.length) {
      const weeks = preorderPolicy.max_weeks || preorderPolicy.min_weeks || 0;
      const readyBy = weeks
        ? new Date(Date.now() + weeks * 7 * 86_400_000)
            .toISOString()
            .slice(0, 10)
        : null;
      const windowLabel =
        preorderPolicy.min_weeks &&
        preorderPolicy.max_weeks &&
        preorderPolicy.min_weeks !== preorderPolicy.max_weeks
          ? `${preorderPolicy.min_weeks}–${preorderPolicy.max_weeks} weeks`
          : `${weeks} week${weeks === 1 ? "" : "s"}`;
      await repo.markOrderPreorder({
        client,
        brand,
        order_id: order.order_id,
        ready_by: readyBy,
        min_weeks: preorderPolicy.min_weeks,
        max_weeks: preorderPolicy.max_weeks,
      });
      await repo.markLinesPreorder({
        client,
        brand,
        line_ids: preorderLines.map((l) => l.line_id),
      });
      preorderInfo = {
        is_preorder: true,
        line_count: preorderLines.length,
        variant_ids: preorderLines.map((l) => l.variant_id),
        names: preorderLines
          .map((l) => l.product_name_snapshot)
          .filter(Boolean),
        min_weeks: preorderPolicy.min_weeks,
        max_weeks: preorderPolicy.max_weeks,
        ready_by: readyBy,
        window_label: windowLabel,
        message: `Some items are made to order — your pre-order ships in about ${windowLabel}.`,
      };
      notices.push({ code: "PREORDER_ITEMS", message: preorderInfo.message });
    }

    // Rewig substitutions (000088): the customer's size is being cut from a
    // sibling unit, so the picklist and the stylist brief must say so — the
    // order line already carries the note, this surfaces it to the caller.
    if (rewigSubstitutions.length) {
      notices.push({
        code: "REWIG_SUBSTITUTION",
        message: `${rewigSubstitutions.length === 1 ? "One item" : `${rewigSubstitutions.length} items`} will be resized from an adjacent size in stock.`,
        details: rewigSubstitutions,
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
    // Durable placement event (H-2): the customer's order-confirmation message
    // fires HERE, at placement — so a Pending/Partially-Paid order is
    // acknowledged immediately, not only once it's fully paid. Post-commit,
    // idempotent (dedup on the order id). The paid-time receipt is a separate
    // message driven by order.paid → invoicing (receipt.sent).
    await outbox.enqueue(client, {
      business: brand,
      event_type: "order.created",
      payload: {
        brand,
        order_id: order.order_id,
        contact_id: order.contact_id,
      },
      dedup_key: `order.created:${order.order_id}`,
    });
    // Prepaid-only (owner directive): the business never ships pay-on-delivery,
    // so an unpaid order must NOT enter the logistics queue. The delivery is
    // created only once payment clears — logistics subscribes to `order.paid`
    // alone. (Previously we enqueued `order.confirmed` here to pre-queue a
    // dispatch; that path is intentionally removed.)

    // ── Care & Accessories delivery review (PR 3) ─────────────
    // A retail-containing DISPATCH order cannot have its delivery fee produced
    // by the zone rate card: that card prices by WIG quantity, so it would
    // charge several combs as several wigs, and the owner has not approved the
    // provisional initial-zone-fee assumption. So the order is queued for a
    // human the moment it is placed. Every channel converges on createOrder —
    // Quick Sale, quote conversion, the storefront cart, an /o order link — so
    // this is the one place the queue has to be fed.
    //
    // Inserting the review row is what raises `needs_delivery_review` (000096
    // trigger), and that durable flag is what blocks dispatch until a staff
    // member has agreed the fee, captured the customer's consent for any
    // increase, verified the top-up or refund, and reconciled the invoice,
    // payment link and ledger. A pickup/collection order carries no delivery
    // charge and is never queued. Wig-only and FLH orders never reach this
    // branch, so their shipping behaviour is unchanged byte-for-byte.
    //
    // This deliberately does NOT swallow failures: if the review cannot be
    // opened, the order must not be placed, because the alternative is a retail
    // delivery that can dispatch with nobody having priced it.
    if (hasRetailLine && (order.order_type || input.order_type) === "dispatch") {
      const deliveryReviewRepo = require("./delivery-review.repo");
      const alreadyQueued = await deliveryReviewRepo.findOpenByOrder({
        client,
        brand,
        order_id: order.order_id,
      });
      if (!alreadyQueued) {
        const opened = await deliveryReviewRepo.insertReview({
          client,
          brand,
          review: {
            order_id: order.order_id,
            status: "pending_review",
            initial_fee_ngn: toCurrencyString(shipping),
            calculation_basis: null,
            opened_by: user.user_id,
          },
        });
        await deliveryReviewRepo.addEvent({
          client,
          brand,
          event: {
            review_id: opened.review_id,
            order_id: order.order_id,
            event_type: "opened",
            to_status: "pending_review",
            amount_ngn: toCurrencyString(shipping),
            note:
              "Order contains Care & Accessories items — delivery fee queued for manual calculation and customer agreement before dispatch",
            actor_user_id: user.user_id,
            actor_name: user.full_name || user.email || null,
          },
        });
        notices.push({
          code: "DELIVERY_FEE_REVIEW",
          message:
            "EXTRA DELIVERY FEES MAY APPLY — this order's delivery fee is being calculated by our team and will be confirmed with you before it ships.",
        });
      }
    }

    const finalOrder = await repo.findById({
      client,
      brand,
      id: order.order_id,
    });
    // Thread soft notices + pre-order detail back to the caller (public
    // checkout) without persisting them on the row. Non-enumerable so they
    // never leak into JSON serialisation of the order itself.
    if (finalOrder && (notices.length || preorderInfo)) {
      Object.defineProperty(finalOrder, "_notices", {
        value: notices,
        enumerable: false,
      });
      Object.defineProperty(finalOrder, "_preorder", {
        value: preorderInfo || {
          is_preorder: false,
          line_count: 0,
          variant_ids: [],
          names: [],
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

/**
 * The Stylist Studio job opened for one order — read THROUGH the order and
 * scoped to the order itself, never to the caller's stylist own-scope. Anyone
 * who can view the order (sales.view) sees its studio progress. A salesperson
 * is never the assigned stylist, so the service_jobs module's own-scope would
 * otherwise (correctly) hide the job and the Order drawer would misreport
 * "Studio: not opened yet" for a wig that is in fact well into styling. Returns
 * 0-or-1 job as an array; the controller wraps it in a { data, meta } envelope
 * so the admin client preserves the shape (a bare { data } gets unwrapped past
 * the array).
 */
/**
 * The order's Stylist Studio jobs, plus how many of them are finished.
 *
 * ALL of them: an order can carry several hairs (one job each), and this used
 * to fetch page_size 1, so a three-wig order showed a single job on the order
 * screen and no hint that two more existed. The progress figures come from the
 * same predicate that gates the customer's "Order Ready" message, so what the
 * screen shows and what the system waits for cannot drift.
 */
async function getOrderServiceJob({ brand, id }) {
  const order = await repo.findById({ brand, id });
  if (!order) throw new NotFoundError("Order");
  const r = await serviceJobsRepo.listServiceJobs({
    brand,
    sales_order_id: id,
    page_size: 200,
  });
  const progress = await orderReadiness.studioProgress({
    brand,
    order_id: id,
  });
  return { jobs: r.data, progress };
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
    // Care & Accessories: the delivery-fee REVIEW is the only supported way to
    // change a retail delivery order's fee (consent, verified top-up/refund,
    // invoice + ledger reconciliation). This bare setter does none of that, so
    // it must not be a side door while a review is open — nor re-price an order
    // whose fee a review already agreed (open a new review instead).
    if (before.needs_delivery_review === true || before.delivery_review_settled_at) {
      throw new AppError(
        "DELIVERY_REVIEW_REQUIRED",
        "This order's delivery fee is managed by the Care & Accessories delivery-fee review",
        409,
        {
          user_message:
            "This order contains care products — change its delivery fee in Sales → Delivery Fee Review.",
        },
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

    // ── Payment-path enforcement ────────────────────────────────
    // Default rule: stock can never leave without a verified payment-gateway
    // webhook (Paystack / Opay / Nomba / Stripe). Two exceptions:
    //   • pay-on-delivery remittances — stock already left with the courier,
    //     and only logistics' remit flow (never HTTP input, the validator
    //     strips unknown fields) can set the internal flag;
    //   • staff-recorded bank transfers (Flexi Pay D13) — permitted ONLY when
    //     business_config.allow_staff_recorded_manual_payments is switched on
    //     (Sales → Payments tab), with a mandatory bank transaction reference
    //     (reconciled against the bank-statement import, §6.6) and the
    //     recording staff member stamped on the row.
    const isPodRemit =
      input._internal_pod_remit === true &&
      input.method === "pay_on_delivery";
    const isStaffRecorded = input.payment_path === "staff_recorded";
    if (isStaffRecorded) {
      const cfg = await businessConfig.findByKey(brand);
      if (!cfg || cfg.allow_staff_recorded_manual_payments !== true) {
        throw new AppError(
          "PAYMENT_PATH_BLOCKED",
          "Manual payment recording is disabled for this business. Enable it in Sales → Payments.",
          403,
        );
      }
      if (!input.manual_bank_transaction_id || !input.manual_bank_name) {
        throw new AppError(
          "MANUAL_REF_REQUIRED",
          "A bank transaction reference and bank name are required to record a manual payment",
          422,
        );
      }
      // Staff recording IS the initiation point, so the plan minimums apply
      // here (gateway payments are validated at link creation instead — money
      // a gateway already captured is never rejected).
      paymentSettings.assertPaymentAmountAllowed({
        settings: paymentSettings.withDefaults(cfg.installment_settings),
        order,
        amountNgn: input.amount_ngn,
      });
    } else if (input.payment_path !== "gateway" && !isPodRemit) {
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
        provider: isStaffRecorded ? "manual" : input.provider,
        // Manual payments dedupe on the bank's transaction reference — the
        // same UNIQUE (provider, provider_reference) backstop the gateways
        // use, so the same transfer can never be recorded twice.
        provider_reference: isStaffRecorded
          ? input.manual_bank_transaction_id
          : input.provider_reference,
        amount_ngn: input.amount_ngn,
        paid_currency: input.paid_currency || null,
        paid_amount: input.paid_amount || null,
        fx_rate_used: input.fx_rate_used || null,
        fee_ngn: input.fee_ngn || 0,
        payment_path: input.payment_path,
        manual_bank_transaction_id: isStaffRecorded
          ? input.manual_bank_transaction_id
          : undefined,
        manual_bank_name: isStaffRecorded ? input.manual_bank_name : undefined,
        manual_recorded_by: isStaffRecorded ? user.user_id : undefined,
        recorded_by: user.user_id || undefined,
        notes: input.notes || undefined,
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

    // Capture journal (policy Q4/Q7): DR the gateway's settlement float /
    // CR Customer Deposits 2400. The sale journal draws 2400 down by the
    // order total once fully paid, so partials/layaway/multi-gateway all
    // reconcile. POD remittances are excluded — logistics posts the COD
    // clearing journals (collect → 1610, remit → bank) itself.
    const accounting = require("../accounting/accounting.service");
    if (!isPodRemit) {
      await accounting.postEntry({
        client,
        brand,
        user_id: user.user_id,
        entry: {
          source_type: "payment",
          source_table: "sales_order_payments",
          source_id: paymentRow.payment_id,
          reference: order.order_number,
          description: `Payment captured — ${order.order_number}`,
          idempotency_key: `payment_capture:${paymentRow.payment_id}`,
        },
        lines: salesPostings.buildCaptureLines({
          amount_ngn: input.amount_ngn,
          // Manual bank transfers post as 'manual' → settlement falls back to
          // the main bank account, which is exactly where the money landed.
          provider: isStaffRecorded ? "manual" : input.provider,
          contact_id: order.contact_id,
          reference: order.order_number,
          // A USD Nomba capture lands in the USD wallet (1141), carrying the
          // dollars received; staff-recorded transfers are always Naira.
          paid_currency: isStaffRecorded ? null : input.paid_currency,
          paid_amount: isStaffRecorded ? null : input.paid_amount,
        }),
      });
    }

    // Per-gateway processing fee (§6.6/§6.21): book the fee to the gateway's
    // dedicated 551x expense account, contra the SAME settlement account the
    // capture debited — so the float nets to the actual payout amount.
    const feeNgn = money(input.fee_ngn || 0);
    const feeAccount = gatewayFeeAccount(input.provider, input.paid_currency);
    if (feeNgn.gt(0) && feeAccount) {
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
            // The same (currency-aware) float the capture debited.
            account_code: settlementAccountForProvider(
              input.provider,
              input.paid_currency,
            ),
            credit_ngn: feeStr,
            description: `${input.provider} fee netted from settlement`,
          },
        ],
      });
    }

    // Realised FX gain/loss (V2.2 §6.6): if the customer settled in a foreign
    // currency, the NGN actually received differs from the amount the order
    // booked at its captured rate. Post the variance to the realised FX
    // account, atomic with the payment.
    //
    // Only against a REAL lock: the order must be denominated in the paid
    // currency at a captured rate (1.0 is the column default, not a rate).
    // Against an unlocked NGN order, paid_amount × 1.0 made a $764 capture
    // look like a ~₦990k "FX gain". And a capture converted at the order's own
    // locked rate (every Nomba USD credit) is not an FX event at all — dollars
    // sit in the USD wallet until converted; any sub-dollar ceil surplus is not
    // a loss either.
    const orderRate = money(order.fx_rate_used || 0);
    const lockedToPaidCurrency =
      String(order.display_currency || "").toUpperCase() ===
        String(input.paid_currency || "").toUpperCase() &&
      orderRate.gt(0) &&
      !orderRate.eq(1);
    const sameRateCapture =
      input.fx_rate_used !== null &&
      input.fx_rate_used !== undefined &&
      money(input.fx_rate_used).eq(orderRate);
    if (
      input.paid_currency &&
      input.paid_currency !== "NGN" &&
      input.paid_amount &&
      lockedToPaidCurrency &&
      !sameRateCapture
    ) {
      const bookedNgn = money(input.paid_amount).times(
        money(order.fx_rate_used),
      );
      const deltaNgn = money(input.amount_ngn).minus(bookedNgn);
      // The capture credited 2400 with the ACTUAL NGN; the sale journal
      // draws down the BOOKED total — the variance lives in 2400, so the
      // FX gain/loss clears against deposits, not the bank.
      await accounting.postFxGainLoss({
        client,
        brand,
        delta_ngn: toCurrencyString(deltaNgn),
        reference: order.order_number,
        description: `Realised FX on ${order.order_number} (${input.paid_currency})`,
        source_id: order.order_id,
        user_id: user.user_id,
        idempotency_key: `fx_revaluation:${paymentRow.payment_id}`,
        cash_account_code: ACCOUNTS.CUSTOMER_DEPOSITS,
      });
    }

    // Trigger recomputed amount_paid_ngn; re-read.
    const updated = await repo.findById({ client, brand, id });
    let result = updated;
    const paidNow = money(updated.amount_paid_ngn);
    const totalDue = money(updated.total_ngn);
    const paidBefore = money(order.amount_paid_ngn || 0);

    if (paidBefore.lt(totalDue) && paidNow.gte(totalDue)) {
      // This payment just completed the order → run the settle side-effects
      // (stock deduction + order.paid fan-out) exactly once. Detected from the
      // payment crossing full, NOT the status — a deposit order paying its
      // balance may already be 'assigned'/'order_ready', and markPaid keeps that
      // fulfilment status rather than rewinding it to 'paid'.
      result = await markPaid({
        client,
        brand,
        user,
        request_id,
        order: updated,
      });
    } else if (paidNow.gt(money(0)) && paidNow.lt(totalDue)) {
      // Part payment recorded → reflect 'partially_paid' so the drawer and
      // reports stop showing a stale 'pending_payment'. Only advances a still-
      // open order; never rewinds one already further along the lifecycle
      // (e.g. an assigned order taking its balance instalment).
      if (["pending_payment", "partially_paid"].includes(updated.status)) {
        const flipped = await repo.setStatus({
          client,
          brand,
          id,
          status: "partially_paid",
        });
        if (flipped) result = flipped;
      }
      // ANY order commits to production the moment money first lands on it —
      // not only a deposit_triggered custom order past its configured
      // required_deposit_ngn (owner directive 2026-09-29: "once an order is
      // even partially paid... include partially paid... the stock considers
      // it as a sale at once"). The status stays 'partially_paid' (the
      // balance is still outstanding); production unlocks via order.deposit_met
      // exactly as it always has for deposit-triggered orders, just no longer
      // restricted to that one payment_model. Detect the crossing from the
      // payment delta (paidBefore was nothing, paidNow is something) so this
      // fires once, on the FIRST payment, however small — a later top-up on an
      // already-committed order does not re-fire it. The outbox dedup key is
      // the second backstop against a double-open.
      if (paidBefore.lte(money(0)) && paidNow.gt(money(0))) {
        // Stock is drawn AS A SALE right now, in this same transaction — not
        // held back until the balance clears. Mirrors markPaid exactly (same
        // shared drawStockForOrder engine), so a later full settlement finds
        // every line already drawn and deducts nothing twice. A shortfall
        // here never blocks the payment: the short line becomes a formal
        // pre-order instead (see drawStockForOrder).
        const { shortfallLines } = await drawStockForOrder({
          client,
          brand,
          user,
          order: updated,
          reason: "order partially paid — production committed",
          hardFailOnNoLocation: false,
        });
        await recordStockShortfall({
          client,
          brand,
          order_id: id,
          shortfallLines,
        });

        const reqDep = updated.required_deposit_ngn;
        events.emit("order.deposit_met", {
          brand,
          order_id: id,
          contact_id: updated.contact_id,
          required_deposit_ngn: reqDep,
          amount_paid_ngn: updated.amount_paid_ngn,
        });
        // Durable + post-commit (H-2): Service Jobs opens a styling job for the
        // committed order. Keeps the in-process emit for realtime.
        await outbox.enqueue(client, {
          business: brand,
          event_type: "order.deposit_met",
          payload: {
            brand,
            order_id: id,
            contact_id: updated.contact_id,
            required_deposit_ngn: reqDep,
            amount_paid_ngn: updated.amount_paid_ngn,
          },
          dedup_key: `order.deposit_met:${id}`,
        });
      }
    }

    // Mirror EVERY payment onto the order's proforma invoice, in this same
    // transaction, so the two screens can never disagree — part payments and
    // full settlement alike. Recording money on the order used to leave the
    // invoice showing the untouched balance; full settlement waited on the
    // post-commit order.paid outbox hop, so Invoicing lagged Sales by however
    // long the worker took.
    // GL-safe: applyPayment posts no journal of its own, and the invoice-side
    // entries are skipped for order-backed invoices (invoicing.recordPayment)
    // precisely because the order's capture journal already booked the cash.
    // The receipt still comes from order.paid → createFromOrder →
    // finalizeDraftInvoice: with the balance already applied here that call
    // finds nothing outstanding, skips the payment, and issues the receipt
    // (createFromOrder's already-final short-circuit lets a receiptless paid
    // invoice through for exactly this reason).
    {
      const invoicingRepo = require("../invoicing/invoicing.repo");
      const openInvoice = await invoicingRepo.findByOrderId({
        client,
        brand,
        order_id: id,
      });
      if (
        openInvoice &&
        !["paid", "void", "refunded"].includes(openInvoice.status)
      ) {
        // Cap at whatever the invoice still shows outstanding: an order can
        // carry charges the proforma doesn't (or vice versa), and the
        // balance_due_ngn generated column must never be driven negative.
        const invOutstanding = money(openInvoice.balance_due_ngn || 0);
        const thisPayment = money(input.amount_ngn);
        const toApply = thisPayment.gt(invOutstanding)
          ? invOutstanding
          : thisPayment;
        if (toApply.gt(0)) {
          await invoicingRepo.applyPayment({
            client,
            brand,
            payment: {
              invoice_id: openInvoice.invoice_id,
              sales_order_payment_id: paymentRow.payment_id,
              amount_applied_ngn: toCurrencyString(toApply),
              applied_by: user.user_id || null,
              notes:
                input.notes ||
                `Recorded on ${order.order_number} (${paymentRow.payment_number})`,
            },
          });
        }
      }
    }

    // Part-payment comms (Flexi Pay D15): receipt after every instalment +
    // a one-time halfway celebration. Post-commit via the outbox — the
    // payment-comms subscriber renders through the Comms Studio automations
    // (payment_received / payment_milestone), so the copy stays CEO-editable.
    // Fully-paid orders skip this: order.paid drives the final receipt flow.
    if (paidNow.lt(totalDue)) {
      await outbox.enqueue(client, {
        business: brand,
        event_type: "order.payment_recorded",
        payload: {
          brand,
          order_id: id,
          contact_id: updated.contact_id,
          payment_id: paymentRow.payment_id,
          amount_ngn: String(input.amount_ngn),
          amount_paid_ngn: String(updated.amount_paid_ngn),
          total_ngn: String(updated.total_ngn),
        },
        dedup_key: `order.payment_recorded:${paymentRow.payment_id}`,
      });
      const beforePaid = money(order.amount_paid_ngn || 0);
      const afterPaid = money(updated.amount_paid_ngn || 0);
      const half = money(updated.total_ngn).dividedBy(2);
      if (half.gt(0) && beforePaid.lt(half) && afterPaid.gte(half)) {
        await outbox.enqueue(client, {
          business: brand,
          event_type: "order.payment_milestone",
          payload: {
            brand,
            order_id: id,
            contact_id: updated.contact_id,
            milestone: "half",
            amount_paid_ngn: String(updated.amount_paid_ngn),
            total_ngn: String(updated.total_ngn),
          },
          dedup_key: `order.payment_milestone:half:${id}`,
        });
      }
    }

    // Overpaid — money beyond the order total (a customer paying twice, an
    // outdated link for a higher amount, a USD capture well over the dollar
    // balance). It stays in Customer Deposits 2400 as money held for the
    // customer (the Change Order downgrade model); refunding it or keeping it
    // as credit is Finance's call, so tell them. Rounding never gets here:
    // the gateway paths settle cent-level differences exactly, and the ₦1
    // floor ignores kobo. Only the excess THIS payment added is reported.
    {
      const floor = paidBefore.gt(totalDue) ? paidBefore : totalDue;
      const addedOver = paidNow.minus(floor);
      if (addedOver.gt(money(OVERPAYMENT_ALERT_FLOOR_NGN))) {
        await outbox.enqueue(client, {
          business: brand,
          event_type: "order.overpaid",
          payload: {
            brand,
            order_id: id,
            order_number: order.order_number,
            payment_id: paymentRow.payment_id,
            overpaid_ngn: toCurrencyString(paidNow.minus(totalDue)),
            added_ngn: toCurrencyString(addedOver),
            paid_currency: input.paid_currency || null,
            paid_amount: input.paid_amount || null,
          },
          dedup_key: `order.overpaid:${paymentRow.payment_id}`,
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

/**
 * Flag stock-bearing lines as a formal PRE-ORDER (000086/000097 shape) — the
 * same treatment a stock-short line gets at checkout in `createOrderTx`, now
 * reused for a shortfall discovered later, at a payment's stock draw. Getting
 * this flag on the row (not just a note) is what lets the existing pre-order
 * auto-allocation engine (`preorder-allocation.service.allocateForVariant`)
 * pick the line up automatically the moment matching stock is received —
 * before this, a payment-time shortfall left only an internal note nobody's
 * code ever watched.
 */
async function flagLinesAsPreorder({ client, brand, order_id, line_ids }) {
  const ids = (line_ids || []).filter(Boolean);
  if (!ids.length) return [];
  const preorderPolicy = await repo.getPreorderPolicy({ client, brand });
  const weeks = preorderPolicy.max_weeks || preorderPolicy.min_weeks || 0;
  const readyBy = weeks
    ? new Date(Date.now() + weeks * 7 * 86_400_000).toISOString().slice(0, 10)
    : null;
  await repo.markOrderPreorder({
    client,
    brand,
    order_id,
    ready_by: readyBy,
    min_weeks: preorderPolicy.min_weeks,
    max_weeks: preorderPolicy.max_weeks,
  });
  await repo.markLinesPreorder({ client, brand, line_ids: ids });
  return ids;
}

/** The ops-facing trail for a stock shortfall — an internal note (visible on
 *  the order drawer) plus the alert event (stock-shortfall.subscribers). Used
 *  whether the shortfall was caught on full settlement or on the very first
 *  partial payment. */
async function recordStockShortfall({ client, brand, order_id, shortfallLines }) {
  if (!shortfallLines.length) return;
  await repo.mergeInternalNotes({
    client,
    brand,
    id: order_id,
    patch: {
      stock_shortfall: {
        lines: shortfallLines,
        flagged_at: new Date().toISOString(),
      },
    },
  });
  events.emit("order.stock_shortfall", {
    brand,
    order_id,
    lines: shortfallLines,
  });
}

/**
 * Draw this order's stock as a real 'sale' — the single engine behind BOTH
 * `markPaid` (full settlement) and the partial-payment commit (any money
 * landing opens the Stylist Studio job AND draws stock the same instant —
 * see addPayment / order-status.js). "The sale owns the stock draw" still
 * holds: whichever of the two crossings happens FIRST does the real work,
 * and the other is a clean no-op, because `netSoldForOrder` reads what THIS
 * order has ACTUALLY drawn from the movement ledger and only ever deducts
 * the remainder — a part-paid order that draws its stock here and later pays
 * its balance re-enters markPaid, finds `alreadyDrawn === quantity` on every
 * line, and deducts nothing a second time.
 *
 * A stock shortfall never blocks the payment — the money is already taken —
 * it flags the short line as a formal pre-order instead (`flagLinesAsPreorder`)
 * so the pre-order auto-allocation engine closes it out the moment stock
 * arrives, same as a shortage caught at checkout would have been.
 *
 * @param {boolean} [hardFailOnNoLocation] markPaid's long-standing behaviour:
 *   no active stock location aborts the whole payment outright (a brand with
 *   no stock location literally cannot fulfil). The partial-payment path must
 *   never abort a captured payment over a config gap, so it instead flags
 *   every stock-bearing line as a pre-order and lets the payment land.
 */
async function drawStockForOrder({
  client,
  brand,
  user,
  order,
  reason,
  hardFailOnNoLocation = false,
}) {
  const variantLines = (order.lines || []).filter((l) => l.variant_id);
  if (!variantLines.length) return { shortfallLines: [], preorderedLineIds: [] };

  const loc = await stockRepo.getDefaultLocation({ client, brand });
  if (!loc) {
    if (hardFailOnNoLocation) {
      throw new AppError(
        "NO_STOCK_LOCATION",
        "No active stock location to fulfil from",
        409,
      );
    }
    logger.warn(
      { order_id: order.order_id },
      "drawStockForOrder: no active stock location — lines flagged as pre-order",
    );
    const preorderedLineIds = await flagLinesAsPreorder({
      client,
      brand,
      order_id: order.order_id,
      line_ids: variantLines.map((l) => l.line_id),
    });
    return { shortfallLines: [], preorderedLineIds };
  }

  const shortfallLines = [];
  const shortLineIds = [];
  for (const line of variantLines) {
    // Re-settlement guard. An order can draw its stock twice over its life —
    // once when it first commits (partial payment) and again if the total
    // later rises back into balance (a delivery fee, a Change Order) — and
    // BOTH crossings call this function. Read what this order has actually
    // drawn from the movement ledger (sale − return) and only deduct the
    // remainder. First draw: drawn = 0, so the full quantity goes as before.
    // Any later call: already covered, so this is a clean no-op.
    const alreadyDrawn = await stockRepo.netSoldForOrder({
      client,
      brand,
      variant_id: line.variant_id,
      location_id: loc.location_id,
      reference_id: order.order_id,
    });
    const toDeduct = Number(line.quantity) - alreadyDrawn;
    if (toDeduct <= 0) {
      logger.info(
        {
          order_id: order.order_id,
          variant_id: line.variant_id,
          quantity: line.quantity,
          already_drawn: alreadyDrawn,
        },
        "drawStockForOrder: stock for this line already drawn — skipping deduction",
      );
      continue;
    }
    // Every order reserves at placement now (Flexi Pay D8) — release the
    // hold first so the 'sale' deduction keeps reserved <= on_hand valid.
    // releaseOrderReservation releases only what THIS order actually holds
    // (its own movement ledger), so legacy orders with no reservation are a
    // clean no-op and another order's hold can never be freed by mistake.
    try {
      await stockService.releaseOrderReservation({
        client,
        brand,
        variant_id: line.variant_id,
        location_id: loc.location_id,
        quantity: toDeduct,
        reference_id: order.order_id,
        user_id: user.user_id,
        reason: reason || "order committed to production",
      });
    } catch (err) {
      logger.warn(
        { err, order_id: order.order_id, variant_id: line.variant_id },
        "reservation release skipped",
      );
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
    // SAFETY (Flexi Pay plan, PR-1): a stock shortfall must NEVER block the
    // payment from being recorded — the gateway has already taken the
    // customer's money, and a throw here would roll back the whole
    // addPayment transaction and strand the order in pending_payment while
    // the webhook retries forever (pre-order lines have no stock to deduct
    // by definition). Each deduction runs in its own savepoint; short lines
    // are flagged as a formal pre-order instead.
    await client.query("SAVEPOINT pgh_deduct");
    try {
      await stockService.deductForSale({
        client,
        brand,
        variant_id: line.variant_id,
        location_id: loc.location_id,
        quantity: toDeduct,
        reference_id: order.order_id,
        sales_channel: order.sales_channel,
        unit_cost_ngn: costForCogs,
        user_id: user.user_id,
      });
      await client.query("RELEASE SAVEPOINT pgh_deduct");
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT pgh_deduct");
      await client.query("RELEASE SAVEPOINT pgh_deduct").catch(() => {});
      shortfallLines.push({
        variant_id: line.variant_id,
        quantity: toDeduct,
        name: line.product_name_snapshot || null,
      });
      shortLineIds.push(line.line_id);
      logger.error(
        {
          err: err.message,
          order_id: order.order_id,
          variant_id: line.variant_id,
        },
        "stock shortfall on committed order — deduction skipped, payment proceeds",
      );
    }
  }
  const preorderedLineIds = shortLineIds.length
    ? await flagLinesAsPreorder({
        client,
        brand,
        order_id: order.order_id,
        line_ids: shortLineIds,
      })
    : [];
  return { shortfallLines, preorderedLineIds };
}

async function markPaid({ client, brand, user, _request_id, order }) {
  const { shortfallLines } = await drawStockForOrder({
    client,
    brand,
    user,
    order,
    reason: "order paid in full",
    hardFailOnNoLocation: true,
  });
  await recordStockShortfall({
    client,
    brand,
    order_id: order.order_id,
    shortfallLines,
  });
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
  // Move to 'paid' ONLY from a pre-fulfilment state. A deposit order paying its
  // balance may already be 'assigned'/'order_ready'/'dispatched' (styling under
  // way) — settling the money must not rewind that fulfilment progress. When the
  // guard doesn't match, keep the current status (re-read to return the row).
  const paid =
    (await repo.advanceStatus({
      client,
      brand,
      id: order.order_id,
      to: "paid",
      from: ["draft", "pending_payment", "partially_paid"],
    })) || (await repo.findById({ client, brand, id: order.order_id }));
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
 *
 * Universal pre-orders (000086) — DELIBERATELY NOT APPLIED HERE. This path calls
 * repo.createOrder directly (a flat `digital` revenue order with ZERO
 * stock-bearing lines), so the reserve-per-line-in-a-SAVEPOINT / mark-as-
 * pre-order logic in createOrder has nothing to act on: there is no variant to
 * be short on. The physical wig that a subscription entitles the member to is
 * selected and raised through a SEPARATE order that DOES flow through
 * createOrder and therefore gets full pre-order treatment. Giving this charge
 * "reserve/persist parity" would be meaningless (no lines) and wrong (it would
 * imply the membership fee itself can be back-ordered), so it stays excluded.
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

/**
 * Restore a cancelled order from the archive.
 *
 * Cancelling is not a status flip — it releases the order's stock hold and, when
 * a deposit had been paid, forfeits it to Other Income with a journal entry. So
 * a restore has to put the stock back, and must refuse outright where money has
 * already moved on the books.
 *
 * Two-phase by design. The first call is a DRY RUN: it reports whether every
 * line can be re-reserved and returns `{ requires_confirmation: true }` with the
 * short lines when it can't. The caller shows that warning; only a second call
 * with `confirm: true` commits, restoring the short lines as PRE-ORDERS exactly
 * as a new order would. This keeps "the units you had are gone" an explicit
 * human decision instead of a silent downgrade.
 *
 * Refused when a deposit was forfeited: reversing that journal entry is a
 * finance judgement, not an Orders-screen button.
 */
async function restoreOrder({ brand, user, request_id, id, confirm = false }) {
  return transaction(async (client) => {
    const order = await repo.findById({ client, brand, id });
    if (!order) throw new NotFoundError("Order");
    if (order.status !== "cancelled")
      throw new AppError(
        "INVALID_STATE",
        `Only a cancelled order can be restored (this one is ${order.status})`,
        409,
        { user_message: "This order isn't cancelled, so there's nothing to restore." },
      );
    if (money(order.amount_paid_ngn || 0).gt(0))
      throw new AppError(
        "DEPOSIT_FORFEITED",
        "Order carried a deposit that was forfeited on cancellation",
        409,
        {
          user_message:
            "This order had a deposit that was forfeited to income when it was cancelled. Restoring it would need a finance correction — raise a new order instead.",
        },
      );

    const loc = await stockRepo.getDefaultLocation({ client, brand });
    const lines = (order.lines || []).filter((l) => l.variant_id);

    // Dry run: what can actually be re-held right now?
    const short = [];
    if (loc) {
      for (const line of lines) {
        const level = await stockRepo.variantWithStockForProduct({
          client,
          brand,
          product_id: line.product_id,
          location_id: loc.location_id,
          quantity: line.quantity,
        });
        if (!level || level.variant_id !== line.variant_id) {
          const { rows } = await client.query(
            `SELECT COALESCE(available, 0) AS available
               FROM ${brand}.stock_levels
              WHERE variant_id = $1 AND location_id = $2`,
            [line.variant_id, loc.location_id],
          );
          const available = rows[0] ? Number(rows[0].available) : 0;
          if (available < line.quantity) {
            short.push({
              line_id: line.line_id,
              variant_id: line.variant_id,
              name: line.product_name_snapshot || null,
              wanted: line.quantity,
              available,
            });
          }
        }
      }
    }

    if (short.length && !confirm) {
      // Nothing has been written — the transaction simply ends here.
      return {
        requires_confirmation: true,
        order_number: order.order_number,
        short_lines: short,
        message:
          short.length === 1
            ? "1 item is no longer in stock. Restoring will bring it back as a pre-order."
            : `${short.length} items are no longer in stock. Restoring will bring them back as pre-orders.`,
      };
    }

    // Commit: re-hold everything that can be held. A short line simply stays
    // unheld and the order is flagged as a pre-order below.
    const restoredPreorderLines = [];
    if (loc) {
      for (const line of lines) {
        await client.query("SAVEPOINT pgh_restore");
        try {
          await stockService.reserveForOrder({
            client,
            brand,
            variant_id: line.variant_id,
            location_id: loc.location_id,
            quantity: line.quantity,
            reference_id: order.order_id,
            user_id: user.user_id,
          });
          await client.query("RELEASE SAVEPOINT pgh_restore");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT pgh_restore");
          await client.query("RELEASE SAVEPOINT pgh_restore").catch(() => {});
          restoredPreorderLines.push(line);
          logger.info(
            { err: err.message, order_id: id, line_id: line.line_id },
            "restore: line could not be re-held — kept as pre-order",
          );
        }
      }
    } else {
      restoredPreorderLines.push(...lines);
    }

    // Back to wherever it was before the cancel; pending_payment is the safe
    // default for legacy rows with no recorded transition.
    const previous =
      (await repo.statusBeforeCancellation({ client, brand, id })) ||
      "pending_payment";
    const o = await repo.setStatus({ client, brand, id, status: previous });
    await repo.clearCancellation({ client, brand, id });

    if (restoredPreorderLines.length) {
      const policy = await repo.getPreorderPolicy({ client, brand });
      const weeks = policy.max_weeks || policy.min_weeks || 0;
      await repo.markOrderPreorder({
        client,
        brand,
        order_id: id,
        ready_by: weeks
          ? new Date(Date.now() + weeks * 7 * 86_400_000).toISOString().slice(0, 10)
          : null,
        min_weeks: policy.min_weeks,
        max_weeks: policy.max_weeks,
      });
      await repo.markLinesPreorder({
        client,
        brand,
        line_ids: restoredPreorderLines.map((l) => l.line_id),
      });
    }

    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.restore",
      target_type: "sales_order",
      target_id: id,
      request_id,
      metadata: {
        restored_to: previous,
        preorder_lines: restoredPreorderLines.length,
      },
    });
    events.emit("order.restored", {
      brand,
      order_id: id,
      restored_to: previous,
    });
    return {
      requires_confirmation: false,
      order: o,
      restored_to: previous,
      preorder_line_count: restoredPreorderLines.length,
    };
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
    // Release whatever THIS order holds so the units return to available
    // stock. Every plan reserves at placement now (Flexi Pay D8);
    // releaseOrderReservation reads the order's own movement ledger, so
    // legacy orders with no hold are a clean no-op.
    {
      const loc = await stockRepo.getDefaultLocation({ client, brand });
      if (loc) {
        for (const line of order.lines || []) {
          if (!line.variant_id) continue;
          try {
            await stockService.releaseOrderReservation({
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
              "reservation release on cancel skipped",
            );
          }
        }
      }
    }
    const o = await repo.setStatus({ client, brand, id, status: "cancelled" });
    // Stamp when — and why, when a reason is supplied (e.g. the system
    // auto-cancel of an abandoned checkout or a superseded duplicate) — so the
    // Orders archive and the order detail can explain the cancellation instead
    // of showing a cancelled order with no date and no rationale.
    const stamped = await repo.setCancellationReason({
      client,
      brand,
      id,
      reason: reason || null,
    });
    // Policy Q7: deposits held by a cancelled unpaid order (layaway
    // abandonment sweep, manual cancel) are forfeited to Other Income —
    // the 2400 liability cannot survive an order that no longer exists.
    // A pending cancellation request owns the money instead (its approval
    // posts the refund/fee split), so never forfeit under its feet.
    if (
      order.status !== "cancellation_requested" &&
      money(order.amount_paid_ngn || 0).gt(0)
    ) {
      const accounting = require("../accounting/accounting.service");
      await accounting.postEntry({
        client,
        brand,
        user_id: user.user_id,
        entry: {
          source_type: "refund",
          source_table: "sales_orders",
          source_id: id,
          reference: order.order_number,
          description: `Deposit forfeited on cancellation — ${order.order_number}`,
          idempotency_key: `deposit_forfeit:${id}`,
        },
        lines: salesPostings.buildForfeitLines({
          amount_paid_ngn: order.amount_paid_ngn,
          contact_id: order.contact_id,
          reference: order.order_number,
        }),
      });
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
    // The stamped row (cancelled_at + reason) is the truthful one — `o` was
    // read before the stamp, so returning it would hand the caller a cancelled
    // order with no cancellation date.
    return stamped || o;
  });
}

// Manual status move from the order drawer (V2.2 §6.2). Staff can nudge an
// order along the FULFILMENT stages themselves — e.g. mark a walk-in Completed
// the moment the customer's happy, or Dispatched when the rider takes it. The
// PAYMENT states (pending_payment / partially_paid / paid) and the CANCEL states
// are deliberately NOT settable here: those carry money + stock side-effects and
// stay automatic (payments → paid via markPaid; cancel → cancelOrder). Moving to
// a customer-facing stage fires the matching Comms Studio message (gated by
// Messaging settings), so a manual "Dispatched" still truthfully tells the buyer
// it's on its way.
const MANUAL_STATUSES = new Set([
  "assigned",
  "order_ready",
  "dispatched",
  "completed",
]);
const MANUAL_ALLOWED_FROM = new Set([
  "partially_paid",
  "paid",
  "assigned",
  "order_ready",
  "dispatched",
  "completed",
]);

async function setOrderStatus({ brand, user, request_id, id, status }) {
  if (!MANUAL_STATUSES.has(status)) {
    throw new AppError(
      "INVALID_STATUS",
      `'${status}' cannot be set manually`,
      422,
      {
        user_message:
          "Payment and cancellation states are managed automatically — record a payment or use Cancel instead.",
      },
    );
  }
  const updated = await transaction(async (client) => {
    const before = await repo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("Order");
    if (!MANUAL_ALLOWED_FROM.has(before.status)) {
      throw new AppError(
        "INVALID_STATE",
        `A '${before.status}' order cannot be moved to '${status}'`,
        409,
        {
          user_message:
            "This order isn't paid yet — record the payment before moving it forward.",
        },
      );
    }
    // Care & Accessories. (1) Dispatch is refused while the delivery fee is
    // under manual review — the 000096 trigger enforces it for every caller;
    // this turns it into a clear message instead of a raw constraint error.
    if (status === "dispatched" && before.needs_delivery_review === true) {
      throw new AppError(
        "DELIVERY_REVIEW_PENDING",
        "Delivery fee review must be settled before dispatch",
        409,
        {
          user_message:
            "This order contains care products and its delivery fee is still under review. Settle it in Sales → Delivery Fee Review before dispatching.",
        },
      );
    }
    // (2) A retail-only order is never stylist work: it goes paid → ready →
    // dispatched/collected → completed, skipping 'assigned'. Mixed orders keep
    // 'assigned' for their genuine wig lines. No-op on FLH (no retail rows).
    if (status === "assigned") {
      const { rows: mix } = await client.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE p.catalogue_role = 'retail')::int AS retail
           FROM ${brand}.sales_order_lines l
           LEFT JOIN ${brand}.product_variants pv ON pv.variant_id = l.variant_id
           LEFT JOIN ${brand}.products p ON p.product_id = pv.product_id
          WHERE l.order_id = $1`,
        [id],
      );
      if (mix[0] && mix[0].total > 0 && mix[0].retail === mix[0].total) {
        throw new AppError(
          "RETAIL_NOT_STYLED",
          "Care & Accessories orders are not assigned to a stylist",
          422,
          {
            user_message:
              "This order only contains care products — there is no styling work. Mark it Order ready instead.",
          },
        );
      }
    }
    const row = await repo.setStatus({ client, brand, id, status });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.status_set",
      target_type: "sales_order",
      target_id: id,
      before: { status: before.status },
      after: { status },
      request_id,
    });
    events.emit("order.updated", { brand, order_id: id });
    return row;
  });
  // Fire the matching customer message (best-effort; no-op if toggled Off).
  // Routed through the shared MANUAL_STATUS_EVENT map so the impact modal's
  // live-state read (getStatusAutomationStates) can never promise a send this
  // path wouldn't make.
  const orderComms = require("./order-comms");
  await orderComms.forStatus({ brand, order: updated, status });
  return updated;
}

/**
 * Live on/off state of the customer messages a manual fulfilment move fires,
 * keyed by the target status — so the order drawer's impact modal can show a
 * definite "will send" / "won't send — it's off" instead of static copy.
 *
 * Only statuses that actually fire a message appear (order_ready, dispatched);
 * assigned/completed send nothing and are simply absent. Reads from the same
 * MANUAL_STATUS_EVENT map setOrderStatus dispatches from, so the promise and
 * the send stay in lockstep.
 */

async function setSpecificInstructions({ brand, user, request_id, id, specific_instructions }) {
  return transaction(async (client) => {
    const before = await repo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("Order");
    // Q2=A editable until terminal states
    if (["completed", "cancelled", "refunded", "failed"].includes(before.status)) {
      throw new AppError(
        "INVALID_STATE",
        `Cannot edit specific instructions on a ${before.status} order`,
        409,
        { user_message: `This order is ${before.status} — specific instructions can no longer be changed.` },
      );
    }
    const trimmed = specific_instructions && String(specific_instructions).trim() ? String(specific_instructions).trim().slice(0,2000) : null;
    const updated = await repo.setSpecificInstructions({ client, brand, id, specific_instructions: trimmed });

    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.specific_instructions.update",
      target_type: "sales_order",
      target_id: id,
      before: { specific_instructions: before.specific_instructions || null },
      after: { specific_instructions: trimmed },
      request_id,
    });

    // Timeline — internal only, shows in admin timeline + history toggle
    await withSavepoint(client, () =>
      timelineRepo.insert({
        client,
        brand,
        event: {
          sales_order_id: id,
          event_code: "specific_instructions_updated",
          label: trimmed ? "Specific Instructions Updated" : "Specific Instructions Cleared",
          source_module: "sales",
          is_customer_visible: false,
          internal_payload: { specific_instructions: trimmed, before: before.specific_instructions || null },
          recorded_by: user.user_id || null,
        },
      }),
    ).catch((err) => {
      const { logger: _log } = require("../../config/logger");
      _log.warn({ err, order_id: id }, "setSpecificInstructions: timeline insert skipped");
    });

    // Q4=C — if a Studio job exists, snapshot the edited instructions into its spec for audit
    // and keep live join for current view. Best-effort, no throw.
    try {
      const jobs = await serviceJobsRepo.listServiceJobs({ brand, sales_order_id: id, page_size: 50 });
      for (const j of (jobs.data || [])) {
        // merge into specification jsonb if exists
        await client.query(
          `UPDATE ${brand}.service_jobs SET specification = COALESCE(specification, '{}'::jsonb) || jsonb_build_object('order_specific_instructions', $2::text, 'order_specific_instructions_updated_at', now()::text, 'order_specific_instructions_updated_by', $3::text) WHERE job_id = $1`,
          [j.job_id, trimmed, user.user_id || null],
        );
      }
    } catch (e) {
      // non-blocking
      const { logger } = require("../../config/logger");
      logger.warn({ err: e.message, order_id: id }, "setSpecificInstructions: snapshot to service_jobs failed");
    }

    events.emit("order.updated", { brand, order_id: id });
    return updated;
  });
}


async function getStatusAutomationStates({ brand }) {
  const orderComms = require("./order-comms");
  const commsStudio = require("../comms_studio/comms-studio.service");
  const statusToEvent = orderComms.MANUAL_STATUS_EVENT;
  const statuses = Object.keys(statusToEvent);
  const event_keys = statuses.map((s) => statusToEvent[s]);
  const states = await commsStudio.getAutomationStates({ brand, event_keys });
  const byEvent = new Map(states.map((s) => [s.event_key, s]));
  const out = {};
  for (const status of statuses) {
    const event_key = statusToEvent[status];
    const st = byEvent.get(event_key) || {
      configured: false,
      is_active: false,
      channel: null,
    };
    out[status] = {
      event_key,
      configured: !!st.configured,
      is_active: !!st.is_active,
      channel: st.channel || null,
    };
  }
  return out;
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
    // Care & Accessories (PR 2): a retail SKU can only be quoted through the
    // PXG gate while published. Conversion re-validates inside createOrder —
    // a quote never whitelists a later sale of an unpublished item.
    if (ctx.catalogue_role === "retail") {
      await careGate.requireEnabled(brand);
      if (
        ctx.product_deleted ||
        ctx.retail_status !== "live" ||
        ctx.variant_active === false
      )
        throw new AppError(
          "REFERENCE_INVALID",
          `Care & Accessories SKU is not currently sellable (variant ${li.variant_id})`,
          409,
        );
    }
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
      // Snapshot overrides let a caller (e.g. a styled-product quote line)
      // record the styled name/label/SKU instead of the base variant's —
      // mirrors computeTotalsAndLines (pricing/totals.js) for real orders.
      product_name_snapshot: li.product_name_snapshot ?? ctx.product_name,
      variant_label_snapshot: li.variant_label_snapshot ?? ctx.variant_name,
      sku_snapshot: li.sku_snapshot ?? ctx.sku,
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
  convert = false,
  sales_channel,
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
  // Order-first fallback: when the customer isn't paying through the quote's
  // own pay link (offline transfer, cash, staff taking payment by phone),
  // accepting can mint the order straight away so there is something to take
  // money against. Opt-in — a plain accept still just flips the status, so
  // quotes accepted "in principle" don't litter the pipeline with unpaid
  // orders. Converting is idempotent, so this is safe on a re-submitted accept.
  if (decision === "accept" && convert) {
    const order = await ensureQuotationOrder({
      brand,
      user,
      request_id,
      quotation_id: id,
      sales_channel,
    });
    // Re-read: the conversion moved the status on from 'accepted' to
    // 'converted' and stamped converted_sales_order_id, so `updated` (captured
    // before the convert) would hand the caller a stale row.
    const fresh = await repo.findQuotationById({ brand, id });
    return { ...(fresh || updated), converted_order: order };
  }
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
      quotation_id: id,
      // Race backstop for the pay-link rail: two concurrent gateway webhooks
      // for the same quote both reach createOrder, and the partial unique index
      // on client_idempotency_key collapses them onto ONE order (the second
      // caller gets the first's row back rather than a twin). The status guard
      // above catches the sequential case; this catches the simultaneous one.
      client_idempotency_key: `quotation:${id}`,
      lines: q.lines
        .filter((l) => l.variant_id)
        .map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
          unit_price_ngn: l.unit_price_ngn,
          // Carry the quote's own name/label/SKU snapshot forward — without
          // this a converted styled-product quote reverts to the raw
          // base-product name on the resulting order.
          product_name_snapshot: l.product_name_snapshot,
          variant_label_snapshot: l.variant_label_snapshot,
          sku_snapshot: l.sku_snapshot,
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

/**
 * Idempotently resolve the order for a quotation, converting it if it hasn't
 * been converted yet. This is what the gateway webhook calls the moment a quote
 * payment confirms (000090): the quote never holds money, it materialises its
 * order just in time and the payment is then recorded against that order by the
 * ordinary `addPayment` path.
 *
 * Idempotent on three levels, because a gateway will re-deliver a webhook:
 *   1. Already converted → return the existing order, no second conversion.
 *   2. Concurrent delivery → convertQuotation's client_idempotency_key
 *      ('quotation:<id>') collapses both onto one order via the unique index.
 *   3. The payment itself is deduped downstream on provider+provider_reference.
 *
 * `user` is `{ user_id: null }` on the webhook path — the same system-actor
 * shape recordGatewayPayment already uses for addPayment, so the audit row
 * attributes the conversion to the webhook rather than to a staff member.
 */
async function ensureQuotationOrder({
  brand,
  user = { user_id: null },
  request_id,
  quotation_id,
  sales_channel,
}) {
  const q = await repo.findQuotationById({ brand, id: quotation_id });
  if (!q) throw new NotFoundError("Quotation");
  if (q.converted_sales_order_id) {
    const existing = await repo.findById({
      brand,
      id: q.converted_sales_order_id,
    });
    if (existing) return existing;
    // Status says converted but the order is gone (deleted, or a half-written
    // legacy row). Rather than strand the payment, clear the stale pointer and
    // convert again — a quote with no reachable order is worse than a fresh
    // one. The status must be reset too, or convertQuotation's own guard
    // rejects it as already converted.
    logger.warn(
      { brand, quotation_id, order_id: q.converted_sales_order_id },
      "quotation marked converted but its order is missing — reconverting",
    );
    await repo.setQuotationStatus({
      brand,
      id: quotation_id,
      status: "accepted",
      extra: { converted_sales_order_id: null },
    });
  }
  return convertQuotation({
    brand,
    user,
    request_id,
    id: quotation_id,
    // A quote paid through its public link is a self-service sale; 'storefront'
    // is the closest channel in the enum (there is no 'online').
    input: { sales_channel: sales_channel || "storefront" },
  });
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
      // Policy Q8: post the refund. Shape depends on whether the sale
      // journal already recognised revenue (order reached paid) — then the
      // refund is contra revenue + VAT reversal against bank; otherwise the
      // money still sits in Customer Deposits 2400 and settles from there,
      // splitting cash-back vs the retained cancellation fee.
      const order = await repo.findById({ client, brand, id: cr.order_id });
      const accounting = require("../accounting/accounting.service");
      const saleJournal = await accounting.findEntryBySource({
        brand,
        source_type: "sales",
        source_id: cr.order_id,
      });
      const refundLines = salesPostings.buildCancellationRefundLines({
        order,
        fee_amount_ngn: cr.fee_amount_ngn,
        refund_amount_ngn: cr.refund_amount_ngn,
        revenueRecognised: Boolean(saleJournal),
        reference: order.order_number,
      });
      if (refundLines) {
        await accounting.postEntry({
          client,
          brand,
          user_id: user.user_id,
          entry: {
            source_type: "refund",
            source_table: "cancellation_requests",
            source_id: id,
            reference: order.order_number,
            description: `Cancellation refund — ${order.order_number}`,
            idempotency_key: `cancellation_refund:${id}`,
          },
          lines: refundLines,
        });
      }
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

// Human-facing day label on receipt/quotation PDF meta rows → DD/MM/YYYY.
const _dayISO = (v) => formatDate(v);

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
    // A USD order settled in dollars prints what the customer actually paid.
    paid_in: (() => {
      const paid = paidCurrency.paidCurrencyDisplay(payments);
      return paid
        ? {
            label: `Paid in ${paid.display_currency}`,
            value: paidCurrency.formatMoney(
              paid.display_amount,
              paid.display_currency,
            ),
          }
        : null;
    })(),
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
  getOrderServiceJob,
  receiptPdf,
  archiveReceiptPdf,
  exportSalesReport,
  createOrder,
  updateOrder,
  addPayment,
  // Exported for the amendment reconciler (amendment.service): a change that
  // makes an unsettled order cheaper than what has already been paid settles
  // it, and that must run the same stock draw + order.paid fan-out a final
  // payment would. Runs on the caller's client, inside their transaction.
  markPaid,
  recordSubscriptionCharge,
  cancelOrder, // orders are cancelled (the 'archive' equivalent), never hard-deleted
  restoreOrder, // un-cancel from the archive: re-holds stock, refuses forfeited deposits
  setOrderStatus,
  setSpecificInstructions,
  getStatusAutomationStates,
  listQuotations,
  getQuotation,
  quotationPdf,
  createQuotation,
  sendQuotation,
  decideQuotation,
  convertQuotation,
  ensureQuotationOrder,
  listCancellations,
  getCancellation,
  requestCancellation,
  reviewCancellation,
  setDeliveryFee,
  // Exported for scripts/backfill-partial-paid-studio-jobs.js (000393): the
  // one-off pass that draws stock for orders that were already sitting at
  // partially_paid before this change shipped, using the exact same engine
  // addPayment now calls on a fresh first payment. Runs on the caller's
  // client, inside their own transaction.
  drawStockForOrder,
  recordStockShortfall,
};
