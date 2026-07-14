import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
} from "lucide-react";
import {
  fetchGeoOptions,
  GEO_FALLBACK,
  type GeoOptions,
} from "@/lib/geo";
import { fetchDeliveryQuote } from "@/lib/geo";
import { formatFromNgn } from "@/lib/money";
import { useCurrency } from "@/lib/useStore";
import { Section } from "@/components/parts";
import {
  getOrderLink,
  submitOrderLinkOrder,
  createOrderPayLink,
  reportOrderLinkActivity,
  type OrderLinkContext,
  type OrderLinkItem,
} from "@/lib/order-link";

/**
 * Public order-link checkout (`/o/$slug`).
 *
 * The customer opens a short link a staffer shared in a Smartcomm chat. We
 * resolve the slug on the Hub, let them pick items + confirm delivery (same
 * zone → fee gating as the main checkout), raise the order, and redirect to
 * the payment gateway (Nomba). Runs on the BRAND storefront domain, so the
 * whole flow stays on faitlynhair.com / pixiegirlglobal.com.
 */

export const Route = createFileRoute("/o/$slug")({ component: OrderLinkCheckout });

type Fulfilment = "delivery" | "pickup";
const norm = (s: string) => s.trim().toLowerCase();

function OrderLinkCheckout() {
  const { slug } = Route.useParams();
  const [currency] = useCurrency();
  const money = (ngn: number) => formatFromNgn(ngn, currency);

  const q = useQuery<OrderLinkContext>({
    queryKey: ["order-link", slug],
    queryFn: () => getOrderLink(slug),
    retry: false,
  });

  if (q.isLoading) {
    return (
      <Section className="max-w-xl">
        <div className="grid place-items-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </Section>
    );
  }
  if (q.isError || !q.data) {
    const msg =
      (q.error as { userMessage?: string } | null)?.userMessage ||
      "This order link is no longer valid. Please ask us for a fresh one.";
    return (
      <Section className="max-w-xl">
        <div className="py-14 text-center">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <p className="text-body font-display text-lg">
            Sorry — this link doesn&rsquo;t work
          </p>
          <p className="mx-auto mt-2 max-w-sm text-body-sm text-muted-foreground">
            {msg}
          </p>
        </div>
      </Section>
    );
  }
  if (q.data.status === "ordered") {
    return (
      <Section className="max-w-xl">
        <div className="py-14 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-9 w-9 text-emerald-500" />
          <p className="text-body font-display text-xl">Order already placed 🌹</p>
          <p className="mx-auto mt-2 max-w-sm text-body-sm text-muted-foreground">
            This link was used to place
            {q.data.order_number ? ` order ${q.data.order_number}` : " your order"}.
            Message us on WhatsApp if you&rsquo;d like to order again — we&rsquo;ll
            send a fresh link.
          </p>
        </div>
      </Section>
    );
  }

  return <CheckoutForm slug={slug} ctx={q.data} money={money} />;
}

function CheckoutForm({
  slug,
  ctx,
  money,
}: {
  slug: string;
  ctx: OrderLinkContext;
  money: (ngn: number) => string;
}) {
  const [stage, setStage] = useState<"form" | "submitting" | "done">("form");
  const [err, setErr] = useState<string | null>(null);

  const [fulfilment, setFulfilment] = useState<Fulfilment>("delivery");
  const [geo, setGeo] = useState<GeoOptions>(GEO_FALLBACK);
  const [address, setAddress] = useState({
    line1: ctx.delivery_address?.line1 ?? "",
    area: ctx.delivery_address?.area ?? "",
    city: ctx.delivery_address?.city ?? "",
    state: ctx.delivery_address?.state ?? "",
    landmark: ctx.delivery_address?.landmark ?? "",
  });
  const [country, setCountry] = useState(ctx.delivery_address?.country ?? "Nigeria");
  const [countryCode, setCountryCode] = useState(
    (ctx.delivery_address?.country_code ?? "NG").toUpperCase(),
  );
  const [phone, setPhone] = useState(
    ctx.contact?.primary_phone ?? ctx.contact?.whatsapp_number ?? "",
  );
  const [email, setEmail] = useState(ctx.contact?.email ?? "");
  const [who, setWho] = useState({
    first_name: ctx.contact?.first_name ?? "",
    last_name: ctx.contact?.last_name ?? "",
    whatsapp: ctx.contact?.whatsapp_number ?? "",
    instagram: "",
  });
  const needsWho = !!ctx.require_contact_form;

  const [picks, setPicks] = useState<Record<number, { on: boolean; qty: number }>>(
    () =>
      Object.fromEntries(
        (ctx.items ?? []).map((it, i) => [i, { on: true, qty: it.qty || 1 }]),
      ),
  );

  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchGeoOptions().then((g) => alive && setGeo(g));
    return () => {
      alive = false;
    };
  }, []);

  const picked = useMemo(
    () =>
      (ctx.items ?? [])
        .map((it, idx) => ({
          ...it,
          idx,
          on: picks[idx]?.on ?? true,
          base_qty: it.qty || 1,
          qty: picks[idx]?.qty ?? it.qty ?? 1,
        }))
        .filter((it) => it.on),
    [ctx.items, picks],
  );
  const resolvedItems = useMemo(
    () =>
      picked
        .filter((i) => i.kind !== "service" && i.lines.length > 0)
        .map((i) => ({
          ...i,
          lines: i.lines.map((l) => ({
            ...l,
            quantity: Math.max(
              1,
              Math.round((l.quantity / Math.max(1, i.base_qty)) * i.qty) || i.qty,
            ),
          })),
        })),
    [picked],
  );
  const serviceItems = useMemo(
    () => picked.filter((i) => i.kind === "service" && i.service_id),
    [picked],
  );
  const unsupported = useMemo(
    () => picked.filter((i) => i.kind !== "service" && i.lines.length === 0),
    [picked],
  );
  const hasProducts = resolvedItems.length > 0;
  const serviceOnly = !hasProducts && serviceItems.length > 0;
  const bundleId = useMemo(
    () => resolvedItems.find((i) => i.kind === "bundle")?.bundle_id,
    [resolvedItems],
  );
  const totalQty = useMemo(
    () => resolvedItems.reduce((s, i) => s + i.qty, 0) || 1,
    [resolvedItems],
  );

  // Report the live selection so the team's chat sidebar updates. Best-effort.
  useEffect(() => {
    const t = setTimeout(() => {
      reportOrderLinkActivity(
        slug,
        picked.map((c) => ({
          kind: c.kind,
          ref_id: c.ref_id,
          name: c.name || "",
          qty: c.qty,
          price_ngn: c.price_ngn,
        })),
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [slug, picked]);

  const isNigeria = country === "Nigeria" || countryCode === "NG";
  const isLagos = isNigeria && norm(address.state) === "lagos";
  const effectiveZone = !isNigeria
    ? countryCode ||
      geo.countries.find((o) => norm(o.name) === norm(country))?.code ||
      ""
    : isLagos
      ? geo.lagos_lgas.find((o) => norm(o.name) === norm(address.city))?.code || ""
      : geo.nigeria_states.find((o) => norm(o.name) === norm(address.state))?.code ||
        "";

  useEffect(() => {
    if (serviceOnly || fulfilment !== "delivery" || !effectiveZone) {
      setDeliveryFee(null);
      setQuoting(false);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    fetchDeliveryQuote({ zoneCode: effectiveZone, qty: totalQty })
      .then((r) => !cancelled && setDeliveryFee(r?.fee_ngn ?? null))
      .finally(() => !cancelled && setQuoting(false));
    return () => {
      cancelled = true;
    };
  }, [serviceOnly, fulfilment, effectiveZone, totalQty]);

  const deliveryDue =
    fulfilment === "delivery" && deliveryFee != null ? deliveryFee : 0;
  const itemsSubtotal = useMemo(() => {
    const sum = (arr: typeof resolvedItems | typeof serviceItems) =>
      arr.reduce((s, i) => s + (Number(i.price_ngn) || 0) * i.qty, 0);
    return sum(resolvedItems) + sum(serviceItems);
  }, [resolvedItems, serviceItems]);
  const orderTotal = itemsSubtotal + deliveryDue;

  const canSubmit =
    !!phone &&
    (hasProducts || serviceItems.length > 0) &&
    (!needsWho || !!who.first_name.trim()) &&
    (serviceOnly ||
      fulfilment === "pickup" ||
      (!!address.line1 &&
        (!isNigeria || !!address.state) &&
        (!isLagos || !!effectiveZone)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setErr(null);

    const wantsDelivery = !serviceOnly && fulfilment === "delivery";
    if (wantsDelivery) {
      if (!effectiveZone) {
        setErr(
          isNigeria
            ? "Please pick your state (and LGA for Lagos) so we can calculate delivery."
            : "Please pick your country so we can calculate delivery.",
        );
        return;
      }
      if (quoting) {
        setErr("Calculating delivery… give it a second, then tap Pay again.");
        return;
      }
      if (!(deliveryFee != null && deliveryFee > 0)) {
        setErr(
          "We can't price delivery to this location yet. Check your address, or choose pickup.",
        );
        return;
      }
    }

    setStage("submitting");
    try {
      const chan =
        ctx.sales_channel &&
        ["public_form", "whatsapp", "instagram", "facebook"].includes(
          ctx.sales_channel,
        )
          ? ctx.sales_channel
          : "public_form";
      const result = await submitOrderLinkOrder({
        first_name: who.first_name.trim() || ctx.contact?.first_name || undefined,
        last_name: who.last_name.trim() || ctx.contact?.last_name || undefined,
        phone,
        email: email || undefined,
        whatsapp_number: who.whatsapp.trim() || undefined,
        instagram_handle: who.instagram.trim() || undefined,
        address: wantsDelivery
          ? {
              line1: address.line1,
              area: address.area || undefined,
              city: address.city || undefined,
              state: address.state || undefined,
              country: country || undefined,
              country_code: countryCode || undefined,
              landmark: address.landmark || undefined,
            }
          : undefined,
        order_link_slug: slug,
        service_bookings: serviceItems.length
          ? serviceItems.map((s) => ({
              service_id: s.service_id as string,
              qty: s.qty,
              price_ngn: s.price_ngn ?? undefined,
              note: s.note ?? undefined,
            }))
          : undefined,
        fulfilment_type: serviceOnly ? "pickup" : fulfilment,
        zone_code: wantsDelivery ? effectiveZone : undefined,
        delivery_address: wantsDelivery
          ? [
              address.line1,
              address.area,
              address.city,
              address.state,
              country,
              address.landmark ? `Landmark: ${address.landmark}` : null,
            ]
              .filter(Boolean)
              .join(", ")
          : undefined,
        sales_channel: chan,
        items: resolvedItems.flatMap((i) => i.lines),
        bundle_id: bundleId || undefined,
        payment_plan: "full",
        client_idempotency_key: `order:${slug}`,
      });

      // Straight to the gateway (Nomba). A product order carries a tracking
      // token → mint a checkout for the full balance and redirect. If no
      // gateway is configured / init fails, show the confirmation instead.
      const token = result?.public_tracking_token;
      if (result?.order_id && token) {
        try {
          const pay = await createOrderPayLink(token);
          if (pay?.checkout_url) {
            window.location.href = pay.checkout_url;
            return;
          }
        } catch {
          /* fall through to confirmation */
        }
      }
      setStage("done");
    } catch (e: unknown) {
      setErr(
        (e as { userMessage?: string })?.userMessage ||
          (e instanceof Error ? e.message : "Couldn't place your order. Try again."),
      );
      setStage("form");
    }
  }

  if (stage === "done") {
    return (
      <Section className="max-w-xl">
        <div className="py-14 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-9 w-9 text-emerald-500" />
          <p className="text-body font-display text-xl">Order placed 🌹</p>
          <p className="mx-auto mt-2 max-w-sm text-body-sm text-muted-foreground">
            We&rsquo;ll send you a payment link on WhatsApp in a moment. Once
            payment lands, your order moves into production.
          </p>
        </div>
      </Section>
    );
  }

  return (
    <Section className="max-w-xl">
      <p className="text-caption">Your order</p>
      <h1 className="mt-2 text-h3 font-display">
        Hi {ctx.contact?.first_name || who.first_name || "there"} 💕
      </h1>
      <p className="mt-1 text-body-sm text-muted-foreground">
        Here&rsquo;s a selection we picked for you. Choose what you&rsquo;d like,
        confirm delivery, and pay.
      </p>

      {/* Items */}
      <div className="mt-6 space-y-2">
        <p className="text-caption mb-1 flex items-center gap-2">
          <ShoppingBag className="h-3.5 w-3.5" /> Pick your items
        </p>
        {(ctx.items ?? []).map((it, idx) => {
          const p = picks[idx] ?? { on: true, qty: it.qty || 1 };
          const isSvc = it.kind === "service";
          const unavailable = !isSvc && it.lines.length === 0;
          return (
            <div
              key={`${it.kind}-${it.ref_id}-${idx}`}
              className={`rounded-md border border-border p-3 ${p.on ? "" : "opacity-50"}`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={p.on}
                  onChange={(e) =>
                    setPicks((m) => ({ ...m, [idx]: { ...p, on: e.target.checked } }))
                  }
                  className="h-4 w-4 shrink-0 accent-foreground"
                  aria-label={`Include ${it.name ?? "item"}`}
                />
                {it.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.image_url}
                    alt=""
                    className="h-14 w-14 rounded-md border border-border object-cover"
                  />
                ) : (
                  <div className="grid h-14 w-14 place-items-center rounded-md border border-border text-muted-foreground">
                    <ShoppingBag className="h-4 w-4" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm">
                    {it.name ?? (isSvc ? "Service" : "Product")}
                    {isSvc && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        service
                      </span>
                    )}
                  </p>
                  {it.price_ngn != null && (
                    <p className="text-body-sm text-muted-foreground">
                      {money(Number(it.price_ngn))}
                    </p>
                  )}
                  {it.note && (
                    <p className="truncate text-body-sm text-muted-foreground">
                      {it.note}
                    </p>
                  )}
                  {unavailable && (
                    <p className="mt-0.5 text-body-sm text-amber-600">
                      Unavailable right now — we&rsquo;ll confirm by WhatsApp.
                    </p>
                  )}
                </div>
                {p.on && !isSvc && (
                  <div className="flex shrink-0 items-center gap-1 rounded-md border border-border">
                    <button
                      type="button"
                      onClick={() =>
                        setPicks((m) => ({
                          ...m,
                          [idx]: { ...p, qty: Math.max(1, p.qty - 1) },
                        }))
                      }
                      className="grid h-7 w-7 place-items-center hover:bg-secondary"
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-body-sm tabular-nums">
                      {p.qty}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPicks((m) => ({
                          ...m,
                          [idx]: { ...p, qty: Math.min(100, p.qty + 1) },
                        }))
                      }
                      className="grid h-7 w-7 place-items-center hover:bg-secondary"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {unsupported.length > 0 && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-body-sm text-amber-700">
            Some items couldn&rsquo;t be added automatically — our team will
            follow up on WhatsApp to finalise those before shipping.
          </p>
        )}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-5">
        {needsWho && (
          <div className="space-y-2">
            <p className="text-caption">Tell us who you are</p>
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="First name"
                required
                value={who.first_name}
                onChange={(v) => setWho({ ...who, first_name: v })}
              />
              <Field
                label="Last name"
                value={who.last_name}
                onChange={(v) => setWho({ ...who, last_name: v })}
              />
            </div>
            <Field
              label="WhatsApp number"
              value={who.whatsapp}
              onChange={(v) => setWho({ ...who, whatsapp: v })}
              placeholder="e.g. +2348012345678"
            />
          </div>
        )}

        {!serviceOnly && (
          <div className="space-y-2">
            <p className="text-caption">How would you like it</p>
            <div className="grid grid-cols-2 gap-2">
              <Pill
                active={fulfilment === "delivery"}
                onClick={() => setFulfilment("delivery")}
                icon={<Truck className="h-3.5 w-3.5" />}
                label="Delivery"
              />
              <Pill
                active={fulfilment === "pickup"}
                onClick={() => setFulfilment("pickup")}
                icon={<Store className="h-3.5 w-3.5" />}
                label="Pickup in store"
              />
            </div>
          </div>
        )}

        {!serviceOnly && fulfilment === "delivery" && (
          <div className="space-y-2">
            <p className="text-caption">Delivery</p>
            <Field
              label="Street / house"
              required
              value={address.line1}
              onChange={(v) => setAddress({ ...address, line1: v })}
              placeholder="e.g. 12 Admiralty Way"
            />
            <Field
              label="Area / neighbourhood"
              value={address.area}
              onChange={(v) => setAddress({ ...address, area: v })}
            />
            <label className="block">
              <span className="mb-1 block text-body-sm text-muted-foreground">
                Country
              </span>
              <select
                value={country}
                onChange={(e) => {
                  const name = e.target.value;
                  const opt = geo.countries.find((o) => o.name === name);
                  setCountry(name);
                  setCountryCode(opt?.code ?? "");
                  setAddress((a) => ({ ...a, state: "", city: "" }));
                }}
                className="w-full rounded-md border border-border bg-background p-3 text-body-sm outline-none focus:border-foreground/40"
              >
                {geo.countries.map((o) => (
                  <option key={o.code} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            {isNigeria ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-body-sm text-muted-foreground">
                    State
                  </span>
                  <select
                    value={address.state}
                    onChange={(e) =>
                      setAddress({ ...address, state: e.target.value, city: "" })
                    }
                    className="w-full rounded-md border border-border bg-background p-3 text-body-sm outline-none focus:border-foreground/40"
                  >
                    <option value="">Select your state…</option>
                    {geo.nigeria_states.map((o) => (
                      <option key={o.code} value={o.name}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                {isLagos ? (
                  <label className="block">
                    <span className="mb-1 block text-body-sm text-muted-foreground">
                      LGA
                    </span>
                    <select
                      value={address.city}
                      onChange={(e) =>
                        setAddress({ ...address, city: e.target.value })
                      }
                      className="w-full rounded-md border border-border bg-background p-3 text-body-sm outline-none focus:border-foreground/40"
                    >
                      <option value="">Select your LGA…</option>
                      {geo.lagos_lgas.map((o) => (
                        <option key={o.code} value={o.name}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <Field
                    label="City"
                    value={address.city}
                    onChange={(v) => setAddress({ ...address, city: v })}
                  />
                )}
              </div>
            ) : (
              <Field
                label="City"
                value={address.city}
                onChange={(v) => setAddress({ ...address, city: v })}
              />
            )}
            <Field
              label="Landmark (helps the rider)"
              value={address.landmark}
              onChange={(v) => setAddress({ ...address, landmark: v })}
            />
          </div>
        )}

        <div className="space-y-2">
          <p className="text-caption">Contact</p>
          <Field
            label="Phone (for delivery)"
            required
            type="tel"
            value={phone}
            onChange={setPhone}
            placeholder="+234…"
          />
          <Field
            label="Email (receipt)"
            type="email"
            value={email}
            onChange={setEmail}
          />
        </div>

        {/* Summary */}
        {(hasProducts || serviceItems.length > 0) && (
          <div className="rounded-md border border-border p-4">
            <div className="flex items-center justify-between text-body-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{money(itemsSubtotal)}</span>
            </div>
            {!serviceOnly && fulfilment === "delivery" && (
              <div className="mt-1 flex items-center justify-between text-body-sm">
                <span className="text-muted-foreground">Delivery</span>
                <span className="tabular-nums">
                  {quoting
                    ? "Calculating…"
                    : deliveryDue > 0
                      ? money(deliveryDue)
                      : "—"}
                </span>
              </div>
            )}
            <div className="my-2 h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="text-body font-medium">Total</span>
              <span className="text-body font-display tabular-nums">
                {money(orderTotal)}
              </span>
            </div>
          </div>
        )}

        {err && (
          <p className="flex items-center gap-2 text-body-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {err}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit || stage === "submitting"}
          className="grid w-full place-items-center bg-foreground py-4 text-body-sm font-medium text-background disabled:opacity-50"
        >
          {stage === "submitting" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : serviceOnly ? (
            "Place booking request"
          ) : (
            `Place order & pay ${money(orderTotal)}`
          )}
        </button>

        <p className="flex items-start gap-2 text-body-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Secured by a one-time link bound to this conversation.
        </p>
      </form>
    </Section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-body-sm text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background p-3 text-body-sm outline-none focus:border-foreground/40"
      />
    </label>
  );
}

function Pill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-md border py-3 text-body-sm ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:bg-secondary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
