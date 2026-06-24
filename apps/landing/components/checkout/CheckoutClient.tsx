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
  RefreshCw,
  ShieldCheck,
  Store,
  Tag,
  Truck,
} from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import { postCheckout } from "@/lib/api-client";
import type { LandingPayload } from "@/lib/types";
import { WORLD_COUNTRIES, NIGERIAN_STATES, LAGOS_LGAS } from "@/lib/geo";

type Gateway = "paystack" | "nomba";
type DeliveryMode = "delivery" | "pickup";

// ── Inline ComboBox ────────────────────────────────────────────────
function ComboBox({
  options,
  value,
  onSelect,
  placeholder,
  required,
}: {
  options: { name: string; code: string }[];
  value: string;
  onSelect: (name: string, code: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep query in sync when value is set externally (e.g. cleared).
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 8);
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, options]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        required={required}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && filtered.length === 1) {
            e.preventDefault();
            onSelect(filtered[0].name, filtered[0].code);
            setQuery(filtered[0].name);
            setOpen(false);
          }
        }}
        autoComplete="off"
        className="w-full h-11 px-3.5 rounded-xl bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.5)] text-[14px]"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-[rgb(var(--border-c)/0.12)] bg-[rgb(var(--surface))] shadow-xl text-[13px]">
          {filtered.map((o) => (
            <li
              key={o.code}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(o.name, o.code);
                setQuery(o.name);
                setOpen(false);
              }}
              className="px-3.5 py-2 cursor-pointer hover:bg-[rgb(var(--accent)/0.08)] hover:text-[rgb(var(--accent-glow))]"
            >
              {o.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────
export function CheckoutClient({ payload }: { payload: LandingPayload }) {
  const router = useRouter();
  const items = useCart((s) => s.items);
  const subtotal = useCart((s) => s.subtotalNgn());
  const retail = useCart((s) => s.retailSubtotalNgn());
  const savings = useCart((s) => s.savingsNgn());

  // Contact
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+234 ");
  const [insta, setInsta] = useState("");

  // Delivery mode
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("delivery");
  const [pickupAddr, setPickupAddr] = useState<{ address: string | null; phone: string | null } | null>(null);

  // Delivery address
  const [country, setCountry] = useState("Nigeria");
  const [countryCode, setCountryCode] = useState("NG");
  const [stateValue, setStateValue] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [cityValue, setCityValue] = useState("");
  const [cityCode, setCityCode] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [notes, setNotes] = useState("");

  const isNigeria = country === "Nigeria";
  const isLagos = isNigeria && stateValue === "Lagos";

  // Gift
  const [isGift, setIsGift] = useState(false);
  const [giftName, setGiftName] = useState("");
  const [giftPhone, setGiftPhone] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [shipToRecipient, setShipToRecipient] = useState(false);
  const [recipientLine1, setRecipientLine1] = useState("");
  const [recipientLine2, setRecipientLine2] = useState("");
  const [recipientCity, setRecipientCity] = useState("");
  const [recipientState, setRecipientState] = useState("");
  const [recipientCountry, setRecipientCountry] = useState("Nigeria");

  // Payment & consent
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState(false);
  const [waOpt, setWaOpt] = useState(false);
  const [mktOpt, setMktOpt] = useState(false);
  const [terms, setTerms] = useState(false);
  const [honey, setHoney] = useState("");
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

  // Fetch pickup address once.
  useEffect(() => {
    const brand = payload.brand?.business_key;
    if (!brand) return;
    fetch(`/api/public/storefront/pickup-address?brand=${brand}`)
      .then((r) => r.json())
      .then((json) => setPickupAddr(json?.data ?? null))
      .catch(() => {});
  }, [payload.brand?.business_key]);

  useEffect(() => {
    if (err && errRef.current) {
      errRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [err]);

  const idemKey = useMemo(
    () => `pgh-${payload.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    [payload.slug],
  );
  const empty = items.length === 0;

  // When country changes, reset state + city.
  function handleCountrySelect(name: string, code: string) {
    setCountry(name);
    setCountryCode(code);
    setStateValue("");
    setStateCode("");
    setCityValue("");
    setCityCode("");
  }

  // When state changes, reset city.
  function handleStateSelect(name: string, code: string) {
    setStateValue(name);
    setStateCode(code);
    setCityValue("");
    setCityCode("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (honey) return;
    if (!terms) {
      setErr({ message: "Please accept the terms to continue.", retryable: false });
      return;
    }
    if (!first || !email || !phone) {
      setErr({ message: "Please fill in all required fields.", retryable: false });
      return;
    }
    if (deliveryMode === "delivery" && (!addressLine1 || !cityValue)) {
      setErr({ message: "Please fill in your delivery address.", retryable: false });
      return;
    }
    if (isNigeria && deliveryMode === "delivery" && !stateValue) {
      setErr({ message: "Please select your state.", retryable: false });
      return;
    }
    setBusy(true);
    try {
      const giftPayload = isGift
        ? {
            recipient_name: giftName,
            recipient_phone: giftPhone || undefined,
            message: giftMessage || undefined,
            ship_to_recipient: shipToRecipient || undefined,
            recipient_address: shipToRecipient
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

      const address =
        deliveryMode === "pickup"
          ? { line1: pickupAddr?.address || "Store pickup", city: "Lagos", state: "Lagos", country: "Nigeria" }
          : {
              line1: addressLine1,
              line2: addressLine2 || undefined,
              city: cityValue,
              state: stateValue || undefined,
              country,
              country_code: countryCode || undefined,
              zone_code: cityCode || stateCode || undefined,
            };

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
          address: address as Parameters<typeof postCheckout>[0]["contact"]["address"],
          consent: { whatsapp_opt_in: waOpt, marketing_opt_in: mktOpt, terms_accepted: true },
        },
        cart: items.map((i) => ({
          bundle_id: i.bundle_id,
          product_id: i.product_id,
          styled_variant_id: i.styled_variant_id,
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
      if (orderId) sessionStorage.setItem("pgh-last-order-id", orderId);
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
          <em className="not-italic md:italic text-[rgb(var(--accent-glow))]">yours.</em>
        </h1>

        <form
          id="checkout-form"
          onSubmit={submit}
          className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6"
        >
          <div className="space-y-5">
            {/* ── Contact ── */}
            <Section title="Contact">
              <Row>
                <Field label="First name" required>
                  <Input value={first} onChange={setFirst} autoComplete="given-name" required />
                </Field>
                <Field label="Last name" required>
                  <Input value={last} onChange={setLast} autoComplete="family-name" required />
                </Field>
              </Row>
              <Row>
                <Field label="Email" required>
                  <Input type="email" value={email} onChange={setEmail} autoComplete="email" required />
                </Field>
                <Field label="Phone (with country code)" required>
                  <Input value={phone} onChange={setPhone} autoComplete="tel" required />
                </Field>
              </Row>
              <Field label="Instagram handle (optional)">
                <Input value={insta} onChange={setInsta} placeholder="@yourhandle" />
              </Field>
            </Section>

            {/* ── Pickup or Delivery toggle ── */}
            <Section title="How would you like to receive your order?">
              <div className="grid grid-cols-2 gap-2">
                {(["delivery", "pickup"] as DeliveryMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDeliveryMode(m)}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-[13px] font-semibold capitalize transition-colors ${
                      deliveryMode === m
                        ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)] text-[rgb(var(--accent-glow))]"
                        : "border-[rgb(var(--border-c)/0.1)] text-[rgb(var(--text-muted))]"
                    }`}
                  >
                    {m === "delivery" ? (
                      <><Truck className="w-3.5 h-3.5" /> Delivery</>
                    ) : (
                      <><Store className="w-3.5 h-3.5" /> Store Pickup</>
                    )}
                  </button>
                ))}
              </div>

              {deliveryMode === "pickup" && (
                <div className="mt-3 p-3.5 rounded-xl bg-[rgb(var(--accent)/0.05)] border border-[rgb(var(--accent)/0.12)]">
                  <div className="flex items-start gap-2 text-[13px]">
                    <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-[rgb(var(--accent-glow))]" />
                    <div>
                      <p className="font-semibold text-[rgb(var(--text))]">Pickup Address</p>
                      {pickupAddr?.address ? (
                        <p className="text-[rgb(var(--text-muted))] mt-0.5">{pickupAddr.address}</p>
                      ) : (
                        <p className="text-[rgb(var(--text-faint))] mt-0.5 italic">Loading address…</p>
                      )}
                      {pickupAddr?.phone && (
                        <p className="text-[rgb(var(--text-muted))] mt-0.5">{pickupAddr.phone}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Section>

            {/* ── Delivery address ── */}
            {deliveryMode === "delivery" && (
              <Section title="Delivery">
                {/* Country — always a ComboBox */}
                <Field label="Country" required>
                  <ComboBox
                    options={WORLD_COUNTRIES}
                    value={country}
                    onSelect={handleCountrySelect}
                    placeholder="Search country…"
                    required
                  />
                </Field>

                {/* State — dropdown for Nigeria, free text elsewhere */}
                {isNigeria ? (
                  <Field label="State" required>
                    <div className="relative">
                      <select
                        value={stateValue}
                        required
                        onChange={(e) => {
                          const opt = NIGERIAN_STATES.find((s) => s.name === e.target.value);
                          handleStateSelect(e.target.value, opt?.code ?? "");
                        }}
                        className="w-full h-11 px-3.5 pr-9 rounded-xl bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.5)] text-[14px] appearance-none"
                      >
                        <option value="">Select state…</option>
                        {NIGERIAN_STATES.map((s) => (
                          <option key={s.code} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgb(var(--text-muted))]" />
                    </div>
                  </Field>
                ) : (
                  <Field label="State / Province">
                    <Input value={stateValue} onChange={(v) => { setStateValue(v); setStateCode(""); }} placeholder="State or province" />
                  </Field>
                )}

                {/* City — ComboBox for Lagos, free text elsewhere */}
                {isLagos ? (
                  <Field label="City / LGA" required>
                    <ComboBox
                      options={LAGOS_LGAS}
                      value={cityValue}
                      onSelect={(name, code) => { setCityValue(name); setCityCode(code); }}
                      placeholder="Search LGA…"
                      required
                    />
                  </Field>
                ) : (
                  <Field label="City" required>
                    <Input value={cityValue} onChange={(v) => { setCityValue(v); setCityCode(""); }} required />
                  </Field>
                )}

                <Field label="Address line 1" required>
                  <Input value={addressLine1} onChange={setAddressLine1} required />
                </Field>
                <Field label="Address line 2">
                  <Input value={addressLine2} onChange={setAddressLine2} />
                </Field>
                <Field label="Order notes (optional)">
                  <Textarea
                    value={notes}
                    onChange={setNotes}
                    placeholder="Leave with the security guard, for my sister's birthday, etc."
                  />
                </Field>
              </Section>
            )}

            {/* ── Gift ── */}
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
                        <Input value={recipientLine1} onChange={setRecipientLine1} required />
                      </Field>
                      <Field label="Recipient address line 2">
                        <Input value={recipientLine2} onChange={setRecipientLine2} />
                      </Field>
                      <Row>
                        <Field label="City" required>
                          <Input value={recipientCity} onChange={setRecipientCity} required />
                        </Field>
                        <Field label="State">
                          <Input value={recipientState} onChange={setRecipientState} />
                        </Field>
                      </Row>
                      <Field label="Country">
                        <Input value={recipientCountry} onChange={setRecipientCountry} />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </Section>

            {/* ── Payment gateway ── */}
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

            {/* ── Consent ── */}
            <Section title="Consent &amp; terms">
              <Toggle label="Send me sale-day updates on WhatsApp" checked={waOpt} onChange={setWaOpt} />
              <Toggle label="Sign me up for the newsletter" checked={mktOpt} onChange={setMktOpt} />
              <Toggle label="I accept the terms and privacy policy" checked={terms} onChange={setTerms} required />
              <label className="hidden" aria-hidden>
                Leave this empty
                <input type="text" tabIndex={-1} autoComplete="off" value={honey} onChange={(e) => setHoney(e.target.value)} />
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

          {/* ── Order summary sidebar ── */}
          <aside className="lg:sticky lg:top-6 h-fit">
            <div className="glass rounded-[var(--radius)] p-5 space-y-4">
              <h3 className="font-display text-[20px]">Order summary</h3>
              <ul className="space-y-2.5">
                {items.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 text-[13px]">
                    <div className="font-mono text-[rgb(var(--text-faint))] tabular-nums">×{i.quantity}</div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-semibold">{i.name}</div>
                      {i.preorder ? (
                        <div className="text-[11px] text-[rgb(var(--warn))]">
                          Out of stock · pre-order ships in {i.preorder_lead_weeks ?? 3} weeks
                        </div>
                      ) : (
                        i.delivery_weeks != null && i.delivery_weeks > 0 && (
                          <div className="text-[11px] text-[rgb(var(--text-faint))]">
                            Delivery in {i.delivery_weeks} week{i.delivery_weeks !== 1 ? "s" : ""}
                          </div>
                        )
                      )}
                    </div>
                    <div className="tabular-nums font-mono">{money(i.unit_price_ngn * i.quantity)}</div>
                  </li>
                ))}
              </ul>
              <div className="border-t hairline pt-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[rgb(var(--text-muted))]">Subtotal</span>
                  <span className="tabular-nums font-mono">{money(subtotal)}</span>
                </div>
                {savings > 0 && (
                  <div className="flex justify-between text-[rgb(var(--success))]">
                    <span>You save</span>
                    <span className="tabular-nums font-mono">−{money(savings)}</span>
                  </div>
                )}
                {savings > 0 && (
                  <div className="flex justify-between text-[12px] text-[rgb(var(--text-faint))]">
                    <span>vs retail</span>
                    <span className="tabular-nums font-mono line-through">{money(retail)}</span>
                  </div>
                )}
              </div>
              {/* Promo */}
              <div className="border-t hairline pt-3">
                {!promoOpen ? (
                  <button
                    type="button"
                    onClick={() => setPromoOpen(true)}
                    className="inline-flex items-center gap-1.5 text-[12px] text-[rgb(var(--accent-glow))] font-semibold hover:underline"
                  >
                    <Tag className="w-3 h-3" /> Have a promo code? <ChevronDown className="w-3 h-3" />
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoApplied(false); }}
                      placeholder="Enter code"
                      className="flex-1 h-9 px-3 rounded-lg bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.5)] text-[13px] font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => { if (promoCode.trim()) setPromoApplied(true); }}
                      disabled={!promoCode.trim()}
                      className="h-9 px-3 rounded-lg bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] text-[12px] font-semibold disabled:opacity-40"
                    >
                      Apply
                    </button>
                  </div>
                )}
                {promoApplied && (
                  <div className="mt-1.5 flex items-center gap-1 text-[12px] text-[rgb(var(--success))]">
                    <Check className="w-3 h-3" /> Code <span className="font-mono font-semibold">{promoCode}</span> will be applied
                  </div>
                )}
              </div>

              <div className="border-t hairline pt-3 flex justify-between">
                <span className="font-semibold">Total</span>
                <span className="font-display text-[22px] tabular-nums">{money(subtotal)}</span>
              </div>

              {err && (
                <div
                  ref={errRef}
                  role="alert"
                  aria-live="assertive"
                  className="rounded-xl border border-[rgb(var(--danger)/0.4)] bg-[rgb(var(--danger)/0.08)] px-4 py-3 space-y-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[rgb(var(--danger))]" />
                    <p className="text-[13px] leading-snug text-[rgb(var(--danger))]">{err.message}</p>
                  </div>
                  {(err.order_id || err.reference) && (
                    <p className="text-[11px] text-[rgb(var(--text-faint))] font-mono pl-[26px]">
                      Ref: {err.order_id || err.reference}
                    </p>
                  )}
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
                  {err.retryable && (
                    <button
                      type="submit"
                      form="checkout-form"
                      disabled={busy}
                      className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] pl-[26px] disabled:opacity-50"
                    >
                      <RefreshCw className="w-3 h-3" /> Try again
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
                {busy ? "Securing your order…" : <><Lock className="w-4 h-4" /> Pay {money(subtotal)}</>}
              </motion.button>
              <div className="text-[11px] text-[rgb(var(--text-faint))] text-center inline-flex items-center justify-center gap-1 w-full">
                <ShieldCheck className="w-3 h-3 text-[rgb(var(--success))]" /> Secure checkout · Shipping calculated at fulfilment
              </div>
              <p className="text-[11px] text-[rgb(var(--text-faint))] text-center">
                <CreditCard className="inline w-3 h-3 mr-1" />You&apos;ll be redirected to your gateway.
              </p>
            </div>
          </aside>
        </form>
      </div>
    </main>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-[var(--radius)] p-5 space-y-3">
      <h3 className="font-display text-[18px]">{title}</h3>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="micro mb-1.5 block">
        {label} {required && <span className="text-[rgb(var(--accent-glow))]">*</span>}
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

function Textarea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
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
        {label} {required && <span className="text-[rgb(var(--accent-glow))]">*</span>}
        {checked && <Check className="inline w-3 h-3 text-[rgb(var(--success))] ml-1" />}
      </span>
    </label>
  );
}

function readDisplayCurrency(): "NGN" | "USD" {
  if (typeof window === "undefined") return "NGN";
  try {
    return window.localStorage.getItem("pgh.salesCurrency") === "USD" ? "USD" : "NGN";
  } catch {
    return "NGN";
  }
}

function readUtm(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out;
}
