import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  CreditCard,
  Lock,
  MapPin,
  Phone,
  ShieldCheck,
  Store,
  Truck,
  X,
} from "lucide-react";
import {
  checkout,
  getCart,
  quoteCart,
  type Cart,
  type CheckoutInput,
  type Quote,
} from "@/lib/storefront";
import { formatFromNgn, settlementFor } from "@/lib/money";
import { bootstrapAuth, getMe } from "@/lib/auth";
import { useCurrency } from "@/lib/useStore";
import {
  fetchDeliveryQuote,
  fetchGeoOptions,
  fetchPickupAddress,
  GEO_FALLBACK,
  type GeoOption,
  type GeoOptions,
  type PickupAddress,
} from "@/lib/geo";
import { Section, EmptyState } from "@/components/parts";

export const Route = createFileRoute("/checkout")({ component: CheckoutPage });

type Fulfilment = "delivery" | "pickup";

function CheckoutPage() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const [currency] = useCurrency();
  const [busy, setBusy] = useState(false);

  // Live server-backed cart (sf_cart cookie). Drives the wig count that prices
  // the delivery tier and the summary line items.
  const cartQ = useQuery<Cart>({ queryKey: ["cart"], queryFn: () => getCart() });
  const items = cartQ.data?.items ?? [];
  // Total wigs in the basket drive the delivery tier (1–2 / 3–4 / 5–6 / +2).
  const wigQty = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

  // Server-authoritative goods quote (subtotal + best-effort coupon discount).
  // No address is passed here — delivery is quoted separately below via the
  // dedicated delivery-quote endpoint (identical to the Sales Campaign Landing)
  // so we get the fee_status the "zero exceptions" gate needs.
  const quoteQ = useQuery<Quote>({
    queryKey: ["cart-quote", currency, items.length],
    queryFn: () => quoteCart({ display_currency: currency }),
    enabled: items.length > 0,
  });
  const n = (v: string | number | undefined | null) => Number(v ?? 0) || 0;
  // Render an NGN amount in the buyer's DISPLAY currency via the SSOT rate
  // (lib/money) — the same rate the server settles at, so every figure agrees
  // to the unit. Parametric: works for any active currency, not just USD.
  const fmt = (ngn: number) => formatFromNgn(n(ngn), currency);
  // The currency the order will actually CHARGE in: the display currency when
  // it's settlement-enabled, else USD (buyer sees their currency, pays USD).
  const settleCur = settlementFor(currency);

  const subtotalNgn = n(quoteQ.data?.subtotal_ngn);
  const discountNgn = n(quoteQ.data?.discount_ngn);
  // Discounted goods (before delivery) — matches the bag's total figure.
  const discountedGoods = quoteQ.data
    ? n(quoteQ.data.total_ngn)
    : subtotalNgn - discountNgn;

  // ── Contact ──
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // ── Fulfilment + address ──
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
  const [, setDeliveryZoneName] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  // ── Payment + loyalty ──
  const [gateway, setGateway] = useState("nomba");
  const [points, setPoints] = useState(0);
  const [redeem, setRedeem] = useState(0);

  // Warm "we need an address we can ship to" modal. Opens when the buyer taps
  // Pay on a delivery order that hasn't resolved a real, positive fee. It only
  // INFORMS — submit() and the server are what actually block ₦0 delivery.
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const errRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (err && errRef.current)
      errRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [err]);

  // ── Geo-conditional autofill state (identical resolution to the landing) ──
  const countries = geo?.countries ?? GEO_FALLBACK.countries;
  const ngStates = geo?.nigeria_states ?? GEO_FALLBACK.nigeria_states;
  const lagosLgas = geo?.lagos_lgas ?? GEO_FALLBACK.lagos_lgas;
  const norm = (s: string) => s.trim().toLowerCase();
  const isNigeria = country === "Nigeria" || countryCode === "NG";
  const isLagos = isNigeria && norm(state) === "lagos";
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

  // Load picker options + the in-store pickup address once per mount.
  useEffect(() => {
    let alive = true;
    fetchGeoOptions().then((g) => {
      if (alive) setGeo(g);
    });
    fetchPickupAddress().then((p) => {
      if (alive) setPickupAddr(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Restore a signed-in session so the order attaches to the account and the
  // shopper can redeem loyalty points.
  useEffect(() => {
    let active = true;
    (async () => {
      const ok = await bootstrapAuth();
      if (ok && active) {
        try {
          const me = await getMe();
          if (active) setPoints(me.loyalty_points || 0);
        } catch {
          /* not signed in */
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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
    fetchDeliveryQuote({ zoneCode: effectiveZone, qty: wigQty })
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
  }, [fulfilment, effectiveZone, wigQty]);

  // Delivery due now (pickup is free; a delivery order only ever carries a real,
  // positive fee — a ₦0/unpriced zone is blocked, never charged at ₦0).
  const deliveryDue =
    fulfilment === "delivery" && deliveryFee != null ? deliveryFee : 0;
  // ZERO EXCEPTIONS: a delivery order may proceed to payment ONLY when a real,
  // positive fee has resolved. Pickup is the sole ₦0 fulfilment. "free" and
  // "pending" (both ₦0) no longer qualify — they gate the Pay button shut, just
  // like an unpriced/unserviceable location. This mirrors the server, which
  // refuses any delivery order whose fee is not > ₦0.
  const deliveryFeeOk =
    fulfilment === "pickup" ||
    (!quoting && deliveryFee != null && deliveryFee > 0);
  // Total = discounted goods (server quote) + delivery. This is the figure the
  // gateway actually charges, so the "Pay" button and the order it creates now
  // agree to the naira.
  const total = discountedGoods + deliveryDue;

  // Right-hand summary label for the delivery line. A delivery order must show a
  // real, positive fee. A ₦0 outcome of any kind — "free" promo, "pending"
  // config gap, or an unpriced/unserviceable location — reads as "not
  // deliverable" so the buyer fixes the address or switches to pickup; it is
  // never presented as something payable at ₦0.
  const deliveryLabel =
    fulfilment === "pickup"
      ? "Free"
      : quoting
        ? "Calculating…"
        : deliveryFee != null && deliveryFee > 0
          ? fmt(deliveryFee)
          : effectiveZone
            ? "No delivery to this address"
            : "Select location";

  // Payment rails: USD orders route through Nomba only (older campaigns offer
  // both). Keep the selected rail valid when the currency flips.
  const rails = useMemo(
    () => (currency === "USD" ? ["nomba"] : ["nomba", "paystack"]),
    [currency],
  );
  useEffect(() => {
    if (!rails.includes(gateway)) setGateway(rails[0]);
  }, [rails, gateway]);

  const idemKey = useMemo(
    () =>
      (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
      `sf-${Date.now()}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!first || !email || !phone) {
      setErr("Please fill in your name, email and phone.");
      return;
    }
    if (fulfilment === "delivery") {
      if (!addressLine1 || !city) {
        setErr("Please enter your delivery address.");
        return;
      }
      if (isNigeria && !state) {
        setErr("Please select your state.");
        return;
      }
      if (isLagos && !zoneCode) {
        setErr("Please select your city / LGA.");
        return;
      }
      // The location must have RESOLVED to a billable zone. Typing a country /
      // state (or browser autofill) without picking it from the list leaves
      // `effectiveZone` blank — the visible address looks complete but we have
      // no zone to price. Never let that pay ₦0 delivery.
      if (!effectiveZone) {
        setErr(
          isNigeria
            ? "Please pick your state from the list (and your LGA for Lagos) so we can calculate delivery."
            : "Please pick your country from the list so we can calculate delivery.",
        );
        return;
      }
      // Quote still in flight — wait for the fee rather than submitting blind.
      if (quoting) {
        setErr("Calculating delivery… give it a second, then tap Pay again.");
        return;
      }
      // ZERO EXCEPTIONS: a delivery order must carry a real, positive fee. A ₦0
      // fee of ANY kind — unpriced zone (null), a "free" promo, or a "pending"
      // config gap — is never allowed to pay. Pickup is the only free
      // fulfilment. The server enforces this too. Rather than a terse error, we
      // greet the buyer with the warm modal that walks them to a fix.
      if (deliveryFee == null || !(deliveryFee > 0)) {
        setShowDeliveryModal(true);
        return;
      }
    }
    setBusy(true);
    try {
      const input: CheckoutInput = {
        contact: {
          first_name: first,
          last_name: last,
          email,
          phone,
          ...(fulfilment === "delivery"
            ? {
                address: {
                  line1: addressLine1,
                  line2: addressLine2 || undefined,
                  city,
                  state: state || undefined,
                  country,
                  country_code: resolvedCountryCode || undefined,
                  zone_code: effectiveZone || undefined,
                },
              }
            : {}),
        },
        fulfilment_type: fulfilment,
        display_currency: currency,
        payment_gateway: gateway,
        redeem_points: redeem > 0 ? redeem : undefined,
        client_idempotency_key: idemKey,
      };
      const res = await checkout(input);
      window.location.href = res.payment_url;
    } catch (e) {
      const m =
        (e as { userMessage?: string })?.userMessage ||
        "Checkout failed. Please review your details and try again.";
      setErr(m);
      toast.error(m);
      setBusy(false);
    }
  }

  // Nested routes (e.g. /checkout/thank-you) render through the Outlet.
  if (pathname !== "/checkout" && pathname !== "/checkout/") return <Outlet />;

  if (cartQ.isLoading)
    return (
      <Section>
        <p className="text-body text-muted-foreground">Loading your bag…</p>
      </Section>
    );

  if (items.length === 0)
    return (
      <Section>
        <h1 className="text-h3 font-display">Checkout</h1>
        <EmptyState
          title="Your bag is empty."
          cta={
            <Link
              to="/shop"
              className="rounded-full bg-primary px-6 py-2.5 text-body-sm text-primary-foreground"
            >
              Start shopping
            </Link>
          }
        />
      </Section>
    );

  const field = "input-line text-body placeholder:text-muted-foreground";

  return (
    <Section className="max-w-5xl">
      <h1 className="text-h3 font-display">Checkout</h1>
      <Link
        to="/cart"
        className="mt-1 inline-block text-body-sm text-muted-foreground hover:text-foreground"
      >
        Back to bag
      </Link>

      <form
        id="checkout-form"
        onSubmit={submit}
        className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]"
      >
        {/* ── Left: contact, fulfilment, payment, loyalty ── */}
        <div className="space-y-8">
          <fieldset className="space-y-4">
            <legend className="text-caption">Contact</legend>
            <div className="grid grid-cols-2 gap-4">
              <input
                className={field}
                placeholder="First name"
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                autoComplete="given-name"
                required
              />
              <input
                className={field}
                placeholder="Last name"
                value={last}
                onChange={(e) => setLast(e.target.value)}
                autoComplete="family-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input
                className={field}
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <input
                className={field}
                placeholder="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                required
              />
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-caption">Fulfilment</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    v: "delivery" as const,
                    label: "Deliver to me",
                    desc: "Ship to your address",
                    icon: Truck,
                  },
                  {
                    v: "pickup" as const,
                    label: "Pick up",
                    desc: "Collect from our store",
                    icon: Store,
                  },
                ]
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setFulfilment(opt.v)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    fulfilment === opt.v
                      ? "border-primary bg-secondary"
                      : "border-border"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-body-sm">
                    <opt.icon size={15} /> {opt.label}
                  </span>
                  <span className="mt-0.5 block text-caption text-muted-foreground">
                    {opt.desc}
                  </span>
                </button>
              ))}
            </div>

            {fulfilment === "delivery" ? (
              <div id="delivery-address" className="space-y-4">
                {/* Country — searchable, choose from the dropdown */}
                <FieldLabel label="Country" required>
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
                </FieldLabel>

                {/* State — Nigeria gets an autofill picker; every other
                    country free-types its region. */}
                {isNigeria ? (
                  <FieldLabel label="State" required>
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
                  </FieldLabel>
                ) : (
                  country && (
                    <FieldLabel label="State / Province">
                      <input
                        className={field}
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        placeholder="State or province"
                      />
                    </FieldLabel>
                  )
                )}

                {/* City — Lagos gets the LGA picker; everywhere else
                    free-types the city. */}
                {isLagos ? (
                  <FieldLabel label="City / LGA" required>
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
                  </FieldLabel>
                ) : (
                  <FieldLabel label="City" required>
                    <input
                      className={field}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      required
                      placeholder="City / town"
                    />
                  </FieldLabel>
                )}

                <FieldLabel label="Address line 1" required>
                  <input
                    className={field}
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    required
                    placeholder="House number and street"
                  />
                </FieldLabel>
                <FieldLabel label="Address line 2">
                  <input
                    className={field}
                    value={addressLine2}
                    onChange={(e) => setAddressLine2(e.target.value)}
                    placeholder="Apartment, landmark (optional)"
                  />
                </FieldLabel>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-secondary px-4 py-3">
                <p className="flex items-center gap-1.5 text-caption">
                  <MapPin size={14} /> Pickup location
                </p>
                {pickupAddr?.address ? (
                  <>
                    <p className="mt-1.5 whitespace-pre-line text-body-sm">
                      {pickupAddr.address}
                    </p>
                    {pickupAddr.phone && (
                      <p className="mt-1 inline-flex items-center gap-1 text-caption text-muted-foreground">
                        <Phone size={12} /> {pickupAddr.phone}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1.5 text-body-sm italic text-muted-foreground">
                    We&apos;ll share the pickup address and collection time
                    right after you order.
                  </p>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-caption">Payment</legend>
            <div className="flex gap-2">
              {rails.map((g) => (
                <button
                  type="button"
                  key={g}
                  onClick={() => setGateway(g)}
                  className={`rounded-full border px-4 py-1.5 text-body-sm capitalize ${
                    gateway === g
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </fieldset>

          {points > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-caption">Loyalty</legend>
              <label className="block text-body-sm text-muted-foreground">
                Redeem points (you have {points})
              </label>
              <input
                type="number"
                min={0}
                max={points}
                value={redeem}
                onChange={(e) =>
                  setRedeem(
                    Math.max(
                      0,
                      Math.min(points, parseInt(e.target.value, 10) || 0),
                    ),
                  )
                }
                className={field}
              />
              <p className="text-caption text-muted-foreground">
                Points are applied at payment and reduce the amount charged.
              </p>
            </fieldset>
          ) : null}
        </div>

        {/* ── Right: order summary ── */}
        <aside className="h-fit lg:sticky lg:top-6">
          <div className="rounded-lg border border-border p-6">
            <h2 className="text-h6 font-display">Order summary</h2>

            <ul className="mt-4 space-y-3">
              {items.map((it) => (
                <li
                  key={it.cart_item_id}
                  className="flex items-start gap-3 text-body-sm"
                >
                  <span className="font-mono tabular-nums text-muted-foreground">
                    ×{it.quantity}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {it.product_name_snapshot}
                    </span>
                    {it.variant_label_snapshot ? (
                      <span className="block truncate text-caption text-muted-foreground">
                        {it.variant_label_snapshot}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono tabular-nums">
                    {fmt(n(it.unit_price_ngn) * it.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-2 border-t border-border pt-4 text-body-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="font-mono tabular-nums">
                  {quoteQ.data ? fmt(subtotalNgn) : "…"}
                </dd>
              </div>
              {discountNgn > 0 ? (
                <div className="flex justify-between text-rose">
                  <dt>Discount</dt>
                  <dd className="font-mono tabular-nums">
                    −{fmt(discountNgn)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="inline-flex items-center gap-1 text-muted-foreground">
                  {fulfilment === "pickup" ? (
                    <Store size={12} />
                  ) : (
                    <Truck size={12} />
                  )}
                  Delivery
                </dt>
                <dd className="font-mono tabular-nums">{deliveryLabel}</dd>
              </div>

              {/* A delivery address that didn't resolve to a real, positive
                  fee blocks checkout outright — no ₦0 delivery, no "confirm
                  later". Tell the buyer plainly so they fix the address or
                  switch to pickup. */}
              {fulfilment === "delivery" &&
                !quoting &&
                effectiveZone &&
                !(deliveryFee != null && deliveryFee > 0) && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
                    <p className="text-caption leading-snug text-muted-foreground">
                      <span className="text-destructive">
                        We can&apos;t deliver to this address yet.
                      </span>{" "}
                      Double-check your country, state and city, or choose store
                      pickup. We can&apos;t take a delivery order without a
                      delivery fee.
                    </p>
                  </div>
                )}

              <div className="flex items-baseline justify-between border-t border-border pt-3 text-body">
                <dt>Total</dt>
                <dd className="font-display text-h6 tabular-nums">
                  {quoteQ.data ? fmt(total) : "…"}
                </dd>
              </div>
            </dl>

            {err ? (
              <div
                ref={errRef}
                role="alert"
                aria-live="assertive"
                className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-body-sm text-destructive"
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span className="leading-snug">{err}</span>
              </div>
            ) : null}

            <button
              type="submit"
              form="checkout-form"
              // Disabled only while busy or mid-quote. When delivery isn't
              // billable the button stays tappable BUT submit() intercepts and
              // opens the warm modal instead of paying — so it can never pay a
              // ₦0 delivery, yet still guides the buyer to fix it.
              disabled={busy || quoting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-body text-primary-foreground disabled:opacity-60"
            >
              {busy ? (
                "Starting secure payment…"
              ) : quoting ? (
                <>
                  <Truck size={16} /> Calculating delivery…
                </>
              ) : !deliveryFeeOk ? (
                <>
                  <Truck size={16} /> Add delivery details
                </>
              ) : (
                <>
                  <Lock size={16} /> Pay {fmt(total)}
                </>
              )}
            </button>

            <p className="mt-3 inline-flex w-full items-center justify-center gap-1 text-caption text-muted-foreground">
              <ShieldCheck size={12} />{" "}
              {fulfilment === "pickup"
                ? "Secure checkout · Collect in store"
                : deliveryFee != null && deliveryFee > 0
                  ? "Secure checkout · Delivery included"
                  : "Secure checkout · Enter a deliverable address"}
            </p>
            {/* When the display currency isn't itself a settlement currency, the
                buyer sees their currency but is charged in the settlement one
                (USD today). Say so plainly with the exact charged figure. */}
            {settleCur !== currency && (
              <p className="mt-1 text-center text-caption text-muted-foreground">
                Charged in {settleCur}: {formatFromNgn(total, settleCur)}
              </p>
            )}
            <p className="mt-1 text-center text-caption text-muted-foreground">
              <CreditCard size={12} className="mr-1 inline" />
              You&apos;ll be taken to a secure payment page. Retries are safe;
              you are not charged twice.
            </p>
          </div>
        </aside>
      </form>

      {/* Warm "we need a deliverable address" modal. Opens when the buyer taps
          Pay on a delivery order with no real, positive fee. It only guides —
          submit() never proceeds to pay, and the server refuses ₦0 delivery. */}
      {showDeliveryModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delivery-modal-title"
          className="fixed inset-0 z-50 grid place-items-center p-4"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setShowDeliveryModal(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-background p-6 text-center shadow-2xl">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setShowDeliveryModal(false)}
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
            >
              <X size={16} />
            </button>
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-secondary">
              <Truck size={20} />
            </div>
            <h3
              id="delivery-modal-title"
              className="text-h6 font-display leading-tight"
            >
              Almost there — where are we sending it?
            </h3>
            <p className="mt-2 text-body-sm leading-snug text-muted-foreground">
              We just need a delivery address we can actually ship to, so we can
              add your delivery fee. Pop in your country, state and city — or
              collect from our store instead.
            </p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowDeliveryModal(false);
                  const el = document.getElementById("delivery-address");
                  el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  el?.querySelector("input")?.focus();
                }}
                className="rounded-full bg-primary py-2.5 text-body-sm text-primary-foreground"
              >
                Add my delivery address
              </button>
              <button
                type="button"
                onClick={() => {
                  setFulfilment("pickup");
                  setShowDeliveryModal(false);
                  setErr(null);
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border py-2.5 text-body-sm text-muted-foreground hover:text-foreground"
              >
                <Store size={14} /> Collect from store instead
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function FieldLabel({
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
      <span className="mb-1.5 block text-caption text-muted-foreground">
        {label} {required && <span className="text-rose">*</span>}
      </span>
      {children}
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
        className="input-line text-body placeholder:text-muted-foreground"
      />
      {open && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-background shadow-2xl">
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
                className="cursor-pointer px-3.5 py-2.5 text-body-sm hover:bg-secondary"
              >
                {item.name}
              </li>
            ))
          ) : (
            <li className="px-3.5 py-2.5 text-body-sm text-muted-foreground">
              No matches — check the spelling.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
