"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { money } from "@/lib/format";
import { postCheckout } from "@/lib/api-client";
import {
  fetchGeoOptions,
  fetchPickupAddress,
  fetchDeliveryQuote,
  GEO_FALLBACK,
  type GeoOption,
  type GeoOptions,
  type PickupAddress,
} from "@/lib/geo";
import type { LandingPayload } from "@/lib/types";

type Fulfilment = "delivery" | "pickup";

type Gateway = "paystack" | "nomba";

export function CheckoutClient({ payload }: { payload: LandingPayload }) {
  const router = useRouter();
  const items = useCart((s) => s.items);
  const subtotal = useCart((s) => s.subtotalNgn());
  const retail = useCart((s) => s.retailSubtotalNgn());
  const savings = useCart((s) => s.savingsNgn());

  const brandKey = payload.brand?.business_key;

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
  const [quoting, setQuoting] = useState(false);

  const [notes, setNotes] = useState("");
  const [isGift, setIsGift] = useState(false);
  const [giftName, setGiftName] = useState("");
  const [giftPhone, setGiftPhone] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [shipToRecipient, setShipToRecipient] = useState(false);
  const [recipientLine1, setRecipientLine1] = useState("");
  const [recipientLine2, setRecipientLine2] = useState("");
  const [recipientCity, setRecipientCity] = useState("");
  const [recipientState, setRecipientState] = useState("Lagos");
  const [recipientCountry] = useState("Nigeria");
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState(false);
  const [waOpt, setWaOpt] = useState(false);
  const [mktOpt, setMktOpt] = useState(false);
  const [terms, setTerms] = useState(false);
  const [honey, setHoney] = useState(""); // honeypot
  const [gateway, setGateway] = useState<Gateway>("paystack");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{
    message: string;
    retryable: boolean;
    reference?: string;
    order_id?: string;
    support?: { whatsapp?: string; email?: string; message?: string } | null;
  } | null>(null);
  const errRef = useRef<HTMLDivElement | null>(null);

  // Never let a failure be silent — pull the error into view next to the
  // Pay button the moment it is set.
  useEffect(() => {
    if (err && errRef.current) {
      errRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [err]);

  const idemKey = useMemo(
    () =>
      `pgh-${payload.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    [payload.slug],
  );
  const empty = items.length === 0;

  // ── Geo-conditional autofill state ───────────────────────
  const countries = geo?.countries ?? GEO_FALLBACK.countries;
  const ngStates = geo?.nigeria_states ?? GEO_FALLBACK.nigeria_states;
  const lagosLgas = geo?.lagos_lgas ?? GEO_FALLBACK.lagos_lgas;
  const isNigeria = country === "Nigeria" || countryCode === "NG";
  const isLagos = isNigeria && state === "Lagos";
  // Total wigs in the basket drive the delivery tier (1–2 / 3–4 / 5–6 / +2).
  const wigQty = items.reduce((s, i) => s + i.quantity, 0);
  // The zone the fee resolves against: NG → state/LGA code; else ISO-2 country.
  const effectiveZone = isNigeria ? zoneCode : countryCode;

  // Load picker options + the in-store pickup address once per brand.
  useEffect(() => {
    let alive = true;
    fetchGeoOptions(brandKey).then((g) => alive && setGeo(g));
    fetchPickupAddress(brandKey).then((p) => alive && setPickupAddr(p));
    return () => {
      alive = false;
    };
  }, [brandKey]);

  // Re-quote the delivery fee whenever the zone or basket size changes.
  useEffect(() => {
    if (fulfilment !== "delivery" || !effectiveZone) {
      setDeliveryFee(null);
      setDeliveryZoneName(null);
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
  const total = subtotal + deliveryDue;

  // Right-hand summary label for the delivery line.
  const deliveryLabel =
    fulfilment === "pickup"
      ? "Free"
      : quoting
        ? "Calculating…"
        : deliveryFee != null
          ? money(deliveryFee)
          : effectiveZone
            ? "At fulfilment"
            : "—";

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
    }
    setBusy(true);
    try {
      const giftPayload = isGift
        ? {
            recipient_name: giftName,
            recipient_phone: giftPhone || undefined,
            message: giftMessage || undefined,
            ship_to_recipient: shipToRecipient || undefined,
            recipient_address:
              shipToRecipient
                ? {
                    line1: recipientLine1,
                    line2: recipientLine2 || undefined,
                    city: recipientCity,
                    state: recipientState || undefined,
                    country: recipientCountry,
                  }
                : undefined,
          }
        : undefined;

      const res = await postCheckout({
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
                  country_code: countryCode || undefined,
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
        display_currency: readDisplayCurrency(),
        client_idempotency_key: idemKey,
        coupon_code: promoApplied && promoCode ? promoCode : undefined,
      });
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
        retryable?: boolean;
        reference?: string;
        order_id?: string;
        support?: { whatsapp?: string; email?: string; message?: string } | null;
      };
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
          <em className="not-italic md:italic text-[rgb(var(--accent-glow))]">
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
                      <opt.icon className="w-3.5 h-3.5 text-[rgb(var(--accent-glow))]" />
                      {opt.label}
                    </span>
                    <span className="block text-[11px] text-[rgb(var(--text-faint))] mt-0.5">
                      {opt.desc}
                    </span>
                  </button>
                ))}
              </div>

              {fulfilment === "delivery" ? (
                <div className="space-y-3 pt-1">
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
                      <MapPin className="w-3.5 h-3.5 text-[rgb(var(--accent-glow))]" />
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
                <Gift className="w-3.5 h-3.5 text-[rgb(var(--accent-glow))]" />
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
                  <label className="flex items-center gap-2 text-[13px] mt-2">
                    <input
                      type="checkbox"
                      checked={shipToRecipient}
                      onChange={(e) => setShipToRecipient(e.target.checked)}
                      className="accent-[rgb(var(--accent-deep))]"
                    />
                    <MapPin className="w-3.5 h-3.5 text-[rgb(var(--accent-glow))]" />
                    <span>Ship directly to the recipient</span>
                  </label>
                  {shipToRecipient && (
                    <div className="mt-2 space-y-3 pl-1 border-l-2 border-[rgb(var(--accent)/0.15)]">
                      <Field label="Recipient address line 1" required>
                        <Input
                          value={recipientLine1}
                          onChange={setRecipientLine1}
                          required
                        />
                      </Field>
                      <Field label="Recipient address line 2">
                        <Input
                          value={recipientLine2}
                          onChange={setRecipientLine2}
                        />
                      </Field>
                      <Row>
                        <Field label="City" required>
                          <Input
                            value={recipientCity}
                            onChange={setRecipientCity}
                            required
                          />
                        </Field>
                        <Field label="State">
                          <Input
                            value={recipientState}
                            onChange={setRecipientState}
                          />
                        </Field>
                      </Row>
                    </div>
                  )}
                </div>
              )}
            </Section>

            <Section title="Pay with">
              <div className="grid grid-cols-2 gap-2">
                {(["paystack", "nomba"] as Gateway[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGateway(g)}
                    className={`p-3 rounded-xl border text-[13px] font-semibold capitalize ${
                      gateway === g
                        ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)] text-[rgb(var(--accent-glow))]"
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

          <aside className="lg:sticky lg:top-6 h-fit">
            <div className="glass rounded-[var(--radius)] p-5 space-y-4">
              <h3 className="font-display text-[20px]">Order summary</h3>
              <ul className="space-y-2.5">
                {items.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 text-[13px]">
                    <div className="font-mono text-[rgb(var(--text-faint))] tabular-nums">
                      ×{i.quantity}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-semibold">{i.name}</div>
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
                      {money(i.unit_price_ngn * i.quantity)}
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
                    {money(subtotal)}
                  </span>
                </div>
                {savings > 0 && (
                  <div className="flex justify-between text-[rgb(var(--success))]">
                    <span>You save</span>
                    <span className="tabular-nums font-mono">
                      −{money(savings)}
                    </span>
                  </div>
                )}
                {savings > 0 && (
                  <div className="flex justify-between text-[12px] text-[rgb(var(--text-faint))]">
                    <span>vs retail</span>
                    <span className="tabular-nums font-mono line-through">
                      {money(retail)}
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
              </div>
              {/* Promo code */}
              <div className="border-t hairline pt-3">
                {!promoOpen ? (
                  <button
                    type="button"
                    onClick={() => setPromoOpen(true)}
                    className="inline-flex items-center gap-1.5 text-[12px] text-[rgb(var(--accent-glow))] font-semibold hover:underline"
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
                    will be applied
                  </div>
                )}
              </div>

              <div className="border-t hairline pt-3 flex justify-between items-baseline">
                <span className="font-semibold">Total</span>
                <span className="font-display text-[22px] tabular-nums">
                  {money(total)}
                </span>
              </div>
              {err && (
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
                className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen disabled:opacity-60"
              >
                {busy ? (
                  "Securing your order…"
                ) : (
                  <>
                    <Lock className="w-4 h-4" /> Pay {money(total)}
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
        {required && <span className="text-[rgb(var(--accent-glow))]">*</span>}
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
        {required && <span className="text-[rgb(var(--accent-glow))]">*</span>}
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

/** The buyer's currency choice from the live-page ₦⇄$ toggle (persisted by
 *  CurrencyFloater). Drives gateway-rail selection on the Hub; the order is
 *  still placed in NGN. Defaults to NGN when never toggled. */
function readDisplayCurrency(): "NGN" | "USD" {
  if (typeof window === "undefined") return "NGN";
  try {
    return window.localStorage.getItem("pgh.salesCurrency") === "USD"
      ? "USD"
      : "NGN";
  } catch {
    return "NGN";
  }
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
