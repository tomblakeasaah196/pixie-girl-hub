"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  CreditCard,
  Gift,
  Lock,
  MapPin,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldCheck,
  Store,
  Tag,
  Truck,
} from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { fbTrack } from "@/lib/fbpixel";
import { displayMoney } from "@/lib/format";
import { useDisplayCurrency } from "@/lib/currency";
import { postCheckout, postQuote, type CartQuote } from "@/lib/api-client";
import {
  fetchGeoOptions,
  fetchPickupAddress,
  fetchDeliveryQuote,
  GEO_FALLBACK,
  type GeoOption,
  type GeoOptions,
  type PickupAddress,
  type DeliveryFeeStatus,
} from "@/lib/geo";
import type { LandingPayload } from "@/lib/types";

type Fulfilment = "delivery" | "pickup";

type Gateway = "paystack" | "nomba";

export function CheckoutClient({ payload }: { payload: LandingPayload }) {
  const router = useRouter();
  const items = useCart((s) => s.items);
  // Local line-sum — an instant optimistic figure used only while the
  // server quote is in flight.
  const subtotal = useCart((s) => s.subtotalNgn());

  const brandKey = payload.brand?.business_key;

  // Meta Pixel: InitiateCheckout — once, when the buyer lands on checkout with
  // items. Reads the cart store directly (not the reactive selectors) so it
  // captures the cart at entry and never re-fires on quote/currency updates.
  const checkoutTracked = useRef(false);
  useEffect(() => {
    if (checkoutTracked.current) return;
    const cart = useCart.getState();
    const lines = cart.items;
    if (lines.length === 0) return;
    checkoutTracked.current = true;
    fbTrack("InitiateCheckout", {
      content_type: "product",
      content_ids: lines.map((i) => i.product_id || i.bundle_id || i.id),
      contents: lines.map((i) => ({ id: i.id, quantity: i.quantity })),
      num_items: cart.totalQty(),
      value: cart.subtotalNgn(),
      currency: "NGN",
    });
  }, []);

  // Display currency (₦/$) — driven by React, NOT the live page's DOM observer
  // (which never ran here and raced async figures into a mixed ₦/$ state). The
  // choice is cached per session, so it carries from the live page and survives
  // a refresh. Every figure in the summary is converted through `fmt` with the
  // campaign's static rate, so the screen is always internally consistent.
  const fxRate = payload.ngn_per_usd_rate ?? null;
  const hasRate = typeof fxRate === "number" && fxRate > 0;
  const [currency, setCurrency] = useDisplayCurrency();
  // Force NGN display when the campaign has no rate (the toggle is hidden).
  const displayCurrency = hasRate ? currency : "NGN";
  const fmt = (ngn: number) => displayMoney(ngn, displayCurrency, fxRate);

  // Server-authoritative quote: the Hub runs the FULL deal engine (per-wig
  // position ladder, bundle stacking bonus, quantity-tier ladder,
  // reseller/bulk tiers, per-bundle campaign price) — exactly what the cart
  // drawer shows and exactly what checkout charges. The form must never
  // recompute the discount on the client; it renders what the Hub returns.
  // (Previously this form summed line prices and ignored every campaign
  // discount, so the displayed Total — and the "Pay" button — showed the
  // full, undiscounted amount.)
  const [quote, setQuote] = useState<CartQuote | null>(null);

  // Gateways this campaign offers. Absent/empty → both rails (older campaigns).
  // The owner can turn a rail off per campaign in the builder.
  const allowedGateways: Gateway[] =
    payload.allowed_payment_gateways && payload.allowed_payment_gateways.length
      ? payload.allowed_payment_gateways
      : ["paystack", "nomba"];

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+234 ");
  const [insta, setInsta] = useState("");

  // Fulfilment: ship to address, or collect in store.
  const [fulfilment, setFulfilment] = useState<Fulfilment>("delivery");

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  // City is free text for non-Lagos; the Lagos LGA picker fills it.
  const [city, setCity] = useState("");
  // State is the NG-states picker for Nigeria, free text elsewhere.
  const [state, setState] = useState("");
  // Country defaults to Nigeria (most buyers); fully searchable.
  const [country, setCountry] = useState("Nigeria");
  const [countryCode, setCountryCode] = useState("NG");
  // The delivery-zone code that prices the order: NG state ("NG-AB") or Lagos
  // LGA ("NG-LA-AGEGE"); for international it's the ISO-2 country code.
  const [zoneCode, setZoneCode] = useState("");

  // Geo picker data + the live delivery quote.
  const [geo, setGeo] = useState<GeoOptions | null>(null);
  const [pickupAddr, setPickupAddr] = useState<PickupAddress | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [deliveryZoneName, setDeliveryZoneName] = useState<string | null>(null);
  // 'free' → intentional ₦0 (promo); 'pending' → ₦0 we'll confirm before
  // dispatch; 'priced' → real fee; 'unserviceable' → no zone (blocks checkout).
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryFeeStatus | null>(null);
  const [quoting, setQuoting] = useState(false);
  // Use useTransition to defer geo/pickup updates so they don't block renders.
  const [, startTransition] = useTransition();

  const [notes, setNotes] = useState("");
  const [isGift, setIsGift] = useState(false);
  const [giftName, setGiftName] = useState("");
  const [giftPhone, setGiftPhone] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState(false);
  const [waOpt, setWaOpt] = useState(false);
  const [mktOpt, setMktOpt] = useState(false);
  const [terms, setTerms] = useState(false);
  const [honey, setHoney] = useState(""); // honeypot
  const [gateway, setGateway] = useState<Gateway>(allowedGateways[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{
    message: string;
    retryable: boolean;
    reference?: string;
    order_id?: string;
    support?: { whatsapp?: string; email?: string; message?: string } | null;
  } | null>(null);
  const errRef = useRef<HTMLDivElement | null>(null);

  // Near-duplicate guard: when the server returns POTENTIAL_DUPLICATE, hold
  // the pending checkout payload here so the user can confirm before we retry
  // with force_new_order = true.
  type DupOrder = { order_id: string; order_number: string; total_ngn: string; created_at: string };
  const [dupOrders, setDupOrders] = useState<DupOrder[] | null>(null);
  const [pendingCheckoutPayload, setPendingCheckoutPayload] = useState<Parameters<typeof postCheckout>[0] | null>(null);

  // Never let a failure be silent — pull the error into view next to the
  // Pay button the moment it is set.
  useEffect(() => {
    if (err && errRef.current) {
      errRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [err]);

  // Cart signature — identifies "the same cart" across renders AND across the
  // gateway round-trip (Pay → gateway → Back). Drives a STABLE idempotency key.
  const cartSig = useMemo(
    () =>
      items
        .map((i) => `${i.id}:${i.quantity}:${i.unstyled ? "raw" : "styled"}`)
        .join("|"),
    [items],
  );

  // Idempotency key persisted in sessionStorage, keyed to the cart signature.
  // The bug it fixes: the key used to be minted fresh on every page load
  // (`Date.now()`), so paying → Nomba → Back → paying again created a SECOND
  // order. Now the same cart in the same browser session reuses ONE key, so the
  // Hub returns the existing order (and a fresh pay link) instead of duplicating
  // it. Changing the cart yields a new key (a genuinely different order).
  const idemKey = useMemo(() => {
    const fresh = () =>
      `pgh-${payload.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (typeof window === "undefined" || !cartSig) return fresh();
    const storeKey = `pgh-idem-${payload.slug}`;
    try {
      const raw = sessionStorage.getItem(storeKey);
      if (raw) {
        const saved = JSON.parse(raw) as { sig?: string; key?: string };
        if (saved.sig === cartSig && saved.key) return saved.key;
      }
      const key = fresh();
      sessionStorage.setItem(storeKey, JSON.stringify({ sig: cartSig, key }));
      return key;
    } catch {
      return fresh();
    }
  }, [payload.slug, cartSig]);
  const empty = items.length === 0;

  // Re-quote (debounced) whenever the cart contents change — same contract as
  // the cart drawer so the two screens always show the same number.
  const quoteKey = cartSig;
  useEffect(() => {
    if (items.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const q = await postQuote({
        slug: payload.slug,
        cart: items.map((i) => ({
          bundle_id: i.bundle_id,
          product_id: i.product_id,
          styled_variant_id: i.styled_variant_id,
          unstyled: i.unstyled,
          quantity: i.quantity,
        })),
      });
      if (!cancelled) setQuote(q);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [quoteKey, items, payload.slug]);

  // Derived discount figures from the server quote (mirrors CartDrawer). While
  // the quote is in flight we fall back to the raw line-sum so the summary is
  // never blank — it just briefly shows the pre-discount figure, then settles.
  const n = (v: string | number | undefined) => Number(v ?? 0) || 0;
  const quotedSubtotal = quote ? n(quote.subtotal_ngn) : subtotal;
  const totalDiscount = quote ? n(quote.total_discount_ngn) : 0;
  // The discounted goods total (before delivery) — what the buyer actually pays
  // for the items. Matches the drawer's "Checkout · …" figure.
  const discountedGoods = quote ? n(quote.final_total_ngn) : subtotal;
  // Exit-intent "stay" code (a campaign promo, not a coupon). The landing
  // payload carries the campaign's exit_intent_code + ₦ amount; when the buyer
  // applies a promo that matches it, reflect the saving in the summary so the
  // displayed total matches what the server charges. The Hub is authoritative
  // (it re-clamps the amount at the §6.25 margin floor); this is the matching
  // client-side display.
  const exitCode = (payload.exit_intent_code || "").trim().toUpperCase();
  const exitAmtRaw = Number(payload.exit_intent_discount_ngn || 0) || 0;
  const exitIntentApplied =
    promoApplied &&
    exitCode.length > 0 &&
    exitAmtRaw > 0 &&
    promoCode.trim().toUpperCase() === exitCode;
  const exitIntentDiscount = exitIntentApplied
    ? Math.min(exitAmtRaw, discountedGoods)
    : 0;
  const comps = quote?.components;
  const dealRows: Array<{ label: string; amount: number }> = [];
  if (comps) {
    if (comps.position_ladder.applied)
      dealRows.push({
        label: "Multi-wig discount",
        amount: n(comps.position_ladder.discount_ngn),
      });
    if (comps.stacking_bonus.applied)
      dealRows.push({
        label: comps.stacking_bonus.label || "Bundle bonus",
        amount: n(comps.stacking_bonus.discount_ngn),
      });
    if (comps.quantity_tier.applied)
      dealRows.push({
        label: comps.quantity_tier.label || "Quantity discount",
        amount: n(comps.quantity_tier.discount_ngn),
      });
    if (comps.bulk_tier.applied)
      dealRows.push({
        label: comps.bulk_tier.label || "Reseller / bulk",
        amount: n(comps.bulk_tier.discount_ngn),
      });
  }

  // ── Geo-conditional autofill state ───────────────────────
  const countries = geo?.countries ?? GEO_FALLBACK.countries;
  const ngStates = geo?.nigeria_states ?? GEO_FALLBACK.nigeria_states;
  const lagosLgas = geo?.lagos_lgas ?? GEO_FALLBACK.lagos_lgas;
  const norm = (s: string) => s.trim().toLowerCase();
  const isNigeria = country === "Nigeria" || countryCode === "NG";
  const isLagos = isNigeria && norm(state) === "lagos";
  // Total wigs in the basket drive the delivery tier (1–2 / 3–4 / 5–6 / +2).
  const wigQty = items.reduce((s, i) => s + i.quantity, 0);
  // Resolve the delivery zone even when the buyer TYPED a location that exactly
  // matches a known option but didn't tap the dropdown item. Otherwise a
  // typed-but-unselected location leaves the zone blank and silently blocks
  // "Pay" ("pick from the list") — a top drop-off. Exact, case-insensitive
  // match only, so we never guess the wrong zone. Lagos still needs an LGA (the
  // state code NG-LA alone is not a deliverable zone).
  const resolvedCountryCode =
    countryCode ||
    countries.find((o) => norm(o.name) === norm(country))?.code ||
    "";
  const resolvedNgZone = zoneCode
    ? zoneCode
    : !isNigeria
      ? ""
      : isLagos
        ? lagosLgas.find((o) => norm(o.name) === norm(city))?.code || ""
        : ngStates.find((o) => norm(o.name) === norm(state))?.code || "";
  // The zone the fee resolves against: NG → state/LGA code; else ISO-2 country.
  const effectiveZone = isNigeria ? resolvedNgZone : resolvedCountryCode;

  // Load picker options + the in-store pickup address once per brand.
  // Use startTransition to defer these updates so they don't block form render.
  useEffect(() => {
    let alive = true;
    fetchGeoOptions(brandKey).then((g) => {
      if (alive) startTransition(() => setGeo(g));
    });
    fetchPickupAddress(brandKey).then((p) => {
      if (alive) startTransition(() => setPickupAddr(p));
    });
    return () => {
      alive = false;
    };
  }, [brandKey, startTransition]);

  // Re-quote the delivery fee whenever the zone or basket size changes.
  useEffect(() => {
    if (fulfilment !== "delivery" || !effectiveZone) {
      setDeliveryFee(null);
      setDeliveryZoneName(null);
      setDeliveryStatus(null);
      setQuoting(false);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    fetchDeliveryQuote({ brand: brandKey, zoneCode: effectiveZone, qty: wigQty })
      .then((q) => {
        if (cancelled) return;
        setDeliveryFee(q?.fee_ngn ?? null);
        setDeliveryZoneName(q?.zone_name ?? null);
        setDeliveryStatus(q?.fee_status ?? null);
      })
      .finally(() => {
        if (!cancelled) setQuoting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fulfilment, effectiveZone, wigQty, brandKey]);

  // Delivery due now (pickup is free; an uncovered zone falls back to 0 and the
  // copy reads "calculated at fulfilment").
  const deliveryDue =
    fulfilment === "delivery" && deliveryFee != null ? deliveryFee : 0;
  // Total = discounted goods (server quote) + delivery. This is the figure the
  // gateway actually charges, so the "Pay" button and the order it creates now
  // agree to the naira.
  const total = discountedGoods + deliveryDue - exitIntentDiscount;

  // Right-hand summary label for the delivery line. A resolved zone can be a
  // real fee, an intentional ₦0 (promo → "Free delivery") or a ₦0 we'll confirm
  // before dispatch ("Confirmed before dispatch"). Only an unresolved location
  // shows the prompt to pick one.
  const deliveryLabel =
    fulfilment === "pickup"
      ? "Free"
      : quoting
        ? "Calculating…"
        : deliveryStatus === "free"
          ? "Free delivery"
          : deliveryStatus === "pending"
            ? "Confirmed before dispatch"
            : deliveryFee != null
              ? fmt(deliveryFee)
              : effectiveZone
                ? "Check location"
                : "Select location";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (honey) return; // bot
    if (!terms) {
      setErr({ message: "Please accept the terms to continue.", retryable: false });
      return;
    }
    if (!first || !email || !phone) {
      setErr({ message: "Please fill in all required fields.", retryable: false });
      return;
    }
    if (fulfilment === "delivery") {
      if (!addressLine1 || !city) {
        setErr({
          message: "Please enter your delivery address.",
          retryable: false,
        });
        return;
      }
      if (isNigeria && !state) {
        setErr({ message: "Please select your state.", retryable: false });
        return;
      }
      if (isLagos && !zoneCode) {
        setErr({ message: "Please select your city / LGA.", retryable: false });
        return;
      }
      // The location must have RESOLVED to a billable zone. Typing a country /
      // state (or browser autofill) without picking it from the list leaves
      // `effectiveZone` blank — the visible address looks complete but we have
      // no zone to price. Never let that pay ₦0 delivery.
      if (!effectiveZone) {
        setErr({
          message: isNigeria
            ? "Please pick your state from the list (and your LGA for Lagos) so we can calculate delivery."
            : "Please pick your country from the list so we can calculate delivery.",
          retryable: false,
        });
        return;
      }
      // Quote still in flight — wait for the fee rather than submitting blind.
      if (quoting) {
        setErr({
          message: "Calculating delivery… give it a second, then tap Pay again.",
          retryable: true,
        });
        return;
      }
      // Zone resolved but priced to nothing (uncovered / unseeded). The server
      // also blocks this, but stop it here so the buyer gets a clear prompt
      // instead of a rejected payment.
      if (deliveryFee == null) {
        setErr({
          message:
            "We couldn't calculate delivery for that location. Please re-check your country, state and city.",
          retryable: false,
        });
        return;
      }
    }
    setBusy(true);
    // Declared outside try so the catch block can reuse it for the
    // near-duplicate "Place new order" retry.
    let checkoutPayload: Parameters<typeof postCheckout>[0] | null = null;
    try {
      const giftPayload = isGift
        ? {
            recipient_name: giftName,
            recipient_phone: giftPhone || undefined,
            message: giftMessage || undefined,
          }
        : undefined;

      // Build the full payload once so the near-duplicate "Place new order"
      // retry can resend the EXACT same order (address, consent, cart and all)
      // — the server re-prices delivery off this address and now refuses an
      // order it can't bill, so the retry must carry the same complete payload.
      checkoutPayload = {
        slug: payload.slug,
        contact: {
          first_name: first,
          last_name: last,
          email,
          phone,
          instagram_handle: insta || undefined,
          notes: notes || undefined,
          gift: giftPayload,
          address:
            fulfilment === "delivery"
              ? {
                  line1: addressLine1,
                  line2: addressLine2 || undefined,
                  city,
                  state: state || undefined,
                  country,
                  country_code: resolvedCountryCode || undefined,
                  zone_code: effectiveZone || undefined,
                }
              : undefined,
          consent: {
            whatsapp_opt_in: waOpt,
            marketing_opt_in: mktOpt,
            terms_accepted: true,
          },
        },
        fulfilment_type: fulfilment,
        cart: items.map((i) => ({
          bundle_id: i.bundle_id,
          product_id: i.product_id,
          styled_variant_id: i.styled_variant_id,
          unstyled: i.unstyled,
          quantity: i.quantity,
          unit_price_ngn: i.unit_price_ngn,
        })),
        utm: readUtm(),
        payment_gateway: gateway,
        // Drives gateway routing on the Hub (USD → Nomba). The order still
        // settles in NGN; this is the buyer's displayed-currency choice.
        display_currency: displayCurrency,
        client_idempotency_key: idemKey,
        coupon_code: promoApplied && promoCode ? promoCode : undefined,
      };

      const res = await postCheckout(checkoutPayload);
      const data = (res as { data?: { payment_url?: string; order_id?: string } })?.data;
      const payUrl = data?.payment_url ?? (res as { payment_url?: string }).payment_url;
      const orderId = data?.order_id ?? (res as { order_id?: string }).order_id;

      if (orderId) {
        sessionStorage.setItem("pgh-last-order-id", orderId);
      }
      if (payUrl) {
        window.location.href = payUrl;
      } else {
        router.push(`/checkout/${payload.slug}/thank-you${orderId ? `?order_id=${orderId}` : ""}`);
      }
    } catch (e) {
      const ex = e as Error & {
        code?: string;
        retryable?: boolean;
        reference?: string;
        order_id?: string;
        support?: { whatsapp?: string; email?: string; message?: string } | null;
        existing_orders?: DupOrder[] | null;
      };
      if (ex?.code === "POTENTIAL_DUPLICATE" && ex.existing_orders?.length && checkoutPayload) {
        // Hold the exact payload so "Place new order" can resend it verbatim.
        setPendingCheckoutPayload(checkoutPayload);
        setDupOrders(ex.existing_orders);
        setBusy(false);
        return;
      }
      setErr({
        message: ex?.message || "Checkout failed. Please try again.",
        retryable: ex?.retryable !== false,
        reference: ex?.reference,
        order_id: ex?.order_id,
        support: ex?.support ?? null,
      });
    } finally {
      setBusy(false);
    }
  }

  if (empty) {
    return (
      <main className="min-h-screen grid place-items-center px-6 py-16">
        <div className="glass rounded-[var(--radius)] p-8 max-w-md text-center">
          <h1 className="font-display text-2xl">Your cart is empty.</h1>
          <Link
            href={`/sale/${payload.slug}`}
            className="mt-4 inline-flex h-11 px-5 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
          >
            Back to the sale →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto max-w-[1080px] px-6 md:px-10 pt-10">
        <Link
          href={`/sale/${payload.slug}`}
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to the sale
        </Link>
        <h1 className="font-display text-[36px] md:text-[44px] leading-tight mt-3">
          Almost{" "}
          <em className="not-italic md:italic text-[rgb(var(--accent-readable))]">
            yours.
          </em>
        </h1>

        <form
          id="checkout-form"
          onSubmit={submit}
          className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6"
        >
          <div className="space-y-5">
            <Section title="Contact">
              <Row>
                <Field label="First name" required>
                  <Input
                    value={first}
                    onChange={setFirst}
                    autoComplete="given-name"
                    required
                  />
                </Field>
                <Field label="Last name" required>
                  <Input
                    value={last}
                    onChange={setLast}
                    autoComplete="family-name"
                    required
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Email" required>
                  <Input
                    type="email"
                    value={email}
                    onChange={setEmail}
                    autoComplete="email"
                    required
                  />
                </Field>
                <Field label="Phone (with country code)" required>
                  <Input
                    value={phone}
                    onChange={setPhone}
                    autoComplete="tel"
                    required
                  />
                </Field>
              </Row>
              <Field label="Instagram handle (optional)">
                <Input
                  value={insta}
                  onChange={setInsta}
                  placeholder="@yourhandle"
                />
              </Field>
            </Section>

            <Section title="Fulfilment">
              {/* Deliver-to-me vs collect-in-store */}
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { v: "delivery", label: "Deliver to me", desc: "Ship to your address", icon: Truck },
                    { v: "pickup", label: "Pick up", desc: "Collect from our store", icon: Store },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setFulfilment(opt.v)}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      fulfilment === opt.v
                        ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)]"
                        : "border-[rgb(var(--border-c)/0.12)]"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <opt.icon className="w-3.5 h-3.5 text-[rgb(var(--accent-readable))]" />
                      {opt.label}
                    </span>
                    <span className="block text-[11px] text-[rgb(var(--text-faint))] mt-0.5">
                      {opt.desc}
                    </span>
                  </button>
                ))}
              </div>

              {fulfilment === "delivery" ? (
                <div id="delivery-address" className="space-y-3 pt-1">
                  {/* Country — searchable, choose from the dropdown */}
                  <Field label="Country" required>
                    <ComboBox
                      options={countries}
                      value={country}
                      onChange={(name) => {
                        setCountry(name);
                        setCountryCode("");
                        setState("");
                        setCity("");
                        setZoneCode("");
                      }}
                      onSelect={(item) => {
                        setCountry(item.name);
                        setCountryCode(item.code);
                        setState("");
                        setCity("");
                        // Non-NG: the country IS the delivery zone (DHL). NG:
                        // wait for the state pick to resolve the zone.
                        setZoneCode(item.code === "NG" ? "" : item.code);
                      }}
                      placeholder="Start typing your country…"
                    />
                  </Field>

                  {/* State — Nigeria gets an autofill picker; every other
                      country free-types its region. */}
                  {isNigeria ? (
                    <Field label="State" required>
                      <ComboBox
                        options={ngStates}
                        value={state}
                        onChange={(name) => {
                          setState(name);
                          setZoneCode("");
                          setCity("");
                        }}
                        onSelect={(item) => {
                          setState(item.name);
                          setCity("");
                          // Lagos is served via its LGAs — wait for the LGA.
                          setZoneCode(item.name === "Lagos" ? "" : item.code);
                        }}
                        placeholder="Select your state…"
                      />
                    </Field>
                  ) : (
                    country && (
                      <Field label="State / Province">
                        <Input
                          value={state}
                          onChange={setState}
                          placeholder="State or province"
                        />
                      </Field>
                    )
                  )}

                  {/* City — Lagos gets the LGA picker; everywhere else
                      free-types the city. */}
                  {isLagos ? (
                    <Field label="City / LGA" required>
                      <ComboBox
                        options={lagosLgas}
                        value={city}
                        onChange={(name) => {
                          setCity(name);
                          setZoneCode("");
                        }}
                        onSelect={(item) => {
                          setCity(item.name);
                          setZoneCode(item.code);
                        }}
                        placeholder="Select your LGA…"
                      />
                    </Field>
                  ) : (
                    <Field label="City" required>
                      <Input
                        value={city}
                        onChange={setCity}
                        required
                        placeholder="City / town"
                      />
                    </Field>
                  )}

                  <Field label="Address line 1" required>
                    <Input
                      value={addressLine1}
                      onChange={setAddressLine1}
                      required
                      placeholder="House number and street"
                    />
                  </Field>
                  <Field label="Address line 2">
                    <Input
                      value={addressLine2}
                      onChange={setAddressLine2}
                      placeholder="Apartment, landmark (optional)"
                    />
                  </Field>

                  <Field label="Order notes (optional)">
                    <Textarea
                      value={notes}
                      onChange={setNotes}
                      placeholder="Leave with the security guard, for my sister's birthday, etc."
                    />
                  </Field>
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  <div className="rounded-xl border border-[rgb(var(--border-c)/0.12)] bg-[rgb(var(--text)/0.03)] px-4 py-3">
                    <p className="micro mb-1.5 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[rgb(var(--accent-readable))]" />
                      Pickup location
                    </p>
                    {pickupAddr?.address ? (
                      <>
                        <p className="text-[14px] leading-snug whitespace-pre-line">
                          {pickupAddr.address}
                        </p>
                        {pickupAddr.phone && (
                          <p className="text-[12px] text-[rgb(var(--text-muted))] mt-1 inline-flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {pickupAddr.phone}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-[13px] text-[rgb(var(--text-faint))] italic">
                        We&apos;ll share the pickup address and collection time
                        right after you order.
                      </p>
                    )}
                  </div>
                  <Field label="Order notes (optional)">
                    <Textarea
                      value={notes}
                      onChange={setNotes}
                      placeholder="Anything we should know…"
                    />
                  </Field>
                </div>
              )}
            </Section>

            <Section title="Gift order?">
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={isGift}
                  onChange={(e) => setIsGift(e.target.checked)}
                  className="accent-[rgb(var(--accent-deep))]"
                />
                <Gift className="w-3.5 h-3.5 text-[rgb(var(--accent-readable))]" />
                <span>Yes — this is a gift</span>
              </label>
              {isGift && (
                <div className="mt-3 space-y-3">
                  <Row>
                    <Field label="Recipient name" required>
                      <Input value={giftName} onChange={setGiftName} />
                    </Field>
                    <Field label="Recipient phone">
                      <Input value={giftPhone} onChange={setGiftPhone} />
                    </Field>
                  </Row>
                  <Field label="Gift message">
                    <Textarea value={giftMessage} onChange={setGiftMessage} />
                  </Field>
                  <p className="text-[13px] mt-2 text-red-600 leading-snug">
                    Shipped to the address above.{" "}
                    <a
                      href="#delivery-address"
                      className="underline underline-offset-2 hover:opacity-80"
                      onClick={(e) => {
                        e.preventDefault();
                        document
                          .getElementById("delivery-address")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      Want to change the address?
                    </a>
                  </p>
                </div>
              )}
            </Section>

            <Section title="Pay with">
              <div
                className={`grid gap-2 ${
                  allowedGateways.length > 1 ? "grid-cols-2" : "grid-cols-1"
                }`}
              >
                {allowedGateways.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGateway(g)}
                    className={`p-3 rounded-xl border text-[13px] font-semibold capitalize ${
                      gateway === g
                        ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)] text-[rgb(var(--accent-readable))]"
                        : "border-[rgb(var(--border-c)/0.1)] text-[rgb(var(--text-muted))]"
                    }`}
                  >
                    {g === "paystack" ? "Paystack" : "Nomba"}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Consent &amp; terms">
              <Toggle
                label="Send me sale-day updates on WhatsApp"
                checked={waOpt}
                onChange={setWaOpt}
              />
              <Toggle
                label="Sign me up for the newsletter"
                checked={mktOpt}
                onChange={setMktOpt}
              />
              <Toggle
                label="I accept the terms and privacy policy"
                checked={terms}
                onChange={setTerms}
                required
              />
              {/* Honeypot — hidden anti-bot field */}
              <label className="hidden" aria-hidden>
                Leave this empty
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honey}
                  onChange={(e) => setHoney(e.target.value)}
                />
              </label>
            </Section>

            {err && !err.retryable && (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-xl border border-[rgb(var(--danger)/0.35)] bg-[rgb(var(--danger)/0.08)] px-4 py-3 text-[13px] text-[rgb(var(--danger))]"
              >
                {err.message}
              </div>
            )}
          </div>

          {/* data-no-convert: this summary converts currency in React (below).
              It guards against any stray DOM currency observer double-converting
              these figures into a mixed ₦/$ state. */}
          <aside className="lg:sticky lg:top-6 h-fit" data-no-convert>
            <div className="glass rounded-[var(--radius)] p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-[20px]">Order summary</h3>
                {hasRate && (
                  <div
                    className="inline-flex items-center rounded-full border border-[rgb(var(--border-c)/0.15)] p-0.5 text-[12px] font-semibold"
                    role="group"
                    aria-label="Display currency"
                  >
                    {(["NGN", "USD"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCurrency(c)}
                        aria-pressed={displayCurrency === c}
                        className={`h-7 w-9 rounded-full transition-colors ${
                          displayCurrency === c
                            ? "bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))]"
                            : "text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]"
                        }`}
                      >
                        {c === "NGN" ? "₦" : "$"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <ul className="space-y-2.5">
                {items.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 text-[13px]">
                    <div className="font-mono text-[rgb(var(--text-faint))] tabular-nums">
                      ×{i.quantity}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-semibold">{i.name}</div>
                      {i.variant_label && (
                        <div className="truncate text-[11px] text-[rgb(var(--text-muted))]">
                          {i.variant_label}
                        </div>
                      )}
                      {i.preorder ? (
                        <div className="text-[11px] text-[rgb(var(--warn))]">
                          Out of stock · pre-order ships in{" "}
                          {i.preorder_lead_weeks ?? 3} weeks
                        </div>
                      ) : (
                        i.delivery_weeks != null &&
                        i.delivery_weeks > 0 && (
                          <div className="text-[11px] text-[rgb(var(--text-faint))]">
                            Delivery in {i.delivery_weeks} week
                            {i.delivery_weeks !== 1 ? "s" : ""}
                          </div>
                        )
                      )}
                    </div>
                    <div className="tabular-nums font-mono">
                      {fmt(i.unit_price_ngn * i.quantity)}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="border-t hairline pt-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[rgb(var(--text-muted))]">
                    Subtotal
                  </span>
                  <span className="tabular-nums font-mono">
                    {fmt(quotedSubtotal)}
                  </span>
                </div>
                {dealRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex justify-between text-[rgb(var(--success))]"
                  >
                    <span>{row.label}</span>
                    <span className="tabular-nums font-mono">
                      −{fmt(row.amount)}
                    </span>
                  </div>
                ))}
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-[rgb(var(--success))] font-semibold">
                    <span>You save</span>
                    <span className="tabular-nums font-mono">
                      −{fmt(totalDiscount)}
                    </span>
                  </div>
                )}
                {exitIntentDiscount > 0 && (
                  <div className="flex justify-between text-[rgb(var(--success))] font-semibold">
                    <span className="inline-flex items-center gap-1">
                      <Gift className="w-3 h-3" /> Code {promoCode}
                    </span>
                    <span className="tabular-nums font-mono">
                      −{fmt(exitIntentDiscount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[rgb(var(--text-muted))] inline-flex items-center gap-1">
                    {fulfilment === "pickup" ? (
                      <Store className="w-3 h-3" />
                    ) : (
                      <Truck className="w-3 h-3" />
                    )}
                    Delivery
                  </span>
                  <span className="tabular-nums font-mono">{deliveryLabel}</span>
                </div>
                {/* White-glove notice when the zone resolved but couldn't be
                    priced (₦0, no free-delivery marker). The order is taken;
                    the rate is confirmed before dispatch. Framed as premium
                    service, not a system error. */}
                {fulfilment === "delivery" && deliveryStatus === "pending" && (
                  <div className="mt-1 rounded-lg border border-[rgb(var(--accent)/0.25)] bg-[rgb(var(--accent)/0.06)] px-3 py-2">
                    <p className="text-[12px] leading-snug text-[rgb(var(--text-muted))]">
                      <span className="font-semibold text-[rgb(var(--text))]">
                        Delivery confirmed before dispatch.
                      </span>{" "}
                      Your order is secured. Because you&apos;re in a special
                      delivery area, our team will confirm the exact delivery
                      rate and share your final total before we ship — nothing
                      else to do right now.
                    </p>
                  </div>
                )}
              </div>
              {/* Promo code */}
              <div className="border-t hairline pt-3">
                {!promoOpen ? (
                  <button
                    type="button"
                    onClick={() => setPromoOpen(true)}
                    className="inline-flex items-center gap-1.5 text-[12px] text-[rgb(var(--accent-readable))] font-semibold hover:underline"
                  >
                    <Tag className="w-3 h-3" /> Have a promo code?{" "}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => {
                        setPromoCode(e.target.value.toUpperCase());
                        setPromoApplied(false);
                      }}
                      placeholder="Enter code"
                      className="flex-1 h-9 px-3 rounded-lg bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.5)] text-[13px] font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (promoCode.trim()) setPromoApplied(true);
                      }}
                      disabled={!promoCode.trim()}
                      className="h-9 px-3 rounded-lg bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] text-[12px] font-semibold disabled:opacity-40"
                    >
                      Apply
                    </button>
                  </div>
                )}
                {promoApplied && (
                  <div className="mt-1.5 flex items-center gap-1 text-[12px] text-[rgb(var(--success))]">
                    <Check className="w-3 h-3" /> Code{" "}
                    <span className="font-mono font-semibold">{promoCode}</span>{" "}
                    {exitIntentApplied
                      ? `— ${fmt(exitIntentDiscount)} off`
                      : "will be applied"}
                  </div>
                )}
              </div>

              <div className="border-t hairline pt-3 flex justify-between items-baseline">
                <span className="font-semibold">Total</span>
                <span className="font-display text-[22px] tabular-nums">
                  {fmt(total)}
                </span>
              </div>
              {/* Near-duplicate warning — shown instead of the normal error */}
              {dupOrders && dupOrders.length > 0 && (
                <div
                  role="alert"
                  className="rounded-xl border border-amber-500/40 bg-amber-500/8 px-4 py-3 space-y-3"
                >
                  <p className="text-[13px] font-semibold text-amber-400 leading-snug">
                    You have a recent pending order
                  </p>
                  {dupOrders.map((o) => (
                    <p key={o.order_id} className="text-[12px] text-[rgb(var(--text-muted))]">
                      {o.order_number} &middot;{" "}
                      {displayMoney(Number(o.total_ngn))} &middot;{" "}
                      {new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  ))}
                  <p className="text-[12px] text-[rgb(var(--text-faint))]">
                    Is this the same order or a new one?
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setDupOrders(null)}
                      className="flex-1 h-9 rounded-lg border border-white/10 text-[12.5px] font-semibold text-[rgb(var(--text-muted))] hover:bg-white/5"
                    >
                      Same order
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (!pendingCheckoutPayload) return;
                        setDupOrders(null);
                        setBusy(true);
                        try {
                          const res = await postCheckout({
                            ...pendingCheckoutPayload,
                            force_new_order: true,
                          });
                          const data = (res as { data?: { payment_url?: string; order_id?: string } })?.data;
                          const payUrl = data?.payment_url ?? (res as { payment_url?: string }).payment_url;
                          const orderId = data?.order_id ?? (res as { order_id?: string }).order_id;
                          if (orderId) sessionStorage.setItem("pgh-last-order-id", orderId);
                          if (payUrl) window.location.href = payUrl;
                          else router.push(`/checkout/${payload.slug}/thank-you${orderId ? `?order_id=${orderId}` : ""}`);
                        } catch (e2) {
                          const ex2 = e2 as Error & { retryable?: boolean };
                          setErr({ message: (ex2 as Error).message || "Checkout failed.", retryable: ex2?.retryable !== false });
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="flex-1 h-9 rounded-lg bg-[rgb(var(--accent-deep))] text-[12.5px] font-semibold disabled:opacity-60"
                    >
                      {busy ? "Securing…" : "Place new order"}
                    </button>
                  </div>
                </div>
              )}
              {err && !dupOrders && (
                <div
                  ref={errRef}
                  role="alert"
                  aria-live="assertive"
                  className="rounded-xl border border-[rgb(var(--danger)/0.4)] bg-[rgb(var(--danger)/0.08)] px-4 py-3 space-y-2.5"
                >
                  {/* Icon + message */}
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[rgb(var(--danger))]" />
                    <p className="text-[13px] leading-snug text-[rgb(var(--danger))]">
                      {err.message}
                    </p>
                  </div>

                  {/* Order reference (so support can find the order) */}
                  {(err.order_id || err.reference) && (
                    <p className="text-[11px] text-[rgb(var(--text-faint))] font-mono pl-[26px]">
                      Ref: {err.order_id || err.reference}
                    </p>
                  )}

                  {/* WhatsApp / email support */}
                  {err.support?.whatsapp && (
                    <a
                      href={`https://wa.me/${err.support.whatsapp.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hi, I need help with my order. Ref: ${err.order_id || err.reference || ""}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-[12.5px] font-semibold text-[rgb(var(--success))] hover:underline pl-[26px]"
                    >
                      <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                      Chat with us on WhatsApp
                    </a>
                  )}

                  {/* Retry button (only when the action is safe to retry) */}
                  {err.retryable && (
                    <button
                      type="submit"
                      form="checkout-form"
                      disabled={busy}
                      className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] pl-[26px] disabled:opacity-50"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Try again
                    </button>
                  )}
                </div>
              )}
              <motion.button
                type="submit"
                whileTap={{ scale: 0.99 }}
                disabled={busy}
                className="btn-cta w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl font-semibold cta-sheen disabled:opacity-60"
              >
                {busy ? (
                  "Securing your order…"
                ) : (
                  <>
                    <Lock className="w-4 h-4" /> Pay {fmt(total)}
                  </>
                )}
              </motion.button>
              <div className="text-[11px] text-[rgb(var(--text-faint))] text-center inline-flex items-center justify-center gap-1 w-full">
                <ShieldCheck className="w-3 h-3 text-[rgb(var(--success))]" />{" "}
                {fulfilment === "pickup"
                  ? "Secure checkout · Collect in store"
                  : deliveryFee != null
                    ? "Secure checkout · Delivery included"
                    : "Secure checkout · Shipping calculated at fulfilment"}
              </div>
              <p className="text-[11px] text-[rgb(var(--text-faint))] text-center">
                <CreditCard className="inline w-3 h-3 mr-1" />
                You&apos;ll be redirected to your gateway.
              </p>
            </div>
          </aside>
        </form>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass rounded-[var(--radius)] p-5 space-y-3">
      <h3 className="font-display text-[18px]">{title}</h3>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="micro mb-1.5 block">
        {label}{" "}
        {required && <span className="text-[rgb(var(--accent-readable))]">*</span>}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className="w-full h-11 px-3.5 rounded-xl bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.5)] text-[14px]"
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      placeholder={placeholder}
      className="w-full px-3.5 py-2 rounded-xl bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.5)] text-[14px]"
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
  required,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  required?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-[13px] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required={required}
        className="mt-0.5 accent-[rgb(var(--accent-deep))]"
      />
      <span>
        {label}{" "}
        {required && <span className="text-[rgb(var(--accent-readable))]">*</span>}
        {checked && (
          <Check className="inline w-3 h-3 text-[rgb(var(--success))] ml-1" />
        )}
      </span>
    </label>
  );
}

/** Searchable autocomplete. Filters from the first character typed; the zone
 *  code is only committed via a dropdown pick (onSelect), so a typed-but-
 *  unselected value never resolves a delivery zone — "only from dropdown". */
function ComboBox({
  options,
  value,
  onChange,
  onSelect,
  placeholder,
}: {
  options: GeoOption[];
  value: string;
  onChange: (name: string) => void;
  onSelect: (item: GeoOption) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Stay in sync when the value is reset programmatically (country change).
  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered =
    q.length === 0
      ? options.slice(0, 8)
      : options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 30);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="w-full h-11 px-3.5 rounded-xl bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.5)] text-[14px]"
      />
      {open && (
        <ul className="absolute z-50 w-full mt-1 max-h-56 overflow-y-auto rounded-xl border border-[rgb(var(--border-c)/0.15)] bg-[rgb(var(--bg))] shadow-2xl">
          {filtered.length > 0 ? (
            filtered.map((item) => (
              <li
                key={item.code}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(item.name);
                  onSelect(item);
                  setOpen(false);
                }}
                className="px-3.5 py-2.5 text-[14px] hover:bg-[rgb(var(--text)/0.06)] cursor-pointer"
              >
                {item.name}
              </li>
            ))
          ) : (
            <li className="px-3.5 py-2.5 text-[13px] text-[rgb(var(--text-faint))]">
              No matches — check the spelling.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function readUtm(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ]) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out;
}
