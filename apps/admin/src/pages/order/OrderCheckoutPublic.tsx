import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  ShoppingBag,
  ShieldCheck,
  Truck,
  Store,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatDateTime, formatDate } from "@/lib/format";
import {
  fetchGeoOptions,
  fetchDeliveryQuote,
  GEO_FALLBACK,
  type GeoOptions,
} from "@/lib/order-checkout-geo";
import { PublicBrandShell } from "@/components/public/PublicBrandShell";
import { cn } from "@/lib/cn";

/**
 * Public order checkout (`/o/:slug`).
 *
 * The customer lands here from a short link a staffer shared inside a
 * Smartcomm chat. We resolve the slug via the public order-link endpoint,
 * hydrate the item list + their delivery address from `contact_addresses`,
 * let them pick items + confirm / edit the address (with the same country →
 * state → LGA delivery-fee gating as the main storefront checkout), then
 * post to the public order-form endpoint to create a real order and
 * redirect them straight to the payment gateway (Nomba). The server
 * re-quotes the delivery fee + prices the order itself — it never trusts a
 * client-side number.
 *
 * The customer never has to retype their address — it's pre-filled from the
 * Online QR form they completed earlier (or the contact we already had).
 */

interface PrefillLine {
  variant_id: string;
  quantity: number;
}

// Fixed policy wording for retail-containing delivery — exact text, bold
// uppercase, MAY never WILL.
const CARE_DELIVERY_NOTICE = "EXTRA DELIVERY FEES MAY APPLY";

interface PrefillItem {
  kind: "base" | "styled" | "bundle" | "service" | "retail";
  ref_id: string | null;
  // Care & Accessories (kind "retail"): exact SKU picked by staff. The server
  // re-resolves and re-prices it; the browser never classifies a line.
  variant_id?: string | null;
  variant_label?: string | null;
  sku?: string | null;
  unresolved_reason?: string | null;
  // Retail tax (server-resolved). Sales ADDS a taxable item's VAT on top of
  // its price, so the preview total must too.
  taxable?: boolean;
  vat_rate?: number | null;
  qty: number;
  price_ngn: string | null;
  note: string | null;
  name: string | null;
  product_code: string | null;
  image_url: string | null;
  // Resolved sellable variant line(s) — empty when the item couldn't be
  // resolved (deleted/out-of-stock product, unresolvable bundle
  // component, etc.), in which case it's excluded from the submitted
  // order and flagged for manual follow-up instead. Service items never
  // carry lines — they submit as booking requests.
  lines: PrefillLine[];
  bundle_id?: string;
  service_id?: string;
  duration_minutes?: number | null;
}

interface PrefillAddress {
  line1: string | null;
  line2: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  country_code: string | null;
  landmark: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface PrefillContext {
  status?: "active" | "ordered";
  brand: string;
  slug?: string;
  sales_channel: string | null;
  expires_at: string;
  // NGN per $1 from the brand's Catalogue → Config USD rate.
  fx_rate_ngn_per_usd?: number | null;
  // The currency staff chose for this link — the customer pays in it.
  currency?: "NGN" | "USD";
  // USD link: each item's dollar price (index-aligned with `items`; null =
  // not sellable) + the catalogue rate for delivery (₦ ÷ rate, rounded UP).
  usd?: { rate: number | null; prices: (string | null)[] } | null;
  // Null on no-contact links: the page shows the inline "your details"
  // block (welcome-form mirror) and the contact is created at submit.
  contact: {
    contact_id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    primary_phone: string | null;
    whatsapp_number: string | null;
    email: string | null;
  } | null;
  require_contact_form?: boolean;
  delivery_address: PrefillAddress | null;
  items: PrefillItem[];
  notes: string | null;
  // Present when status === "ordered" (single-use link already consumed).
  order_number?: string | null;
  ordered_at?: string | null;
}

interface OrderFormResult {
  order_id: string | null;
  order_number: string | null;
  total_ngn: string | null;
  payment_plan: "full" | "instalment" | null;
  // Amount to charge now (server-computed): the plan deposit for instalment,
  // else the full balance. Null for service-only checkouts.
  pay_now_ngn: string | null;
  // Gateway checkout URL minted server-side inside the order-form call
  // (Nomba/Paystack, buyer's pick preferred) — the page redirects straight
  // here. Null only when the gateway hiccuped; the /pay/{token} retry below
  // is the backup.
  payment_url: string | null;
  public_tracking_token: string | null;
  contact_id: string;
  booking_count: number;
  // Pre-order notice (000086) — present only when a line actually went in as
  // made-to-order, so the confirmation screen can tell the buyer it's coming.
  preorder?: {
    is_preorder: boolean;
    line_count: number;
    names?: string[];
    window_label?: string | null;
    min_weeks?: number | null;
    max_weeks?: number | null;
    ready_by?: string | null;
    message?: string;
  } | null;
}

type Stage = "loading" | "form" | "submitting" | "done" | "used" | "error";
type Fulfilment = "delivery" | "pickup";

const norm = (s: string) => s.trim().toLowerCase();

export function OrderCheckoutPublic() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [ctx, setCtx] = useState<PrefillContext | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Pre-order notice (000086) surfaced on the confirmation screen.
  const [preorderInfo, setPreorderInfo] =
    useState<OrderFormResult["preorder"]>(null);

  const [fulfilment, setFulfilment] = useState<Fulfilment>("delivery");
  // Flexi Pay (PR-2): offer the instalment plan when the channel enables it.
  // The customer receives a pay link and pays via the /pay/{token} page; the
  // plan controls the deposit minimum + balance reminders.
  const [flexi, setFlexi] = useState<{
    instalments_enabled: boolean;
    plan_display_name?: string;
    plan_terms?: string[];
    gateways?: string[];
  } | null>(null);
  const [paymentPlan, setPaymentPlan] = useState<"full" | "instalment">("full");
  // The buyer's gateway pick (Nomba default). Only shown when the brand has
  // more than one buyer-pickable gateway active; the server prefers the pick
  // but still falls over automatically if that gateway is down.
  const [gateway, setGateway] = useState("nomba");
  const [geo, setGeo] = useState<GeoOptions>(GEO_FALLBACK);
  const [address, setAddress] = useState({
    line1: "",
    area: "",
    city: "",
    state: "",
    landmark: "",
  });
  const [country, setCountry] = useState("Nigeria");
  const [countryCode, setCountryCode] = useState("NG");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Inline welcome-form mirror (no-contact links) + shop-mode selection
  // + service booking preferences.
  const [who, setWho] = useState({
    first_name: "",
    last_name: "",
    whatsapp: "",
    instagram: "",
  });
  // Per-item state keyed by item index: included? + qty (the customer
  // includes/excludes and re-quantities the curated picks).
  const [picks, setPicks] = useState<Record<number, { on: boolean; qty: number }>>({});
  const [svcTimes, setSvcTimes] = useState<Record<number, string>>({});

  // Live delivery-fee quote — resolves once the zone is fully picked
  // (country for non-NG; state, then LGA for Lagos, for Nigeria).
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [deliveryZoneName, setDeliveryZoneName] = useState<string | null>(
    null,
  );
  const [quoting, setQuoting] = useState(false);
  const [showDeliveryHelp, setShowDeliveryHelp] = useState(false);
  const [hasSpecificInstructions, setHasSpecificInstructions] = useState(false);
  const [specificInstructions, setSpecificInstructions] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<PrefillContext>(
          `/order-link/${encodeURIComponent(slug)}`,
          "public",
        );
        if (cancelled) return;
        setCtx(data);
        if (data.status === "ordered") {
          setStage("used");
          return;
        }
        // Everything starts selected; the customer can prune + re-quantity
        // the curated picks below.
        setPicks(
          Object.fromEntries(
            (data.items ?? []).map((it, idx) => [idx, { on: true, qty: it.qty || 1 }]),
          ),
        );
        if (data.delivery_address) {
          setAddress({
            line1: data.delivery_address.line1 ?? "",
            area: data.delivery_address.area ?? "",
            city: data.delivery_address.city ?? "",
            state: data.delivery_address.state ?? "",
            landmark: data.delivery_address.landmark ?? "",
          });
          if (data.delivery_address.country) {
            setCountry(data.delivery_address.country);
          }
          if (data.delivery_address.country_code) {
            setCountryCode(data.delivery_address.country_code.toUpperCase());
          }
        }
        setPhone(
          data.contact?.primary_phone || data.contact?.whatsapp_number || "",
        );
        setEmail(data.contact?.email ?? "");
        setWho((w) => ({
          ...w,
          first_name: data.contact?.first_name ?? "",
          last_name: data.contact?.last_name ?? "",
          whatsapp: data.contact?.whatsapp_number ?? "",
        }));
        fetchGeoOptions(data.brand).then((g) => {
          if (!cancelled) setGeo(g);
        });
        // Flexi Pay availability for this channel (best-effort; a failure just
        // hides the plan picker, defaulting to pay-in-full).
        const ch =
          data.sales_channel &&
          ["public_form", "whatsapp", "instagram", "facebook"].includes(
            data.sales_channel,
          )
            ? data.sales_channel
            : "public_form";
        api
          .get<{
            instalments_enabled: boolean;
            plan_display_name?: string;
            plan_terms?: string[];
            gateways?: string[];
          }>(
            `/pay/config/${encodeURIComponent(data.brand)}?channel=${encodeURIComponent(ch)}`,
            "public",
          )
          .then((cfg) => {
            if (cancelled) return;
            setFlexi(cfg);
            if (cfg.gateways?.length && !cfg.gateways.includes("nomba")) {
              setGateway(cfg.gateways[0]);
            }
          })
          .catch(() => {
            /* no picker on failure */
          });
        setStage("form");
      } catch (e: unknown) {
        if (cancelled) return;
        setErrMsg(
          e instanceof Error ? e.message : "We couldn't open this order link.",
        );
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // The curated mini-shop always lets the customer include/exclude and
  // re-quantity the picks the team shared.
  const isShop = true;
  // The customer's live pick: item + chosen qty.
  const picked = useMemo(
    () =>
      (ctx?.items ?? [])
        .map((it, idx) => ({
          ...it,
          idx,
          on: picks[idx]?.on ?? true,
          base_qty: it.qty ?? 1,
          qty: picks[idx]?.qty ?? it.qty ?? 1,
        }))
        .filter((it) => it.on),
    [ctx, picks],
  );
  const resolvedItems = useMemo(
    () =>
      picked
        .filter((i) => i.kind !== "service" && i.lines.length > 0)
        .map((i) => ({
          ...i,
          // Re-scale variant lines to the customer's chosen qty (the
          // server resolved lines at the staff-set qty; bundles keep
          // their per-unit component ratio).
          lines: i.lines.map((l) => ({
            ...l,
            quantity: Math.max(
              1,
              Math.round(
                (l.quantity / Math.max(1, i.base_qty)) * i.qty,
              ) || i.qty,
            ),
          })),
        })),
    [picked],
  );
  const serviceItems = useMemo(
    () => picked.filter((i) => i.kind === "service" && i.service_id),
    [picked],
  );
  const unsupportedItems = useMemo(
    () =>
      picked.filter((i) => i.kind !== "service" && i.lines.length === 0),
    [picked],
  );
  const hasProducts = resolvedItems.length > 0;
  const serviceOnly = !hasProducts && serviceItems.length > 0;

  // Live activity: report the current selection so the team's sidebar
  // panel updates while the customer is picking. Debounced; best-effort.
  useEffect(() => {
    if (!ctx || stage !== "form") return;
    const t = setTimeout(() => {
      api
        .post(
          `/order-link/${encodeURIComponent(slug)}/activity`,
          {
            cart: picked.map((c) => ({
              kind: c.kind,
              ref_id: c.ref_id,
              name: c.name || "",
              qty: c.qty,
              price_ngn: c.price_ngn,
            })),
          },
          "public",
        )
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [ctx, stage, picked, slug]);
  // The public order-form accepts a single bundle_id per order (matches
  // every other bundle-purchase path today) — if the staffer somehow put
  // two different bundles in one order link, only the first carries
  // the bundle attribution; both still fully expand into real lines.
  const bundleId = useMemo(
    () => resolvedItems.find((i) => i.kind === "bundle")?.bundle_id,
    [resolvedItems],
  );
  // Retail never counts toward the wig-quantity delivery band.
  const hasRetail = useMemo(
    () => resolvedItems.some((i) => i.kind === "retail"),
    [resolvedItems],
  );
  // A care-only basket is always paid in full (the server refuses an
  // instalment plan for it), so don't offer one.
  const careOnly = useMemo(
    () => resolvedItems.length > 0 && resolvedItems.every((i) => i.kind === "retail"),
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
  // the owner approves the initial-fee + retail-tax assumptions (server:
  // RETAIL_DELIVERY_ARRANGED). Pickup stays available.
  useEffect(() => {
    if (hasRetail && fulfilment === "delivery") setFulfilment("pickup");
  }, [hasRetail, fulfilment]);

  const isNigeria = country === "Nigeria" || countryCode === "NG";
  const isLagos = isNigeria && norm(address.state) === "lagos";
  // Non-NG: the country IS the zone (DHL). NG: wait for the state pick
  // (and the LGA pick too, for Lagos) to resolve a real zone — typing a
  // country/state without picking it from the list must never resolve.
  const effectiveZone = !isNigeria
    ? countryCode ||
      geo.countries.find((o) => norm(o.name) === norm(country))?.code ||
      ""
    : isLagos
      ? geo.lagos_lgas.find((o) => norm(o.name) === norm(address.city))
          ?.code || ""
      : geo.nigeria_states.find((o) => norm(o.name) === norm(address.state))
          ?.code || "";

  // Re-quote the delivery fee whenever the zone or basket size changes.
  useEffect(() => {
    if (serviceOnly || fulfilment !== "delivery" || !effectiveZone || !ctx) {
      setDeliveryFee(null);
      setDeliveryZoneName(null);
      setQuoting(false);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    fetchDeliveryQuote({ brand: ctx.brand, zoneCode: effectiveZone, qty: totalQty })
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
  }, [fulfilment, effectiveZone, totalQty, ctx]);

  const deliveryDue =
    fulfilment === "delivery" && deliveryFee != null ? deliveryFee : 0;

  // Order totals shown to the customer before they pay. Prices are the
  // staff-picked snapshots the server also charges, so this preview matches
  // the gateway amount. Unsupported items are excluded (they never join the
  // order). The USD figure uses the brand's Catalogue → Config exchange rate.
  const itemsSubtotal = useMemo(() => {
    const sum = (arr: typeof resolvedItems | typeof serviceItems) =>
      arr.reduce((s, i) => s + (Number(i.price_ngn) || 0) * i.qty, 0);
    return sum(resolvedItems) + sum(serviceItems);
  }, [resolvedItems, serviceItems]);
  // VAT on taxable Care & Accessories lines, rounded per line like the server.
  const careVat = useMemo(
    () =>
      resolvedItems.reduce(
        (s, i) =>
          i.kind === "retail" && i.taxable && i.vat_rate
            ? s + Math.round((Number(i.price_ngn) || 0) * i.qty * Number(i.vat_rate) * 100) / 100
            : s,
        0,
      ),
    [resolvedItems],
  );
  const orderTotal = itemsSubtotal + careVat + deliveryDue;
  // A $ link charges in dollars: each item at its catalogue USD price (from
  // the Hub's USD engine), delivery at the catalogue rate rounded UP to the
  // dollar — the figures the order locks when it's placed. A ₦ link charges
  // Naira only, so it shows no $ figure at all.
  const usdLink = ctx?.currency === "USD" && ctx.usd ? ctx.usd : null;
  const usdOf = (idx: number) => {
    const p = usdLink?.prices?.[idx];
    return p != null ? Number(p) : null;
  };
  const deliveryUsd =
    usdLink && usdLink.rate && deliveryDue > 0
      ? Math.ceil(deliveryDue / usdLink.rate - 1e-9)
      : 0;
  const itemsSubtotalUsd = usdLink
    ? [...resolvedItems, ...serviceItems].reduce(
        (s, i) => s + (usdOf(i.idx) ?? 0) * i.qty,
        0,
      )
    : null;
  // Care VAT in dollars: the server scales it at the goods' own $/₦ ratio
  // (the USD engine's order-adjustment rule), rounded half-up to the cent.
  const careVatUsd = (() => {
    if (!usdLink || careVat <= 0) return 0;
    let usd = 0;
    let ngn = 0;
    for (const i of resolvedItems) {
      usd += (usdOf(i.idx) ?? 0) * i.qty;
      ngn += (Number(i.price_ngn) || 0) * i.qty;
    }
    return ngn > 0 ? Math.round(((careVat * usd) / ngn) * 100 + 1e-9) / 100 : 0;
  })();
  const orderTotalUsd =
    itemsSubtotalUsd != null
      ? Math.round((itemsSubtotalUsd + careVatUsd + deliveryUsd) * 100) / 100
      : null;
  const fmtUsd = (v: number) =>
    `$${v.toLocaleString("en-US", {
      minimumFractionDigits: Math.round(v * 100) % 100 !== 0 ? 2 : 0,
      maximumFractionDigits: 2,
    })}`;

  const needsWho = !!ctx?.require_contact_form;
  const canSubmit =
    !!phone &&
    (hasProducts || serviceItems.length > 0) &&
    (!needsWho || !!who.first_name.trim()) &&
    (serviceOnly ||
      fulfilment === "pickup" ||
      (!!address.line1 &&
        !!address.city &&
        (!isNigeria || !!address.state) &&
        (!isLagos || !!effectiveZone)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !ctx) return;
    setErrMsg(null);

    if (!serviceOnly && fulfilment === "delivery" && hasRetail) {
      setErrMsg(
        "Orders with care products can't be delivered from this page yet. Choose pickup in store, or message us on WhatsApp to arrange delivery.",
      );
      return;
    }
    if (!serviceOnly && fulfilment === "delivery") {
      if (!effectiveZone) {
        setErrMsg(
          isNigeria
            ? "Please pick your state from the list (and your LGA for Lagos) so we can calculate delivery."
            : "Please pick your country from the list so we can calculate delivery.",
        );
        return;
      }
      if (quoting) {
        setErrMsg(
          "Calculating delivery… give it a second, then tap Place order again.",
        );
        return;
      }
      if (deliveryFee == null || !(deliveryFee > 0)) {
        setShowDeliveryHelp(true);
        return;
      }
    }

    setStage("submitting");
    try {
      const wantsDelivery = !serviceOnly && fulfilment === "delivery";
      const result = await api.post<OrderFormResult>(
        "/order-form",
        {
          first_name:
            who.first_name.trim() || ctx.contact?.first_name || undefined,
          last_name:
            who.last_name.trim() || ctx.contact?.last_name || undefined,
          phone,
          email: email || undefined,
          // Welcome-form mirror: handles + structured address land in the
          // same shared tables the Online QR form writes.
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
          // Marks the link used, applies staff-picked prices, and posts
          // order/booking events in the thread.
          order_link_slug: slug || undefined,
          // What the customer kept + how many — a $ link locks its dollar
          // total from exactly these (the figures shown above).
          link_picks: [...resolvedItems, ...serviceItems].map((i) => ({
            idx: i.idx,
            qty: i.qty,
          })),
          service_bookings: serviceItems.length
            ? serviceItems.map((s) => ({
                service_id: s.service_id as string,
                qty: s.qty,
                price_ngn: s.price_ngn ?? undefined,
                requested_for: svcTimes[s.idx]
                  ? new Date(svcTimes[s.idx]).toISOString()
                  : undefined,
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
          sales_channel:
            ctx.sales_channel &&
            ["public_form", "whatsapp", "instagram", "facebook"].includes(
              ctx.sales_channel,
            )
              ? ctx.sales_channel
              : "public_form",
          items: resolvedItems.flatMap((i) => i.lines),
          bundle_id: bundleId || undefined,
          // Flexi Pay (PR-2): only send 'instalment' when the channel offers it.
          payment_plan:
            flexi?.instalments_enabled && !careOnly && paymentPlan === "instalment"
              ? "instalment"
              : "full",
          // The buyer's gateway pick — the server prefers it on the active
          // chain and still falls over automatically if it's down.
          payment_gateway: gateway,
          specific_instructions: hasSpecificInstructions && specificInstructions.trim() ? specificInstructions.trim().slice(0,2000) : undefined,
          client_idempotency_key: `order:${slug}`,
        },
        "public",
      );

      // Capture the pre-order notice (000086) so the confirmation screen can
      // tell the buyer some items are made to order (the gateway redirect below
      // usually navigates away first; this shows on the fallback confirmation).
      setPreorderInfo(result?.preorder ?? null);
      // Parity with the storefront order-link (o.$slug): stash the pre-order
      // notice so the page the buyer returns to after paying can greet them with
      // it — this page redirects to the gateway (below) before the confirmation
      // screen renders, so React state alone doesn't survive the round-trip.
      // Covers both the primary and the /pay fallback redirect. Best-effort;
      // storage may be unavailable (private mode / blocked).
      if (result?.preorder?.is_preorder) {
        try {
          sessionStorage.setItem(
            "pgh_preorder",
            JSON.stringify(result.preorder),
          );
        } catch {
          /* storage unavailable */
        }
      }

      // Straight to the payment gateway: the order-form mints the checkout
      // link server-side (buyer's gateway pick preferred) and returns it —
      // redirect in ONE step. Gating this on public_tracking_token was the
      // "Order placed 🌹 / we'll WhatsApp you a link" bug: the token column
      // is null at creation, so the redirect never happened.
      if (result?.payment_url) {
        window.location.href = result.payment_url;
        return; // navigating away — stay on "submitting" until unload
      }
      // Backup only (gateway hiccup): retry via the tracking token when one
      // exists — no re-order, the order already stands. Confirmation screen
      // is the last resort so the buyer never dead-ends.
      const payToken = result?.public_tracking_token;
      if (result?.order_id && payToken) {
        try {
          const amountBody =
            result.payment_plan === "instalment" && result.pay_now_ngn
              ? { amount_ngn: Number(result.pay_now_ngn) }
              : {};
          const pay = await api.post<{ checkout_url?: string }>(
            `/pay/${encodeURIComponent(payToken)}`,
            amountBody,
            "public",
          );
          if (pay?.checkout_url) {
            window.location.href = pay.checkout_url;
            return; // navigating away — stay on "submitting" until unload
          }
        } catch {
          // No active gateway / init failed — show the confirmation screen.
        }
      }
      setStage("done");
    } catch (e: unknown) {
      setErrMsg(
        e instanceof Error
          ? e.message
          : "Couldn't place your order. Please try again.",
      );
      setStage("form");
    }
  }

  if (stage === "loading") {
    return (
      <Shell>
        <div className="grid place-items-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-accent-glow" />
        </div>
      </Shell>
    );
  }
  if (stage === "error") {
    return (
      <Shell>
        <div className="text-center py-12">
          <AlertCircle className="w-8 h-8 mx-auto mb-3 text-danger" />
          <p className="text-[14px] font-medium">
            Sorry — link no longer works.
          </p>
          <p className="text-[12.5px] text-text-muted mt-1 max-w-[360px] mx-auto">
            {errMsg ?? "Please ask us for a fresh order link."}
          </p>
        </div>
      </Shell>
    );
  }
  if (stage === "done") {
    return (
      <Shell>
        <div className="text-center py-12">
          <CheckCircle2 className="w-9 h-9 mx-auto mb-3 text-green-400" />
          <p className="font-display text-[20px] mb-1">Order placed 🌹</p>
          <p className="text-[13px] text-text-muted max-w-[360px] mx-auto">
            We couldn&rsquo;t open the payment page just now, so we&rsquo;ll
            WhatsApp you a payment link in a moment. Once payment lands, your
            order moves into production.
          </p>
          {preorderInfo?.is_preorder ? (
            <div className="mx-auto mt-5 max-w-[360px] rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-left">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-glow">
                Pre-order
              </span>
              <p className="mt-1 text-[12.5px] text-text-muted">
                {preorderInfo.message ||
                  (preorderInfo.window_label
                    ? `Some of your items are made to order and ship in about ${preorderInfo.window_label}.`
                    : "Some of your items are made to order. We'll keep you posted.")}
              </p>
            </div>
          ) : null}
        </div>
      </Shell>
    );
  }

  if (stage === "used") {
    return (
      <Shell brand={ctx?.brand}>
        <div className="text-center py-12">
          <CheckCircle2 className="w-9 h-9 mx-auto mb-3 text-green-400" />
          <p className="font-display text-[20px] mb-1">
            Order already placed 🌹
          </p>
          <p className="text-[13px] text-text-muted max-w-[380px] mx-auto">
            This link was used to place
            {ctx?.order_number ? ` order ${ctx.order_number}` : " your order"}
            {ctx?.ordered_at
              ? ` on ${formatDate(ctx.ordered_at)}`
              : ""}
            . Message us on WhatsApp if you&rsquo;d like to order again —
            we&rsquo;ll send a fresh link.
          </p>
        </div>
      </Shell>
    );
  }

  if (!ctx) return null;

  return (
    <Shell brand={ctx.brand}>
      <p className="text-[13px] text-text-muted leading-relaxed mb-5">
        Hi {ctx.contact?.first_name || who.first_name || "there"} — here's a
        selection we picked for you. Choose what you'd like and place your
        order.
      </p>

      {/* Items */}
      <div className="rounded-2xl bg-bg/50 border hairline p-3 mb-5">
        <div className="flex items-center gap-2 mb-2.5">
          <ShoppingBag className="w-4 h-4 text-accent-glow" />
          <span className="text-[12px] uppercase tracking-widest text-text-faint font-semibold">
            Pick your items
          </span>
        </div>
        <div className="space-y-2">
          {ctx.items.map((i, idx) => {
            const p = picks[idx] ?? { on: true, qty: i.qty || 1 };
            const isSvc = i.kind === "service";
            return (
              <div
                key={`${i.kind}-${i.ref_id}-${idx}`}
                className={cn(
                  "rounded-lg bg-panel-2 border hairline p-2.5",
                  isShop && !p.on && "opacity-50",
                )}
              >
                <div className="flex items-center gap-3">
                  {isShop && (
                    <input
                      type="checkbox"
                      checked={p.on}
                      onChange={(e) =>
                        setPicks((m) => ({
                          ...m,
                          [idx]: { ...p, on: e.target.checked },
                        }))
                      }
                      className="w-4 h-4 accent-[var(--accent,#690909)] shrink-0"
                      aria-label={`Include ${i.name ?? "item"}`}
                    />
                  )}
                  {i.image_url ? (
                    <img
                      src={i.image_url}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover border hairline"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-panel grid place-items-center text-text-faint border hairline">
                      <ShoppingBag className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] truncate">
                      {i.name ?? (isSvc ? "Service" : "Product")}
                      {isSvc && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-accent-glow">
                          service
                        </span>
                      )}
                    </div>
                    {i.kind === "retail" && i.variant_label && (
                      <div className="text-[11.5px] text-text-faint truncate">
                        {i.variant_label}
                      </div>
                    )}
                    {i.price_ngn != null && (
                      <div className="text-[11.5px] text-text-faint">
                        {usdLink && usdOf(idx) != null
                          ? fmtUsd(usdOf(idx) as number)
                          : `₦${Number(i.price_ngn).toLocaleString()}`}
                        {isSvc && i.duration_minutes
                          ? ` · ~${i.duration_minutes} min`
                          : ""}
                      </div>
                    )}
                    {i.note && (
                      <div className="text-[11.5px] text-text-faint truncate">
                        {i.note}
                      </div>
                    )}
                    {!isSvc && i.lines.length === 0 && (
                      <div className="text-[11px] text-amber-300 mt-0.5">
                        {i.kind === "retail" && i.unresolved_reason
                          ? i.unresolved_reason
                          : "Unavailable right now — we’ll confirm by WhatsApp."}
                      </div>
                    )}
                  </div>
                  {isShop && p.on && !isSvc ? (
                    <div className="inline-flex items-center gap-1 bg-panel rounded-lg p-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setPicks((m) => ({
                            ...m,
                            [idx]: { ...p, qty: Math.max(1, p.qty - 1) },
                          }))
                        }
                        className="w-6 h-6 grid place-items-center hover:text-accent-glow"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-[12.5px] font-medium tabular-nums">
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
                        className="w-6 h-6 grid place-items-center hover:text-accent-glow"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <span className="text-[12px] font-medium tabular-nums">
                      ×{p.qty}
                    </span>
                  )}
                </div>
                {isSvc && p.on && (
                  <label className="block mt-2 pl-0.5">
                    <span className="block text-[11px] text-text-muted mb-1">
                      Preferred date &amp; time (we&rsquo;ll confirm with you)
                    </span>
                    <input
                      type="datetime-local"
                      value={svcTimes[idx] ?? ""}
                      onChange={(e) =>
                        setSvcTimes((m) => ({ ...m, [idx]: e.target.value }))
                      }
                      min={new Date(Date.now() + 3600_000)
                        .toISOString()
                        .slice(0, 16)}
                      className="w-full rounded-xl bg-panel border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {unsupportedItems.length > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 mb-5 text-[12px] text-amber-200">
          Some items couldn&rsquo;t be added automatically. They&rsquo;re
          flagged above — our team will follow up on WhatsApp to finalise those
          before shipping.
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {/* Inline welcome-form mirror: shown when the thread had no linked
            customer yet — same fields, same tables, no separate form. */}
        {needsWho && (
          <Section title="Tell us who you are">
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
            <Field
              label="Instagram handle"
              value={who.instagram}
              onChange={(v) => setWho({ ...who, instagram: v })}
              placeholder="@yourhandle"
            />
          </Section>
        )}

        {/* Fulfilment — services carry no shipping, so a service-only
            order skips it entirely */}
        {!serviceOnly && (
          <Section title="How would you like it">
            <div className="grid grid-cols-2 gap-2">
              <FulfilmentPill
                active={fulfilment === "delivery"}
                onClick={() => setFulfilment("delivery")}
                icon={<Truck className="w-3.5 h-3.5" />}
                label={hasRetail ? "Delivery · Arranged by our team" : "Delivery"}
                disabled={hasRetail}
              />
              <FulfilmentPill
                active={fulfilment === "pickup"}
                onClick={() => setFulfilment("pickup")}
                icon={<Store className="w-3.5 h-3.5" />}
                label="Pickup in store"
              />
            </div>
            {hasRetail && (
              <div
                role="note"
                data-testid="care-delivery-notice"
                className="mt-2 rounded-xl border border-amber-400/40 bg-amber-400/5 p-3 text-[12px]"
              >
                <div className="font-bold uppercase tracking-wide">
                  {CARE_DELIVERY_NOTICE}
                </div>
                <div className="mt-1 text-text-muted">
                  Delivery for orders with care products is arranged with our
                  team. Choose pickup in store, or message us on WhatsApp and
                  we&rsquo;ll set up delivery for you.
                </div>
              </div>
            )}
          </Section>
        )}

        {!serviceOnly && fulfilment === "delivery" && (
          <Section title="Delivery">
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
              <span className="block text-[11.5px] text-text-muted mb-1">
                Country
                <span className="text-danger ml-1">*</span>
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
                className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
              >
                {geo.countries.map((o) => (
                  <option key={o.code} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>

            {isNigeria ? (
              <Row>
                <label className="block">
                  <span className="block text-[11.5px] text-text-muted mb-1">
                    State
                    <span className="text-danger ml-1">*</span>
                  </span>
                  <select
                    value={address.state}
                    onChange={(e) =>
                      setAddress({ ...address, state: e.target.value, city: "" })
                    }
                    className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
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
                    <span className="block text-[11.5px] text-text-muted mb-1">
                      LGA
                      <span className="text-danger ml-1">*</span>
                    </span>
                    <select
                      value={address.city}
                      onChange={(e) =>
                        setAddress({ ...address, city: e.target.value })
                      }
                      className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
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
                    required
                    value={address.city}
                    onChange={(v) => setAddress({ ...address, city: v })}
                  />
                )}
              </Row>
            ) : (
              <Field
                label="City"
                required
                value={address.city}
                onChange={(v) => setAddress({ ...address, city: v })}
              />
            )}

            <Field
              label="Landmark (helps the rider)"
              value={address.landmark}
              onChange={(v) => setAddress({ ...address, landmark: v })}
            />

            {/* Live delivery fee */}
            <div
              className={cn(
                "rounded-xl border px-3 py-2.5 text-[12.5px] flex items-center justify-between gap-2",
                deliveryFee != null && deliveryFee > 0
                  ? "border-accent/30 bg-accent/5 text-text-primary"
                  : "hairline bg-panel-2/60 text-text-muted",
              )}
            >
              <span>
                {!effectiveZone
                  ? "Pick your location above to calculate delivery."
                  : quoting
                    ? "Calculating delivery fee…"
                    : deliveryFee != null && deliveryFee > 0
                      ? `Delivery to ${deliveryZoneName ?? "your area"}`
                      : "We couldn't price delivery for this location yet."}
              </span>
              {effectiveZone && !quoting && (
                <span className="font-mono font-semibold tabular-nums shrink-0">
                  {deliveryFee != null && deliveryFee > 0
                    ? `₦${deliveryFee.toLocaleString()}`
                    : "—"}
                </span>
              )}
              {quoting && (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              )}
            </div>

            {showDeliveryHelp && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-[12px] text-amber-200">
                We can&rsquo;t confirm a delivery fee for this location yet.
                Double-check your country, state and LGA, or choose pickup in
                store instead.
              </div>
            )}
          </Section>
        )}

        <Section title="Specific instructions">
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input type="checkbox" checked={hasSpecificInstructions} onChange={(e)=>setHasSpecificInstructions(e.target.checked)} className="w-4 h-4 accent-[var(--accent,#690909)]" />
            <span className="text-[13px]">Add specific instructions for this order</span>
          </label>
          {hasSpecificInstructions && (
            <div>
              <textarea value={specificInstructions} onChange={(e)=>setSpecificInstructions(e.target.value.slice(0,2000))} placeholder="Any special request? e.g. styling preference, delivery note…" rows={4} maxLength={2000} className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40 resize-none" />
              <div className="mt-1 text-right text-[11px] text-text-faint">{specificInstructions.length}/2000</div>
            </div>
          )}
        </Section>

        <Section title="Contact">
          <Field
            label="Phone (for delivery)"
            type="tel"
            required
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
        </Section>

        {!serviceOnly && !careOnly && flexi?.instalments_enabled && (
          <Section title="Payment plan">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentPlan("full")}
                className={`rounded-xl border px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                  paymentPlan === "full"
                    ? "border-accent bg-accent/10 text-accent-glow"
                    : "border-border-c/20 text-text-muted"
                }`}
              >
                Pay in full
              </button>
              <button
                type="button"
                onClick={() => setPaymentPlan("instalment")}
                className={`rounded-xl border px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                  paymentPlan === "instalment"
                    ? "border-accent bg-accent/10 text-accent-glow"
                    : "border-border-c/20 text-text-muted"
                }`}
              >
                {flexi.plan_display_name || "Flexi Pay"}
              </button>
            </div>
            {paymentPlan === "instalment" && (
              <p className="mt-2 text-[12px] text-text-muted">
                Pay a deposit now to reserve your order; pay the rest anytime
                with the link we send you. Ships once fully paid.
              </p>
            )}
          </Section>
        )}

        {/* Gateway pick — mirrors the main storefront checkout. Only shown
            when the brand has more than one buyer-pickable gateway active;
            with one (or none reported) the server's Nomba-first default
            applies silently. */}
        {!serviceOnly && (flexi?.gateways?.length ?? 0) > 1 && (
          <Section title="Pay with">
            <div className="grid grid-cols-2 gap-2">
              {(flexi?.gateways ?? []).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGateway(g)}
                  className={`rounded-xl border px-3 py-2.5 text-[13px] font-semibold capitalize transition-colors ${
                    gateway === g
                      ? "border-accent bg-accent/10 text-accent-glow"
                      : "border-border-c/20 text-text-muted"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </Section>
        )}

        {errMsg && (
          <p className="text-[12px] text-danger inline-flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" />
            {errMsg}
          </p>
        )}

        {/* Order summary — what they'll be charged, before the gateway */}
        {(hasProducts || serviceItems.length > 0) && (
          <div className="rounded-2xl bg-bg/50 border hairline p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Subtotal</span>
              <span className="font-mono tabular-nums">
                {itemsSubtotalUsd != null
                  ? fmtUsd(itemsSubtotalUsd)
                  : `₦${itemsSubtotal.toLocaleString()}`}
              </span>
            </div>
            {careVat > 0 && (
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-text-muted">VAT (care products)</span>
                <span className="font-mono tabular-nums">
                  {usdLink ? fmtUsd(careVatUsd) : `₦${careVat.toLocaleString()}`}
                </span>
              </div>
            )}
            {!serviceOnly && fulfilment === "delivery" && (
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-text-muted">Delivery</span>
                <span className="font-mono tabular-nums">
                  {deliveryDue > 0
                    ? usdLink
                      ? fmtUsd(deliveryUsd)
                      : `₦${deliveryDue.toLocaleString()}`
                    : "—"}
                </span>
              </div>
            )}
            <div className="h-px bg-text-primary/10 my-1" />
            <div className="flex items-end justify-between">
              <span className="text-[13px] font-semibold">Total</span>
              <div className="text-right">
                <div className="font-mono font-semibold tabular-nums text-[17px] leading-none">
                  {orderTotalUsd != null
                    ? fmtUsd(orderTotalUsd)
                    : `₦${orderTotal.toLocaleString()}`}
                </div>
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit || stage === "submitting"}
          className="w-full grid place-items-center rounded-xl bg-accent text-bg font-semibold py-3 text-[14px] hover:bg-accent-glow disabled:opacity-50 transition-all"
        >
          {stage === "submitting" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : serviceOnly ? (
            "Place booking request"
          ) : (
            `Place order & pay ₦${orderTotal.toLocaleString()}`
          )}
        </button>

        <div className="flex items-start gap-2 text-[11.5px] text-text-faint">
          <ShieldCheck className="w-3.5 h-3.5 mt-[1px] shrink-0" />
          <span>
            Secured by a one-time link bound to this conversation. Expires{" "}
            {formatDateTime(ctx.expires_at)}.
          </span>
        </div>
      </form>
    </Shell>
  );
}

// ── Layout shell ──────────────────────────────────────────

/**
 * Thin wrapper over the shared PublicBrandShell so this page stays on the
 * one branded, glassmorphic, per-brand chrome used by every public
 * token-linked page (order / welcome / sign / offer).
 */
function Shell({
  brand,
  children,
}: {
  brand?: string;
  children: React.ReactNode;
}) {
  return (
    <PublicBrandShell brand={brand} subtitle="Confirm your order">
      {children}
    </PublicBrandShell>
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
    <div>
      <div className="text-[11px] uppercase tracking-widest text-text-faint mb-2">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{children}</div>
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
      <span className="block text-[11.5px] text-text-muted mb-1">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
      />
    </label>
  );
}

function FulfilmentPill({
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
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[12.5px] font-medium transition-colors",
        disabled
          ? "hairline text-text-faint opacity-50 cursor-not-allowed"
          : active
          ? "border-accent bg-accent/15 text-accent-glow"
          : "hairline text-text-muted hover:text-text-primary",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
