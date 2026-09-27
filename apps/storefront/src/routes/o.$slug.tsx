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
import { usePageSlots, withSlots } from "@/lib/site-config";
import { Section } from "@/components/parts";
import {
  getOrderLink,
  submitOrderLinkOrder,
  createOrderPayLink,
  reportOrderLinkActivity,
  getPayConfig,
  type OrderLinkContext,
  type OrderLinkItem,
  type OrderFormResult,
  type PayConfig,
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

// Studio-editable copy for the pay-by-link checkout (usePageSlots("order_link")),
// resolved the same way in the wrapper (link/status states) and the form.
const ORDER_LINK_DEFAULTS = {
  linkInvalidTitle: "Sorry — this link doesn't work",
  linkInvalidBody:
    "This order link is no longer valid. Please ask us for a fresh one.",
  alreadyPlacedTitle: "Order already placed 🌹",
  alreadyPlacedWithOrder:
    "This link was used to place order {order}. Message us on WhatsApp if you'd like to order again — we'll send a fresh link.",
  alreadyPlacedNoOrder:
    "This link was used to place your order. Message us on WhatsApp if you'd like to order again — we'll send a fresh link.",
  doneTitle: "Order placed 🌹",
  doneBody:
    "We couldn't open the payment page just now, so we'll send you a payment link on WhatsApp in a moment. Once payment lands, your order moves into production.",
  eyebrow: "Your order",
  greetingPrefix: "Hi ",
  greetingSuffix: " 💕",
  nameFallback: "there",
  intro:
    "Here's a selection we picked for you. Choose what you'd like, confirm delivery, and pay.",
  pickItemsLabel: "Pick your items",
  itemServiceFallback: "Service",
  itemProductFallback: "Product",
  serviceBadge: "service",
  unavailableNote: "Unavailable right now — we'll confirm by WhatsApp.",
  unsupportedNote:
    "Some items couldn't be added automatically — our team will follow up on WhatsApp to finalise those before shipping.",
  whoLabel: "Tell us who you are",
  firstNameLabel: "First name",
  lastNameLabel: "Last name",
  whatsappLabel: "WhatsApp number",
  whatsappPlaceholder: "e.g. +2348012345678",
  fulfilmentLabel: "How would you like it",
  deliveryLabel: "Delivery",
  pickupLabel: "Pickup in store",
  deliverySectionLabel: "Delivery",
  streetLabel: "Street / house",
  streetPlaceholder: "e.g. 12 Admiralty Way",
  areaLabel: "Area / neighbourhood",
  countryLabel: "Country",
  stateLabel: "State",
  statePlaceholder: "Select your state…",
  lgaLabel: "LGA",
  lgaPlaceholder: "Select your LGA…",
  cityLabel: "City",
  landmarkLabel: "Landmark (helps the rider)",
  contactLabel: "Contact",
  phoneLabel: "Phone (for delivery)",
  phonePlaceholder: "+234…",
  emailLabel: "Email (receipt)",
  payWithLabel: "Pay with",
  subtotalLabel: "Subtotal",
  deliverySummaryLabel: "Delivery",
  careVatLabel: "VAT (care products)",
  calculating: "Calculating…",
  totalLabel: "Total",
  bookingCta: "Place booking request",
  payCta: "Place order & pay {total}",
  securedNote: "Secured by a one-time link bound to this conversation.",
  errPickStateNg:
    "Please pick your state (and LGA for Lagos) so we can calculate delivery.",
  errPickCountry: "Please pick your country so we can calculate delivery.",
  errCalculating: "Calculating delivery… give it a second, then tap Pay again.",
  errUndeliverable:
    "We can't price delivery to this location yet. Check your address, or choose pickup.",
  errPlaceFailed: "Couldn't place your order. Try again.",
  // Care & Accessories. The notice headline is fixed policy wording and is
  // deliberately NOT a Studio slot: it must read exactly "EXTRA DELIVERY FEES
  // MAY APPLY" (MAY, never WILL), bold and uppercase.
  careDeliveryBody:
    "Delivery for orders with care products is arranged with our team. Choose pickup in store, or message us on WhatsApp and we'll set up delivery for you.",
  careDeliveryUnavailable: "Arranged by our team",
  errCareDelivery:
    "Orders with care products can't be delivered from this page yet. Choose pickup in store, or message us on WhatsApp to arrange delivery.",
};
export const CARE_DELIVERY_NOTICE = "EXTRA DELIVERY FEES MAY APPLY";
function useOrderLinkCopy() {
  return withSlots(ORDER_LINK_DEFAULTS, usePageSlots("order_link"));
}

function OrderLinkCheckout() {
  const { slug } = Route.useParams();
  const [currency] = useCurrency();
  const s = useOrderLinkCopy();
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
      s.linkInvalidBody;
    return (
      <Section className="max-w-xl">
        <div className="py-14 text-center">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <p className="text-body font-display text-lg">{s.linkInvalidTitle}</p>
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
          <p className="text-body font-display text-xl">{s.alreadyPlacedTitle}</p>
          <p className="mx-auto mt-2 max-w-sm text-body-sm text-muted-foreground">
            {q.data.order_number
              ? s.alreadyPlacedWithOrder.replace("{order}", q.data.order_number)
              : s.alreadyPlacedNoOrder}
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
  // Pre-order notice (000086) surfaced on the confirmation screen.
  const [preorderInfo, setPreorderInfo] =
    useState<OrderFormResult["preorder"]>(null);
  const s = useOrderLinkCopy();

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
  const [hasSpecificInstructions, setHasSpecificInstructions] = useState(false);
  const [specificInstructions, setSpecificInstructions] = useState("");
  // Buyer's gateway pick — shown only when the brand has >1 pickable gateway
  // active; the server prefers the pick and falls over if it's down.
  const [payCfg, setPayCfg] = useState<PayConfig | null>(null);
  const [gateway, setGateway] = useState("nomba");

  useEffect(() => {
    let alive = true;
    fetchGeoOptions().then((g) => alive && setGeo(g));
    const chan =
      ctx.sales_channel &&
      ["public_form", "whatsapp", "instagram", "facebook"].includes(
        ctx.sales_channel,
      )
        ? ctx.sales_channel
        : "public_form";
    getPayConfig(ctx.brand, chan)
      .then((cfg) => {
        if (!alive) return;
        setPayCfg(cfg);
        if (cfg.gateways?.length && !cfg.gateways.includes("nomba")) {
          setGateway(cfg.gateways[0]);
        }
      })
      .catch(() => {
        /* no picker on failure — server default (Nomba-first) applies */
      });
    return () => {
      alive = false;
    };
  }, [ctx.brand, ctx.sales_channel]);

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
  // Care & Accessories never count toward the wig-quantity delivery band. The
  // server re-classifies every line from the exact variant id, so this is
  // display only.
  const hasRetail = useMemo(
    () => resolvedItems.some((i) => i.kind === "retail"),
    [resolvedItems],
  );
  const totalQty = useMemo(
    () =>
      resolvedItems
        .filter((i) => i.kind !== "retail")
        .reduce((s, i) => s + i.qty, 0) || 1,
    [resolvedItems],
  );
  // Charged web delivery for a retail-containing basket is fail-closed until
  // the owner approves the initial-fee and retail-tax assumptions (the server
  // answers RETAIL_DELIVERY_ARRANGED). Pickup stays available.
  useEffect(() => {
    if (hasRetail && fulfilment === "delivery") setFulfilment("pickup");
  }, [hasRetail, fulfilment]);

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
  // VAT on taxable Care & Accessories lines — Sales adds it on top of the
  // price, so the preview must too (rounded per line like the server).
  const careVat = useMemo(
    () =>
      resolvedItems.reduce(
        (sum, i) =>
          i.kind === "retail" && i.taxable && i.vat_rate
            ? sum + Math.round((Number(i.price_ngn) || 0) * i.qty * Number(i.vat_rate) * 100) / 100
            : sum,
        0,
      ),
    [resolvedItems],
  );
  const orderTotal = itemsSubtotal + careVat + deliveryDue;

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
    if (wantsDelivery && hasRetail) {
      setErr(s.errCareDelivery);
      return;
    }
    if (wantsDelivery) {
      if (!effectiveZone) {
        setErr(isNigeria ? s.errPickStateNg : s.errPickCountry);
        return;
      }
      if (quoting) {
        setErr(s.errCalculating);
        return;
      }
      if (!(deliveryFee != null && deliveryFee > 0)) {
        setErr(s.errUndeliverable);
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
        specific_instructions: hasSpecificInstructions && specificInstructions.trim() ? specificInstructions.trim().slice(0,2000) : undefined,
        payment_plan: "full",
        payment_gateway: gateway,
        client_idempotency_key: `order:${slug}`,
      });

      setPreorderInfo(result?.preorder ?? null);
      // Straight to the gateway (Nomba). The order-form mints the checkout
      // link server-side and returns it — redirect in one step. Stash the
      // pre-order notice so the thank-you page can greet the buyer after paying.
      if (result?.payment_url) {
        if (result.preorder?.is_preorder) {
          try {
            sessionStorage.setItem(
              "pgh_preorder",
              JSON.stringify(result.preorder),
            );
          } catch {
            /* storage unavailable */
          }
        }
        window.location.href = result.payment_url;
        return;
      }
      // Backup only (gateway hiccup): retry via the tracking token — no
      // re-order, since the order already exists. Confirmation is the last
      // resort so a paid-capable order never dead-ends.
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
          (e instanceof Error ? e.message : s.errPlaceFailed),
      );
      setStage("form");
    }
  }

  if (stage === "done") {
    return (
      <Section className="max-w-xl">
        <div className="py-14 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-9 w-9 text-emerald-500" />
          <p className="text-body font-display text-xl">{s.doneTitle}</p>
          <p className="mx-auto mt-2 max-w-sm text-body-sm text-muted-foreground">
            {s.doneBody}
          </p>
          {preorderInfo?.is_preorder ? (
            <div className="mx-auto mt-5 max-w-sm rounded-lg border border-taupe/30 bg-taupe/10 px-4 py-3 text-left">
              <span className="text-[0.62rem] font-medium uppercase tracking-[0.22em] text-taupe">
                Pre-order
              </span>
              <p className="mt-1 text-body-sm text-foreground/80">
                {preorderInfo.message ||
                  (preorderInfo.window_label
                    ? `Some of your items are made to order and ship in about ${preorderInfo.window_label}.`
                    : "Some of your items are made to order. We'll keep you posted.")}
              </p>
            </div>
          ) : null}
        </div>
      </Section>
    );
  }

  return (
    <Section className="max-w-xl">
      <p className="text-caption">{s.eyebrow}</p>
      <h1 className="mt-2 text-h3 font-display">
        {s.greetingPrefix}
        {ctx.contact?.first_name || who.first_name || s.nameFallback}
        {s.greetingSuffix}
      </h1>
      <p className="mt-1 text-body-sm text-muted-foreground">{s.intro}</p>

      {/* Items */}
      <div className="mt-6 space-y-2">
        <p className="text-caption mb-1 flex items-center gap-2">
          <ShoppingBag className="h-3.5 w-3.5" /> {s.pickItemsLabel}
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
                    {it.name ?? (isSvc ? s.itemServiceFallback : s.itemProductFallback)}
                    {isSvc && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {s.serviceBadge}
                      </span>
                    )}
                  </p>
                  {it.kind === "retail" && it.variant_label && (
                    <p className="truncate text-body-sm text-muted-foreground">
                      {it.variant_label}
                    </p>
                  )}
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
                      {it.kind === "retail" && it.unresolved_reason
                        ? it.unresolved_reason
                        : s.unavailableNote}
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
            {s.unsupportedNote}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-5">
        {needsWho && (
          <div className="space-y-2">
            <p className="text-caption">{s.whoLabel}</p>
            <div className="grid grid-cols-2 gap-2">
              <Field
                label={s.firstNameLabel}
                required
                value={who.first_name}
                onChange={(v) => setWho({ ...who, first_name: v })}
              />
              <Field
                label={s.lastNameLabel}
                value={who.last_name}
                onChange={(v) => setWho({ ...who, last_name: v })}
              />
            </div>
            <Field
              label={s.whatsappLabel}
              value={who.whatsapp}
              onChange={(v) => setWho({ ...who, whatsapp: v })}
              placeholder={s.whatsappPlaceholder}
            />
          </div>
        )}

        {!serviceOnly && (
          <div className="space-y-2">
            <p className="text-caption">{s.fulfilmentLabel}</p>
            <div className="grid grid-cols-2 gap-2">
              <Pill
                active={fulfilment === "delivery"}
                onClick={() => setFulfilment("delivery")}
                icon={<Truck className="h-3.5 w-3.5" />}
                label={hasRetail ? `${s.deliveryLabel} · ${s.careDeliveryUnavailable}` : s.deliveryLabel}
                disabled={hasRetail}
              />
              <Pill
                active={fulfilment === "pickup"}
                onClick={() => setFulfilment("pickup")}
                icon={<Store className="h-3.5 w-3.5" />}
                label={s.pickupLabel}
              />
            </div>
            {hasRetail && (
              <div
                role="note"
                data-testid="care-delivery-notice"
                className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-body-sm"
              >
                <p className="font-bold uppercase tracking-wide">
                  {CARE_DELIVERY_NOTICE}
                </p>
                <p className="mt-1 text-muted-foreground">{s.careDeliveryBody}</p>
              </div>
            )}
          </div>
        )}

        {!serviceOnly && fulfilment === "delivery" && (
          <div className="space-y-2">
            <p className="text-caption">{s.deliverySectionLabel}</p>
            <Field
              label={s.streetLabel}
              required
              value={address.line1}
              onChange={(v) => setAddress({ ...address, line1: v })}
              placeholder={s.streetPlaceholder}
            />
            <Field
              label={s.areaLabel}
              value={address.area}
              onChange={(v) => setAddress({ ...address, area: v })}
            />
            <label className="block">
              <span className="mb-1 block text-body-sm text-muted-foreground">
                {s.countryLabel}
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
                    {s.stateLabel}
                  </span>
                  <select
                    value={address.state}
                    onChange={(e) =>
                      setAddress({ ...address, state: e.target.value, city: "" })
                    }
                    className="w-full rounded-md border border-border bg-background p-3 text-body-sm outline-none focus:border-foreground/40"
                  >
                    <option value="">{s.statePlaceholder}</option>
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
                      {s.lgaLabel}
                    </span>
                    <select
                      value={address.city}
                      onChange={(e) =>
                        setAddress({ ...address, city: e.target.value })
                      }
                      className="w-full rounded-md border border-border bg-background p-3 text-body-sm outline-none focus:border-foreground/40"
                    >
                      <option value="">{s.lgaPlaceholder}</option>
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
                label={s.cityLabel}
                value={address.city}
                onChange={(v) => setAddress({ ...address, city: v })}
              />
            )}
            <Field
              label={s.landmarkLabel}
              value={address.landmark}
              onChange={(v) => setAddress({ ...address, landmark: v })}
            />
          </div>
        )}

        <div className="space-y-2">
          <p className="text-caption">{s.contactLabel}</p>
          <Field
            label={s.phoneLabel}
            required
            type="tel"
            value={phone}
            onChange={setPhone}
            placeholder={s.phonePlaceholder}
          />
          <Field
            label={s.emailLabel}
            type="email"
            value={email}
            onChange={setEmail}
          />
        </div>

        <div className="space-y-2 rounded-md border border-border p-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={hasSpecificInstructions} onChange={(e)=>setHasSpecificInstructions(e.target.checked)} className="h-4 w-4" />
            <span className="text-body-sm font-medium">Add specific instructions</span>
          </label>
          {hasSpecificInstructions && (
            <div className="mt-2">
              <textarea value={specificInstructions} onChange={(e)=>setSpecificInstructions(e.target.value.slice(0,2000))} placeholder="Any special request? e.g. styling preference, delivery note…" rows={3} maxLength={2000} className="w-full rounded-md border border-border bg-background p-2 text-body-sm resize-none" />
              <div className="mt-1 text-right text-[11px] text-muted-foreground">{specificInstructions.length}/2000</div>
            </div>
          )}
        </div>

        {/* Gateway pick — mirrors the main storefront checkout. Hidden when
            the brand has one (or no reported) pickable gateway. */}
        {!serviceOnly && (payCfg?.gateways?.length ?? 0) > 1 && (
          <div className="space-y-2">
            <p className="text-caption">{s.payWithLabel}</p>
            <div className="grid grid-cols-2 gap-2">
              {(payCfg?.gateways ?? []).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGateway(g)}
                  className={`rounded-md border py-3 text-body-sm capitalize ${
                    gateway === g
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {(hasProducts || serviceItems.length > 0) && (
          <div className="rounded-md border border-border p-4">
            <div className="flex items-center justify-between text-body-sm">
              <span className="text-muted-foreground">{s.subtotalLabel}</span>
              <span className="tabular-nums">{money(itemsSubtotal)}</span>
            </div>
            {careVat > 0 && (
              <div className="mt-1 flex items-center justify-between text-body-sm">
                <span className="text-muted-foreground">{s.careVatLabel}</span>
                <span className="tabular-nums">{money(careVat)}</span>
              </div>
            )}
            {!serviceOnly && fulfilment === "delivery" && (
              <div className="mt-1 flex items-center justify-between text-body-sm">
                <span className="text-muted-foreground">{s.deliverySummaryLabel}</span>
                <span className="tabular-nums">
                  {quoting
                    ? s.calculating
                    : deliveryDue > 0
                      ? money(deliveryDue)
                      : "—"}
                </span>
              </div>
            )}
            <div className="my-2 h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="text-body font-medium">{s.totalLabel}</span>
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
            s.bookingCta
          ) : (
            s.payCta.replace("{total}", money(orderTotal))
          )}
        </button>

        <p className="flex items-start gap-2 text-body-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {s.securedNote}
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
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-3 text-body-sm ${
        disabled
          ? "cursor-not-allowed border-border text-muted-foreground opacity-50"
          : active
            ? "border-foreground bg-foreground text-background"
            : "border-border text-muted-foreground hover:bg-secondary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
