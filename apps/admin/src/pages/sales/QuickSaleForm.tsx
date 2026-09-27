import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Search,
  User,
  X,
  Truck,
  Store,
  Send,
  QrCode,
  Copy,
  Check,
  CheckCircle2,
  Smartphone,
  MessageCircle,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/cn";
import { Card, Button, MoneyText } from "@/components/ui/primitives";
import {
  Toggle,
  Select,
  NumberField,
  ConfirmDialog,
} from "@/components/ui/controls";
import { FormGrid, Field, TextInput } from "@/components/ui/Form";
import { GeoComboBox } from "@/components/ui/GeoComboBox";
import {
  fetchGeoOptions,
  fetchDeliveryQuote,
  GEO_FALLBACK,
  type GeoOptions,
} from "@/lib/order-checkout-geo";
import { ProductPicker } from "@/components/catalogue/ProductPicker";
import {
  StyledVariantPicker,
  type StyledPick,
} from "@/components/catalogue/StyledVariantPicker";
import {
  resolvePick,
  resolveStyledPick,
  type ProductHit,
  type ResolvedLine,
} from "@/lib/product-search";
import { useSizeConfig } from "@/lib/catalogue";
import {
  SALES_CHANNELS,
  SALES_CHANNEL_GROUPS,
  FULFILMENT_OPTIONS,
  orderPaymentMeta,
} from "./constants";
import {
  useCreateOrder,
  useOrderPaymentWatch,
  usePaymentSettings,
} from "./hooks";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { toastReport, describeError } from "@/lib/error-report";
import { onboardingApi } from "@/lib/smartcomm-api";
import { joinRoom, leaveRoom, rooms } from "@/lib/socket";
import { getContact } from "@/pages/contacts/api";
import { useBusinessStore } from "@/stores/business";
import * as salesApi from "./api";
import { api } from "@/lib/api";
import type { SalesChannel, FulfilmentType, OrderCreateInput } from "./types";

interface CartLine {
  id: string;
  variant_id: string;
  // Set when this line is a service (walk-in revamp/install) instead of a product.
  service_offering_id?: string;
  // Set when the picked product was a styled SKU — stamped so Sales writes
  // line_kind='styled' and Stylist Studio opens a job on payment.
  styled_id?: string;
  label: string;
  sku: string;
  unit_price: number;
  quantity: number;
  // Snapshot overrides from a styled head-size/lace/colour pick — see
  // ResolvedLine. Falls back to `label`/undefined for every other kind.
  product_name_snapshot?: string;
  variant_label_snapshot?: string;
  // Thumbnail from the pick — shown on the cart line so staff can confirm
  // by sight, not just name.
  image_url?: string | null;
  /** Sellable units behind this line at pick time — drives the in-stock /
   *  made-to-order badge. Null/undefined = no stock reading (e.g. a service). */
  available?: number | null;
  /** Care & Accessories SKU — stock-only, never pre-order or re-wig. */
  is_care?: boolean;
}

interface SearchResult {
  id: string;
  label: string;
  sub: string;
}

// Nomba — the only gateway — settles Naira and US Dollars; the Hub refuses any
// other checkout currency (payment-link UNSUPPORTED_CURRENCY).
const CURRENCY_OPTIONS = [
  { value: "NGN", label: "NGN" },
  { value: "USD", label: "USD" },
];

const ngn = (v: number) => `₦${v.toLocaleString()}`;

/**
 * Make a backend-issued onboarding link absolute. When no storefront/admin
 * domain is configured the backend returns a bare path (e.g.
 * `/welcome/faitlynhair/<token>`), which a phone camera can't resolve when
 * scanned from a QR code — there's no browser origin to fall back on. The
 * `/welcome` route is served by this admin SPA, so the current origin is a
 * correct, always-available host. An already-absolute URL passes through
 * unchanged. (Same fix as OnlineQR.tsx's helper.)
 */
function toAbsoluteUrl(url: string): string {
  if (!url || /^https?:\/\//i.test(url)) return url;
  return `${window.location.origin}/${url.replace(/^\/+/, "")}`;
}

/**
 * Per-line stock read-out for the cart: units left when there are any, else the
 * pre-order window from Catalogue → Config so the operator can tell the customer
 * how long the wait is before taking payment.
 *
 * `available` already includes any rewig-adjacent sibling stock, so a size whose
 * own base is empty but which can be cut from a neighbour reads as in stock —
 * matching what checkout will actually do with it.
 */
function StockBadge({
  available,
  quantity,
  stockOnly,
}: {
  available?: number | null;
  quantity: number;
  /** Care & Accessories sell stock-only: a shortfall is never "made to
   *  order", it is a hard limit the checkout will enforce. */
  stockOnly?: boolean;
}) {
  const { data: sizeCfg } = useSizeConfig();
  if (available == null) return null;

  const cfg = sizeCfg?.config;
  if (available > 0) {
    const short = available < quantity;
    return (
      <div
        className={cn(
          "mt-1 text-[11px] font-medium",
          short ? "text-amber-400" : "text-emerald-400",
        )}
      >
        {short
          ? stockOnly
            ? `Only ${available} in stock — care items are stock-only`
            : `Only ${available} left — ${quantity - available} will be made to order`
          : `In stock · ${available} left`}
      </div>
    );
  }

  // Out of stock. Pre-orders switched off brand-wide — or a stock-only care
  // SKU — means a genuine sold-out, never a made-to-order promise.
  if (stockOnly || (cfg && cfg.preorder_enabled === false)) {
    return (
      <div className="mt-1 text-[11px] font-medium text-red-400">
        {stockOnly ? "Out of stock — care items are stock-only" : "Out of stock"}
      </div>
    );
  }
  const min = cfg?.preorder_min_weeks;
  const max = cfg?.preorder_max_weeks;
  const window =
    min != null && max != null && min !== max
      ? `${min}–${max} weeks`
      : max != null
        ? `${max} week${max === 1 ? "" : "s"}`
        : null;
  return (
    <div className="mt-1 text-[11px] font-medium text-amber-400">
      {window ? `Made to order · ready in ~${window}` : "Made to order"}
    </div>
  );
}

export function QuickSaleForm() {
  const createOrder = useCreateOrder();
  // Starts at 2 (Customer), not 1: the channel below already defaults to
  // Walk-in and shows as selected, so the Customer card must be visible
  // immediately too — otherwise the picker looks clicked but nothing
  // advanced.
  const [step, setStep] = useState(2);

  // Step 1: Channel — defaults to Walk-in since Quick Sale is the counter/POS
  // flow; staff pick a different channel only when the sale didn't start
  // in-store.
  const [channel, setChannel] = useState<SalesChannel>("walk_in");

  // Step 2: Customer
  const [contactSearch, setContactSearch] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactResults, setContactResults] = useState<SearchResult[]>([]);
  const [showQr, setShowQr] = useState(false);
  // The onboarding link's submission_id — set the moment the QR is minted so
  // the realtime effect below knows which incoming "submission completed"
  // push (of potentially many, brand-wide) is actually this customer.
  const [captureSubmissionId, setCaptureSubmissionId] = useState<
    string | null
  >(null);

  // Step 3: Products
  const [cart, setCart] = useState<CartLine[]>([]);
  // A styled pick awaiting its head-size/lace/colour choice before it can be
  // added to the cart (StyledVariantPicker); null when nothing is pending.
  const [pendingStyled, setPendingStyled] = useState<ProductHit | null>(null);
  // Own-wig check-in (walk-in revamp): take the customer's wig into custody.
  const [ownWig, setOwnWig] = useState(false);
  const [wigCondition, setWigCondition] = useState("");

  // Step 4: Config
  const [currency, setCurrency] = useState("NGN");
  const [applyVat, setApplyVat] = useState(false);
  const [coupon, setCoupon] = useState("");
  // Flexi Pay: offer the instalment plan when this channel enables it.
  const { data: flexiSettings } = usePaymentSettings();
  const instalmentsEnabled =
    !!flexiSettings && flexiSettings.channels[channel] !== false;
  const [paymentPlan, setPaymentPlan] = useState<"full" | "instalment">("full");
  const [hasSpecificInstructions, setHasSpecificInstructions] = useState(false);
  const [specificInstructions, setSpecificInstructions] = useState("");
  const [fulfilment, setFulfilment] = useState<FulfilmentType>("walk_in");
  // Delivery address — same country → state → LGA zone-code picker as the
  // storefront checkout and the public order-link page (order-checkout-geo),
  // so Quick Sale prices delivery against the EXACT same delivery-zone
  // engine and codes, not a separate lat/lng geocode lookup.
  const [geo, setGeo] = useState<GeoOptions>(GEO_FALLBACK);
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [countryCode, setCountryCode] = useState("NG");
  // Committed only via a GeoComboBox pick (never a typed-but-unselected
  // value) — the delivery-zone code that actually prices the order.
  const [zoneCode, setZoneCode] = useState("");
  const [shippingFee, setShippingFee] = useState("");
  // The delivery-zone engine's own rate for the picked address — the SAME
  // rate-card the website/order-link checkouts charge. null until an address
  // with a resolvable zone is picked. Compared against the (editable)
  // shippingFee field so a manual change always prompts a confirmation
  // relative to the real system rate, not a chain of prior overrides.
  const [systemFee, setSystemFee] = useState<number | null>(null);
  const [zoneStatus, setZoneStatus] = useState<
    "priced" | "free" | "pending" | "unserviceable" | null
  >(null);
  const [quotingFee, setQuotingFee] = useState(false);
  const [confirmedFee, setConfirmedFee] = useState<number | null>(null);
  const [feeConfirm, setFeeConfirm] = useState<{
    from: number;
    to: number;
  } | null>(null);

  // Step 5: Send
  const [sendVia, setSendVia] = useState<"email" | "whatsapp">("email");
  const [submitting, setSubmitting] = useState(false);
  const [sentOrderId, setSentOrderId] = useState<string | null>(null);
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  // Set when the order was saved but its payment link couldn't be minted (e.g.
  // a gateway/network blip). The order EXISTS — we surface a retry rather than
  // a "failed" that invites a duplicate order.
  const [paymentLinkError, setPaymentLinkError] = useState<string | null>(null);
  // The first charge (deposit for instalment, else full balance) computed at
  // create time, so "Retry payment link" charges the same amount.
  const [firstChargeNgn, setFirstChargeNgn] = useState<number | null>(null);
  const [retryingLink, setRetryingLink] = useState(false);
  // Idempotency key for THIS sale attempt. The backend returns the existing
  // order for a repeat key instead of creating a second one, so a double-tap or
  // a retry after a post-create hiccup can never duplicate the order (the
  // FLH-SO-0106/0107 incident). Regenerated by reset() for the next sale.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const toast = useToastStore();
  const activeBiz = useBusinessStore((s) => s.activeKey);

  // Watch the created order so the counter screen flips to "Paid" on its own
  // once the gateway confirms — no manual payment entry (anti-pocketing).
  const paymentWatch = useOrderPaymentWatch(sentOrderId);
  const watchedOrder = paymentWatch.data;
  // "Paid" here licenses handing over the goods, so it means the balance is
  // clear — not merely that the order left 'pending_payment'. A deposit moves
  // the order to 'partially_paid', which the old status test read as paid in
  // full: the exact anti-pocketing hole this watch exists to close.
  const isPaid = orderPaymentMeta(watchedOrder).settled;
  // Walk-in = customer is at the counter → pay on the spot by scanning.
  const inStore = fulfilment === "walk_in";

  const fireToast = (
    title: string,
    body: string,
    type = "order",
    priority: "normal" | "high" = "normal",
  ) => {
    if (priority === "high") {
      toastReport("Sales → Quick sale", title, body || "Something went wrong.");
      return;
    }
    toast.add({
      notification_id: crypto.randomUUID(),
      user_id: "",
      business: null,
      type,
      priority,
      title,
      body,
      reference_type: null,
      reference_id: null,
      action_url: null,
      is_read: false,
      read_at: null,
      created_at: new Date().toISOString(),
    });
  };

  const subtotal = useMemo(
    () => cart.reduce((sum, l) => sum + l.unit_price * l.quantity, 0),
    [cart],
  );
  // Wig count — drives the delivery fee's quantity tier, same as the
  // storefront checkout (wigQty) and the public order-link page (totalQty).
  // Care & Accessories never count as extra wigs in that tier.
  const totalQty = useMemo(
    () =>
      Math.max(
        1,
        cart.reduce((s, l) => s + (l.is_care ? 0 : l.quantity), 0),
      ),
    [cart],
  );
  // Care & Accessories: staff calculate the delivery fee by hand (no rate card
  // prices a bottle), and a care-only basket is always paid in full.
  const hasCare = useMemo(() => cart.some((l) => l.is_care), [cart]);
  const careOnly = useMemo(
    () => cart.length > 0 && cart.every((l) => l.is_care),
    [cart],
  );
  const offerInstalments = instalmentsEnabled && !careOnly;
  const vatAmount = applyVat ? subtotal * 0.075 : 0;
  const shipping = Number(shippingFee) || 0;
  const total = subtotal + vatAmount + shipping;

  // ── Dollar total (USD sales) ─────────────────────────────
  // The Hub's USD engine prices the draft cart exactly as the USD pay link
  // will lock it: each item's catalogue USD price, delivery at the catalogue
  // rate. Staff see the $ the customer will be charged before sending.
  const [usdTotal, setUsdTotal] = useState<number | null>(null);
  useEffect(() => {
    if (currency !== "USD" || cart.length === 0) {
      setUsdTotal(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const q = await salesApi.usdQuote({
          lines: cart.map((l) =>
            l.service_offering_id
              ? {
                  service_offering_id: l.service_offering_id,
                  line_kind: "service",
                  unit_price_ngn: l.unit_price,
                  quantity: l.quantity,
                }
              : {
                  variant_id: l.variant_id,
                  ...(l.styled_id
                    ? { styled_id: l.styled_id, line_kind: "styled" }
                    : {}),
                  unit_price_ngn: l.unit_price,
                  quantity: l.quantity,
                },
          ),
          total_ngn: Math.round(total * 100) / 100,
          shipping_fee_ngn: shipping,
        });
        if (!cancelled) setUsdTotal(q ? Number(q.usd_total) : null);
      } catch {
        if (!cancelled) setUsdTotal(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [currency, cart, total, shipping]);
  // What the minted checkout actually charges ("USD" / "249.99").
  const [charged, setCharged] = useState<{
    currency: string;
    amount: string;
  } | null>(null);

  // ── Contact search ───────────────────────────────────────
  const contactDebounce = useRef<ReturnType<typeof setTimeout>>();
  const handleContactSearch = useCallback((q: string) => {
    setContactSearch(q);
    clearTimeout(contactDebounce.current);
    if (q.length < 2) {
      setContactResults([]);
      return;
    }
    contactDebounce.current = setTimeout(async () => {
      try {
        const res = await salesApi.searchContacts(q);
        setContactResults(
          (res.data ?? []).map((c) => ({
            id: c.contact_id,
            label: c.display_name,
            sub: [c.primary_phone, c.email].filter(Boolean).join(" · ") || "",
          })),
        );
      } catch {
        setContactResults([]);
      }
    }, 300);
  }, []);

  const pickContact = (r: SearchResult) => {
    setContactId(r.id);
    setContactName(r.label);
    setContactSearch(r.label);
    setContactResults([]);
    setStep(3);
  };

  // ── Realtime auto-select: the QR-code capture link this screen minted
  // (Step 2) just got submitted — the moment the socket push names this
  // submission_id, pull the resulting contact and select it without staff
  // ever touching the search box.
  useEffect(() => {
    if (!captureSubmissionId || contactId) return;
    const room = rooms.customerOnboarding(activeBiz ?? "pixiegirl");
    joinRoom(room);

    const onSubmissionCompleted = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { submission_id?: string; contact_id?: string }
        | undefined;
      if (!detail?.contact_id || detail.submission_id !== captureSubmissionId) {
        return;
      }
      getContact(detail.contact_id)
        .then((contact) => {
          setContactId(contact.contact_id);
          setContactName(contact.display_name);
          setContactSearch(contact.display_name);
          setContactResults([]);
          setShowQr(false);
          setStep(3);
          fireToast(
            "Customer found",
            `${contact.display_name} filled the form and was auto-selected.`,
          );
        })
        .catch(() => {
          // Submission completed but the contact fetch failed — staff can
          // still pick them manually from the search box above.
        });
    };

    window.addEventListener(
      "pgh:onboarding:submission.completed",
      onSubmissionCompleted,
    );
    return () => {
      window.removeEventListener(
        "pgh:onboarding:submission.completed",
        onSubmissionCompleted,
      );
      leaveRoom(room);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureSubmissionId, contactId, activeBiz]);

  // ── Product pick (type-first picker → resolved order lines) ──
  const addResolvedLines = (lines: ResolvedLine[]) => {
    setCart((prev) => {
      const next = [...prev];
      for (const l of lines) {
        // Merge on the strongest identity for this kind: service_offering_id
        // for services (variant_id is "" for every service so it can't be the
        // key), else variant_id + styled provenance (a base wig and its
        // styled sibling share a variant but are different lines).
        const i = next.findIndex((c) =>
          l.service_offering_id
            ? c.service_offering_id === l.service_offering_id
            : c.variant_id === l.variant_id &&
              (c.styled_id || null) === (l.styled_id || null),
        );
        if (i >= 0)
          next[i] = { ...next[i], quantity: next[i].quantity + l.quantity };
        else next.push({ id: crypto.randomUUID(), ...l });
      }
      return next;
    });
  };

  const handlePick = async (hit: ProductHit) => {
    // A styled product prices by head size × lace × colour — send it through
    // the variant picker first so the line carries the exact combo instead of
    // always the anchor price/seed variant.
    if (hit.kind === "styled") {
      setPendingStyled(hit);
      return;
    }
    try {
      const { lines, bundle_id } = await resolvePick(hit);
      if (bundle_id) setBundleId(bundle_id);
      if (lines.length === 0) {
        fireToast(
          "Nothing to add",
          "That product has no active variant to sell.",
          "order",
          "high",
        );
        return;
      }
      addResolvedLines(lines);
    } catch {
      fireToast("Error", "Failed to add product", "order", "high");
    }
  };

  const handleStyledPick = async (pick: StyledPick) => {
    const hit = pendingStyled;
    setPendingStyled(null);
    if (!hit) return;
    try {
      const { lines } = await resolveStyledPick(hit, pick);
      if (lines.length === 0) {
        fireToast(
          "Nothing to add",
          "That product has no active variant to sell.",
          "order",
          "high",
        );
        return;
      }
      addResolvedLines(lines);
    } catch {
      fireToast("Error", "Failed to add product", "order", "high");
    }
  };

  const removeLine = (id: string) =>
    setCart((prev) => prev.filter((l) => l.id !== id));

  const updateQty = (id: string, qty: number) =>
    setCart((prev) =>
      prev.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, qty) } : l)),
    );

  // ── Delivery fee (real zone/rate-card engine, same one the website and
  // order-link checkouts charge from) ──────────────────────
  // Picker options, loaded once per mount — identical endpoint + fallback
  // list the storefront checkout uses, so the codes always match the seeded
  // delivery zones.
  useEffect(() => {
    let alive = true;
    fetchGeoOptions(activeBiz ?? undefined).then((g) => {
      if (alive) setGeo(g);
    });
    return () => {
      alive = false;
    };
  }, [activeBiz]);

  const norm = (s: string) => s.trim().toLowerCase();
  const isNigeria = country === "Nigeria" || countryCode === "NG";
  const isLagos = isNigeria && norm(addrState) === "lagos";
  // Resolve the zone even when the field was typed to an exact match without
  // tapping the dropdown — never guesses the WRONG zone, only recognises an
  // exact, case-insensitive one. Non-NG: the country IS the zone (DHL). NG:
  // waits for the state (and, for Lagos, the LGA) pick.
  const resolvedCountryCode =
    countryCode ||
    geo.countries.find((o) => norm(o.name) === norm(country))?.code ||
    "";
  const resolvedNgZone = zoneCode
    ? zoneCode
    : !isNigeria
      ? ""
      : isLagos
        ? geo.lagos_lgas.find((o) => norm(o.name) === norm(city))?.code || ""
        : geo.nigeria_states.find((o) => norm(o.name) === norm(addrState))
            ?.code || "";
  const effectiveZone = isNigeria ? resolvedNgZone : resolvedCountryCode;

  // Re-quote whenever the resolved zone or the basket size changes — same
  // POST /storefront/delivery-quote the storefront checkout and the public
  // order-link page call, so the fee always agrees to the naira.
  useEffect(() => {
    if (fulfilment !== "dispatch" || !effectiveZone) {
      setSystemFee(null);
      setZoneStatus(null);
      setQuotingFee(false);
      return;
    }
    let cancelled = false;
    setQuotingFee(true);
    fetchDeliveryQuote({
      brand: activeBiz ?? undefined,
      zoneCode: effectiveZone,
      qty: totalQty,
    })
      .then((q) => {
        if (cancelled) return;
        setConfirmedFee(null);
        setZoneStatus(q?.fee_status ?? (q?.fee_ngn != null ? "priced" : "unserviceable"));
        if (q?.fee_ngn != null) {
          setSystemFee(q.fee_ngn);
          // With Care items in the basket the zone rate is only a reference —
          // never overwrite the fee staff calculated by hand.
          if (!hasCare) setShippingFee(String(q.fee_ngn));
        } else {
          setSystemFee(null);
        }
      })
      .finally(() => {
        if (!cancelled) setQuotingFee(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fulfilment, effectiveZone, totalQty, activeBiz, hasCare]);

  // Any manual edit that lands away from the system's own rate needs an
  // explicit "yes, really" — staff can still override (an unconfigured zone,
  // a goodwill discount, a phone-negotiated deal), but never silently.
  const handleShippingBlur = () => {
    // Care baskets are priced by hand — the zone rate is only a reference.
    if (systemFee == null || hasCare) return;
    const typed = Number(shippingFee) || 0;
    if (typed === systemFee || typed === confirmedFee) return;
    setFeeConfirm({ from: systemFee, to: typed });
  };

  // ── Submit ───────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!contactId || cart.length === 0) return;
    setSubmitting(true);
    const input: OrderCreateInput = {
      contact_id: contactId,
      sales_channel: channel,
      order_type: fulfilment,
      // Repeat this key → backend returns the SAME order instead of a duplicate.
      client_idempotency_key: idempotencyKeyRef.current,
      lines: cart.map((l) =>
        l.service_offering_id
          ? {
              service_offering_id: l.service_offering_id,
              line_kind: "service" as const,
              quantity: l.quantity,
              unit_price_ngn: l.unit_price || undefined,
            }
          : {
              variant_id: l.variant_id,
              quantity: l.quantity,
              unit_price_ngn: l.unit_price || undefined,
              // The shop-facing name (styled product or bundle) resolved at
              // pick time — stamp it as the order line's snapshot so
              // invoices/receipts show what the customer actually bought,
              // not the warehouse stock item it sells through. A styled
              // pick carries the pure name + its size/lace/colour spec
              // separately; every other kind falls back to the combined
              // display label.
              product_name_snapshot: l.product_name_snapshot ?? l.label,
              variant_label_snapshot: l.variant_label_snapshot,
              sku_snapshot: l.sku,
              ...(l.styled_id
                ? { styled_id: l.styled_id, line_kind: "styled" as const }
                : {}),
            },
      ),
      bundle_id: bundleId || undefined,
      coupon_code: coupon || undefined,
      specific_instructions: hasSpecificInstructions && specificInstructions.trim() ? specificInstructions.trim().slice(0,2000) : undefined,
      shipping_fee_ngn: shipping || undefined,
      payment_plan:
        offerInstalments && paymentPlan === "instalment"
          ? "instalment"
          : "full",
    };

    // ── Step A: create the order. A failure here means NO order exists, so
    // this is the only place we may say "Order Failed" — and we surface the
    // REAL error (status/code/message) to the JBS report, never a swallowed
    // generic. ────────────────────────────────────────────────
    let order: Awaited<ReturnType<typeof createOrder.mutateAsync>>;
    try {
      order = await createOrder.mutateAsync(input);
    } catch (err) {
      toastReport("Sales → Quick sale", "Order Failed", err);
      setSubmitting(false);
      return;
    }

    // ── The order now EXISTS. Commit to the confirmation screen immediately so
    // the submit button is gone — a second submit can't create a duplicate
    // (and the idempotency key backstops even that). Everything below is
    // post-create: it must never read as "order failed". ─────────
    setSentOrderId(order.order_id);
    setStep(6);

    if (order.preorder?.is_preorder) {
      // Expected outcome of a successful order, not a failure — don't route
      // it through the "Contact System Admin" (JBS Praxis) report path.
      fireToast(
        "Pre-order",
        order.preorder.message ||
          `${order.preorder.line_count} item(s) are made to order and will ship on the pre-order window.`,
        "order",
        "normal",
      );
    }
    // Take the customer's own wig into custody (chain of custody).
    if (ownWig && contactId) {
      try {
        await api.post("/customer-assets", {
          owner_contact_id: contactId,
          condition_note: wigCondition || undefined,
        });
      } catch {
        fireToast(
          "Heads up",
          "Sale went through, but the wig check-in didn't save. Add it in Stylist Studio.",
          "order",
          "high",
        );
      }
    }
    // Flexi Pay: an instalment order charges the deposit now (server-snapshot
    // required_deposit_ngn), otherwise the full balance. The customer pays the
    // rest later via their pay link.
    const firstCharge =
      order.payment_plan === "instalment" && order.required_deposit_ngn
        ? Number(order.required_deposit_ngn)
        : Number(order.balance_due_ngn);
    setFirstChargeNgn(firstCharge);

    // ── Step B: mint the payment link. If THIS fails (gateway/network), the
    // order is safe — show a retry, not a failure. ──────────────
    try {
      const link = await salesApi.createPaymentLink(order.order_id, {
        amount_ngn: firstCharge,
        currency: currency !== "NGN" ? currency : undefined,
      });
      setPaymentUrl(link.checkout_url);
      setCharged(
        link.currency && link.charge_amount
          ? { currency: link.currency, amount: link.charge_amount }
          : null,
      );
      setPaymentLinkError(null);
      fireToast(
        "Order Created",
        inStore
          ? `Order ${order.order_number} ready — ask the customer to scan & pay.`
          : `Order ${order.order_number} created — payment link sent.`,
      );
    } catch (err) {
      setPaymentLinkError(describeError(err).message);
      toastReport("Sales → Quick sale", "Payment link failed", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Retry only the payment-link step for the order we already saved — never
  // re-creates the order.
  const retryPaymentLink = async () => {
    if (!sentOrderId || firstChargeNgn == null) return;
    setRetryingLink(true);
    try {
      const link = await salesApi.createPaymentLink(sentOrderId, {
        amount_ngn: firstChargeNgn,
        currency: currency !== "NGN" ? currency : undefined,
      });
      setPaymentUrl(link.checkout_url);
      setCharged(
        link.currency && link.charge_amount
          ? { currency: link.currency, amount: link.charge_amount }
          : null,
      );
      setPaymentLinkError(null);
    } catch (err) {
      setPaymentLinkError(describeError(err).message);
      toastReport("Sales → Quick sale", "Payment link failed", err);
    } finally {
      setRetryingLink(false);
    }
  };

  const reset = () => {
    setStep(2);
    setChannel("walk_in");
    setContactId(null);
    setContactName("");
    setContactSearch("");
    setCart([]);
    setCurrency("NGN");
    setApplyVat(false);
    setCoupon("");
    setPaymentPlan("full");
    setHasSpecificInstructions(false);
    setSpecificInstructions("");
    setFulfilment("walk_in");
    setAddressLine1("");
    setAddressLine2("");
    setCity("");
    setAddrState("");
    setCountry("Nigeria");
    setCountryCode("NG");
    setZoneCode("");
    setShippingFee("");
    setSystemFee(null);
    setZoneStatus(null);
    setConfirmedFee(null);
    setFeeConfirm(null);
    setSentOrderId(null);
    setBundleId(null);
    setPaymentUrl(null);
    setPaymentLinkError(null);
    setFirstChargeNgn(null);
    setCharged(null);
    setCaptureUrl(null);
    setCaptureSubmissionId(null);
    setShowQr(false);
    // Fresh key so the NEXT sale is a distinct order, not a dedupe of this one.
    idempotencyKeyRef.current = crypto.randomUUID();
  };

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-4">
      {/* Step 1: Channel — grouped Digital / Physical per V2.2 §6.4 */}
      <Card className="p-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="micro">Sales Channel</div>
          <div className="text-[11px] text-text-faint">
            Where is this sale coming from? Tap to change.
          </div>
        </div>
        <div className="space-y-4">
          {SALES_CHANNEL_GROUPS.map((group) => (
            <div key={group.key}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-faint mb-2">
                {group.label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.channels.map((ch) => (
                  <button
                    key={ch.value}
                    type="button"
                    onClick={() => {
                      setChannel(ch.value as SalesChannel);
                      if (step < 2) setStep(2);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors",
                      ch.value === channel
                        ? "border-accent/50 text-accent-glow bg-accent/[0.1]"
                        : "border-line text-text-muted hover:text-text-primary hover:border-text-muted/50",
                    )}
                  >
                    {ch.value === channel && <Check className="w-3 h-3" />}
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Step 2: Customer */}
      {step >= 2 && (
        <Card className="p-5 relative z-20">
          <div className="micro mb-3">Customer</div>
          {contactId ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-accent/10 grid place-items-center">
                <User className="w-4 h-4 text-accent-glow" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold truncate">
                  {contactName}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setContactId(null);
                  setContactName("");
                  setContactSearch("");
                }}
              >
                Change
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
                <input
                  type="search"
                  name="customer-search"
                  placeholder="Search by name, email, or phone…"
                  value={contactSearch}
                  onChange={(e) => handleContactSearch(e.target.value)}
                  className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore=""
                  data-form-type="other"
                />
                {contactResults.length > 0 && (
                  <div className="absolute z-40 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] dropglass overflow-hidden py-1 max-h-[240px] overflow-y-auto">
                    {contactResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => pickContact(r)}
                        className="w-full px-4 py-2.5 text-left hover:bg-text-primary/[0.06] transition-colors"
                      >
                        <div className="text-[13px] font-semibold">
                          {r.label}
                        </div>
                        {r.sub && (
                          <div className="text-[11px] text-text-faint">
                            {r.sub}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<QrCode className="w-3.5 h-3.5" />}
                  onClick={async () => {
                    if (captureUrl) {
                      setShowQr(!showQr);
                      return;
                    }
                    setQrLoading(true);
                    try {
                      const res = await onboardingApi.createLink({
                        business: activeBiz ?? "pixiegirl",
                        source: "walkin",
                      });
                      setCaptureUrl(toAbsoluteUrl(res.url));
                      setCaptureSubmissionId(res.submission_id);
                      setShowQr(true);
                    } catch {
                      fireToast(
                        "Error",
                        "Failed to generate capture link",
                        "order",
                        "high",
                      );
                    } finally {
                      setQrLoading(false);
                    }
                  }}
                  disabled={qrLoading}
                >
                  {qrLoading ? "Generating…" : "QR Code"}
                </Button>
              </div>
              {showQr && captureUrl && (
                <div className="p-4 rounded-[11px] bg-text-primary/[0.03] border border-line text-center">
                  <p className="text-[12px] text-text-muted mb-3">
                    Share the order capture link — customer fills their details
                    and is auto-selected.
                  </p>
                  <div className="inline-block bg-white p-3 rounded-[14px] mb-3">
                    <QRCodeSVG value={captureUrl} size={160} level="M" />
                  </div>
                  <div className="flex items-center gap-2 justify-center flex-wrap">
                    <code className="text-[11px] text-text-faint font-mono break-all">
                      {captureUrl}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Copy className="w-3 h-3" />}
                      onClick={() => {
                        navigator.clipboard.writeText(captureUrl);
                        fireToast("Copied", "Capture link copied to clipboard");
                      }}
                    >
                      Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<MessageCircle className="w-3 h-3 text-[#25D366]" />}
                      onClick={() => {
                        const text = `Fill in your details to complete your order: ${captureUrl}`;
                        window.open(
                          `https://wa.me/?text=${encodeURIComponent(text)}`,
                          "_blank",
                          "noopener",
                        );
                      }}
                    >
                      Share
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Step 3: Products */}
      {step >= 3 && (
        <Card className="p-5">
          <div className="micro mb-3">Products</div>

          <div className="mb-3">
            <ProductPicker onPick={handlePick} allowCare />
          </div>

          {pendingStyled && (
            <StyledVariantPicker
              styledId={pendingStyled.id}
              productName={pendingStyled.label}
              imageUrl={pendingStyled.image_url}
              anchorPrice={
                pendingStyled.price != null ? Number(pendingStyled.price) : null
              }
              onCancel={() => setPendingStyled(null)}
              onConfirm={handleStyledPick}
            />
          )}

          {/* Own-wig check-in — only when a service is being sold */}
          {cart.some((l) => l.service_offering_id) && (
            <div className="mb-4 rounded-[11px] border border-line bg-text-primary/[0.02] p-3">
              <Toggle
                checked={ownWig}
                onChange={setOwnWig}
                label="Customer brought their own wig (check it in)"
              />
              {ownWig && (
                <input
                  className="mt-2 w-full rounded-lg border border-line bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent"
                  value={wigCondition}
                  onChange={(e) => setWigCondition(e.target.value)}
                  placeholder="Condition on arrival (e.g. lace intact, slight shedding)"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore=""
                  data-form-type="other"
                />
              )}
            </div>
          )}

          {cart.length > 0 && (
            <div className="space-y-2">
              {cart.map((line) => (
                <div
                  key={line.id}
                  className="flex items-center gap-3 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line"
                >
                  <div className="w-10 h-10 shrink-0 rounded-[8px] overflow-hidden bg-text-primary/[0.06]">
                    {line.image_url && (
                      <img
                        src={line.image_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">
                      {line.label}
                      {line.is_care && (
                        <span className="ml-1.5 inline-flex items-center px-1.5 py-[1px] rounded-[6px] text-[10px] font-bold uppercase tracking-wide bg-accent/15 text-accent-glow border border-accent/30 align-middle">
                          Care
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-text-faint">
                      {line.sku}
                    </div>
                    <StockBadge
                      available={line.available}
                      quantity={line.quantity}
                      stockOnly={line.is_care}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateQty(line.id, line.quantity - 1)}
                      className="w-7 h-7 rounded-lg bg-text-primary/[0.06] grid place-items-center text-[13px] font-bold"
                    >
                      −
                    </button>
                    <span className="w-8 text-center tabular-nums text-[13px]">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQty(line.id, line.quantity + 1)}
                      className="w-7 h-7 rounded-lg bg-text-primary/[0.06] grid place-items-center text-[13px] font-bold"
                    >
                      +
                    </button>
                  </div>
                  <MoneyText
                    ngn={line.unit_price * line.quantity}
                    className="text-[14px] w-24 text-right"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    className="text-text-faint hover:text-danger transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {!step || step < 4 ? (
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-3"
                  onClick={() => setStep(4)}
                >
                  Continue
                </Button>
              ) : null}
            </div>
          )}
        </Card>
      )}

      {/* Step 4: Configuration */}
      {step >= 4 && (
        <Card className="p-5">
          <div className="micro mb-3">Order Configuration</div>
          <FormGrid>
            <Field label="Currency">
              <Select
                value={currency}
                onChange={setCurrency}
                options={CURRENCY_OPTIONS}
              />
            </Field>
            <Field label="Coupon Code" hint="optional">
              <TextInput
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="Enter coupon"
              />
            </Field>
          </FormGrid>

          <div className="flex items-center gap-6 mt-4">
            <Toggle
              checked={applyVat}
              onChange={setApplyVat}
              label="Apply VAT (7.5%)"
            />
          </div>

          <div className="mt-5 rounded-[11px] border border-line bg-text-primary/[0.02] p-3">
            <Toggle
              checked={hasSpecificInstructions}
              onChange={setHasSpecificInstructions}
              label="Add specific instructions"
            />
            {hasSpecificInstructions && (
              <div className="mt-3">
                <textarea
                  value={specificInstructions}
                  onChange={(e) => setSpecificInstructions(e.target.value.slice(0, 2000))}
                  placeholder="e.g. Client wants soft curls, part in middle, no glue. Deliver after 3pm only…"
                  rows={4}
                  maxLength={2000}
                  className="w-full rounded-lg border border-line bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent resize-none"
                />
                <div className="mt-1 text-right text-[11px] text-text-faint">{specificInstructions.length}/2000</div>
              </div>
            )}
          </div>

          {offerInstalments && (
            <div className="mt-5">
              <div className="micro mb-2">Payment plan</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentPlan("full")}
                  className={`flex-1 rounded-[11px] border px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                    paymentPlan === "full"
                      ? "border-accent/50 bg-accent/10 text-accent-readable"
                      : "border-line text-text-muted"
                  }`}
                >
                  Pay in full
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentPlan("instalment")}
                  className={`flex-1 rounded-[11px] border px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                    paymentPlan === "instalment"
                      ? "border-accent/50 bg-accent/10 text-accent-readable"
                      : "border-line text-text-muted"
                  }`}
                >
                  {flexiSettings?.plan_display_name || "Flexi Pay"} (deposit)
                </button>
              </div>
              {paymentPlan === "instalment" && (
                <p className="text-[12px] text-text-muted mt-2">
                  Charges the {flexiSettings?.min_first_payment_pct ?? 30}%
                  deposit now; the customer pays the balance later via their pay
                  link.
                </p>
              )}
            </div>
          )}

          <div className="mt-5">
            <div className="micro mb-3">Fulfilment</div>
            <div className="flex gap-2 mb-3">
              {FULFILMENT_OPTIONS.map((f) => {
                const on = f.value === fulfilment;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFulfilment(f.value as FulfilmentType)}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 h-10 rounded-[10px] text-[13px] font-semibold border transition-colors",
                      on
                        ? "border-accent/50 text-accent-glow bg-accent/[0.1]"
                        : "border-line text-text-muted hover:text-text-primary",
                    )}
                  >
                    {f.value === "walk_in" ? (
                      <Store className="w-4 h-4" />
                    ) : (
                      <Truck className="w-4 h-4" />
                    )}
                    {f.label}
                  </button>
                );
              })}
            </div>

            {fulfilment === "dispatch" && (
              <div className="space-y-3">
                {/* Country → state → LGA zone picker — identical fields,
                    codes and endpoint as the storefront checkout, so the
                    fee below always agrees with what the customer would be
                    charged online. */}
                <Field label="Country">
                  <GeoComboBox
                    options={geo.countries}
                    value={country}
                    onChange={(name) => {
                      setCountry(name);
                      setCountryCode("");
                      setAddrState("");
                      setCity("");
                      setZoneCode("");
                    }}
                    onSelect={(item) => {
                      setCountry(item.name);
                      setCountryCode(item.code);
                      setAddrState("");
                      setCity("");
                      setZoneCode(item.code === "NG" ? "" : item.code);
                    }}
                    placeholder="Start typing your country…"
                  />
                </Field>

                {isNigeria ? (
                  <Field label="State">
                    <GeoComboBox
                      options={geo.nigeria_states}
                      value={addrState}
                      onChange={(name) => {
                        setAddrState(name);
                        setZoneCode("");
                        setCity("");
                      }}
                      onSelect={(item) => {
                        setAddrState(item.name);
                        setCity("");
                        setZoneCode(item.name === "Lagos" ? "" : item.code);
                      }}
                      placeholder="Select your state…"
                    />
                  </Field>
                ) : (
                  country && (
                    <Field label="State / Province">
                      <TextInput
                        value={addrState}
                        onChange={(e) => setAddrState(e.target.value)}
                        placeholder="State or province"
                      />
                    </Field>
                  )
                )}

                {isLagos ? (
                  <Field label="City / LGA">
                    <GeoComboBox
                      options={geo.lagos_lgas}
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
                  <Field label="City">
                    <TextInput
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City / town"
                    />
                  </Field>
                )}

                <Field label="Address line 1">
                  <TextInput
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    placeholder="House number and street"
                  />
                </Field>
                <Field label="Address line 2" hint="optional">
                  <TextInput
                    value={addressLine2}
                    onChange={(e) => setAddressLine2(e.target.value)}
                    placeholder="Apartment, landmark (optional)"
                  />
                </Field>

                <Field label="Shipping Fee (NGN)">
                  <NumberField
                    value={shippingFee}
                    onChange={setShippingFee}
                    onBlur={handleShippingBlur}
                    placeholder="0.00"
                    suffix="NGN"
                  />
                </Field>
                {hasCare && (
                  <div
                    role="note"
                    className="rounded-[11px] border border-warn/40 bg-warn/5 p-3 text-[12px]"
                  >
                    <div className="font-bold uppercase tracking-wide">
                      EXTRA DELIVERY FEES MAY APPLY
                    </div>
                    <div className="mt-1 text-text-muted">
                      This order has Care &amp; Accessories items — calculate the
                      delivery fee by hand and enter it above (the zone rate only
                      counts wigs). It is queued in Sales → Delivery Fee Review
                      and can&rsquo;t be dispatched until that fee is confirmed.
                    </div>
                  </div>
                )}
                {!effectiveZone && (
                  <p className="text-[12px] text-text-faint">
                    Pick the country (and state/LGA for Nigeria) from the
                    dropdown to calculate delivery.
                  </p>
                )}
                {quotingFee && (
                  <p className="text-[12px] text-text-faint">
                    Looking up the delivery rate for this address…
                  </p>
                )}
                {!quotingFee && zoneStatus === "unserviceable" && (
                  <p className="text-[12px] text-amber-300">
                    No delivery zone covers this address — enter the fee
                    manually.
                  </p>
                )}
                {!quotingFee && zoneStatus === "pending" && (
                  <p className="text-[12px] text-amber-300">
                    This zone resolved to ₦0 but isn&rsquo;t marked
                    free-delivery — confirm the real fee with Logistics
                    before dispatch.
                  </p>
                )}
                {!quotingFee &&
                  systemFee != null &&
                  (zoneStatus === "priced" || zoneStatus === "free") && (
                    <p className="text-[12px] text-text-faint">
                      System rate for this address: {ngn(systemFee)}
                      {Number(shippingFee) !== systemFee &&
                        " (overridden below)"}
                    </p>
                  )}
              </div>
            )}
          </div>

          {feeConfirm && (
            <ConfirmDialog
              open
              onClose={() => {
                // Cancel reverts to the system's own rate.
                setShippingFee(String(feeConfirm.from));
                setFeeConfirm(null);
              }}
              onConfirm={() => {
                setConfirmedFee(feeConfirm.to);
                setFeeConfirm(null);
              }}
              title="Change delivery fee?"
              tone="accent"
              confirmLabel="Yes, change it"
              message={
                <>
                  You&rsquo;re {feeConfirm.to > feeConfirm.from
                    ? "increasing"
                    : "reducing"}{" "}
                  the delivery fee for dispatch to{" "}
                  <strong>
                    {[addressLine1, city, addrState, country]
                      .filter(Boolean)
                      .join(", ") || "this address"}
                  </strong>{" "}
                  from{" "}
                  <strong>{ngn(feeConfirm.from)}</strong> to{" "}
                  <strong>{ngn(feeConfirm.to)}</strong>. Do you want to
                  confirm?
                </>
              }
            />
          )}

          {step < 5 && (
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={() => setStep(5)}
            >
              Review & Send
            </Button>
          )}
        </Card>
      )}

      {/* Step 5: Summary & Send */}
      {step >= 5 && !sentOrderId && (
        <Card className="p-5">
          <div className="micro mb-3">Order Summary</div>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-text-muted">Customer</span>
              <span className="font-semibold">{contactName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Channel</span>
              <span>
                {SALES_CHANNELS.find((c) => c.value === channel)?.label}
              </span>
            </div>
            <div className="h-px bg-line my-2" />
            <div className="space-y-2">
              {cart.map((line) => (
                <div key={line.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 shrink-0 rounded-[7px] overflow-hidden bg-text-primary/[0.06]">
                    {line.image_url && (
                      <img
                        src={line.image_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{line.label}</div>
                  </div>
                  <span className="text-text-muted shrink-0">
                    ×{line.quantity}
                  </span>
                  <MoneyText
                    ngn={line.unit_price * line.quantity}
                    className="shrink-0 w-20 text-right"
                  />
                </div>
              ))}
            </div>
            <div className="h-px bg-line my-2" />
            <div className="flex justify-between">
              <span className="text-text-muted">Subtotal</span>
              <MoneyText ngn={subtotal} />
            </div>
            {applyVat && (
              <div className="flex justify-between">
                <span className="text-text-muted">VAT (7.5%)</span>
                <MoneyText ngn={vatAmount} />
              </div>
            )}
            {shipping > 0 && (
              <div className="flex justify-between">
                <span className="text-text-muted">Shipping</span>
                <MoneyText ngn={shipping} />
              </div>
            )}
            <div className="flex justify-between text-[16px] font-semibold pt-1">
              <span>Total</span>
              {/* USD: the engine's dollar total, the ₦ figure beneath. */}
              <MoneyText
                ngn={total}
                display={
                  currency === "USD" && usdTotal != null ? usdTotal : undefined
                }
                currency={currency}
                className="text-[16px]"
              />
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="flex gap-2">
              {(["email", "whatsapp"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSendVia(v)}
                  className={cn(
                    "px-3 h-8 rounded-[9px] text-[12px] font-semibold border transition-colors capitalize",
                    sendVia === v
                      ? "border-accent/50 text-accent-glow bg-accent/[0.1]"
                      : "border-line text-text-muted",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <Button
              variant="primary"
              icon={
                inStore ? (
                  <QrCode className="w-4 h-4" />
                ) : (
                  <Send className="w-4 h-4" />
                )
              }
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? inStore
                  ? "Preparing…"
                  : "Sending…"
                : inStore
                  ? "Take Payment Now"
                  : "Create Order & Send Pay Link"}
            </Button>
          </div>

          {createOrder.isError && (
            <p className="text-[12px] text-danger mt-3">
              {(createOrder.error as Error)?.message ??
                "Failed to create order"}
            </p>
          )}
        </Card>
      )}

      {/* Step 6: Confirmation */}
      {sentOrderId && (
        <Card className="p-5 text-center">
          {isPaid ? (
            /* ── Paid: the gateway cleared the balance ── */
            <>
              <div className="w-16 h-16 rounded-full bg-success/10 grid place-items-center mx-auto mb-3">
                <CheckCircle2 className="w-8 h-8 text-success" />
              </div>
              <h3 className="font-display text-xl font-medium mb-1">Paid ✓</h3>
              <p className="text-[14px] text-text-muted mb-4">
                Payment confirmed. You can hand over the goods.
              </p>
            </>
          ) : paymentLinkError && !paymentUrl ? (
            /* ── Order saved, but the payment link couldn't be minted. The
               order EXISTS — offer a retry, never a re-create. ── */
            <>
              <div className="w-14 h-14 rounded-full bg-warn/10 grid place-items-center mx-auto mb-3">
                <AlertTriangle className="w-7 h-7 text-warn" />
              </div>
              <h3 className="font-display text-lg font-medium mb-1">
                Order saved — payment link didn&apos;t generate
              </h3>
              <p className="text-[13px] text-text-muted mb-2">
                {watchedOrder?.order_number
                  ? `Order ${watchedOrder.order_number} is saved`
                  : "The order is saved"}{" "}
                and nothing was charged. This is usually a brief payment-gateway
                hiccup — retry the link, or take payment another way.
              </p>
              <p className="text-[12px] text-danger mb-4 font-mono break-all">
                {paymentLinkError}
              </p>
              <div className="flex items-center gap-2 justify-center flex-wrap mb-2">
                <Button
                  variant="primary"
                  size="sm"
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  onClick={retryPaymentLink}
                  disabled={retryingLink}
                >
                  {retryingLink ? "Retrying…" : "Retry payment link"}
                </Button>
              </div>
            </>
          ) : inStore && paymentUrl ? (
            /* ── In-store: customer scans and pays on the spot ── */
            <>
              <div className="w-12 h-12 rounded-full bg-accent/10 grid place-items-center mx-auto mb-3">
                <Smartphone className="w-6 h-6 text-accent-glow" />
              </div>
              <h3 className="font-display text-lg font-medium mb-1">
                Ask the customer to scan &amp; pay
              </h3>
              <p className="text-[13px] text-text-muted mb-4">
                Point their phone camera at the code. They can pay by{" "}
                <span className="text-text-primary font-semibold">
                  bank transfer, card, or USSD
                </span>{" "}
                — the screen updates the moment it&apos;s done.
              </p>

              <div className="inline-block bg-white p-4 rounded-[14px] mb-4">
                <QRCodeSVG value={paymentUrl} size={196} level="M" />
              </div>

              <div className="flex items-center justify-center gap-2 text-[13px] text-text-muted mb-4">
                <span className="w-2.5 h-2.5 rounded-full bg-warn animate-pulse" />
                Waiting for payment…
              </div>
              {charged && charged.currency !== "NGN" && (
                <p className="text-[13px] mb-4">
                  Charging{" "}
                  <strong className="font-mono">
                    {charged.currency} {charged.amount}
                  </strong>{" "}
                  on Nomba
                </p>
              )}

              {/* Fallback: send/copy the link if they'd rather use their own device */}
              <div className="flex items-center gap-2 justify-center flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Copy className="w-3 h-3" />}
                  onClick={() => {
                    navigator.clipboard.writeText(paymentUrl);
                    fireToast("Copied", "Payment link copied to clipboard");
                  }}
                >
                  Copy link
                </Button>
              </div>
            </>
          ) : (
            /* ── Remote / dispatch: link sent to the customer ── */
            <>
              <div className="w-14 h-14 rounded-full bg-success/10 grid place-items-center mx-auto mb-3">
                <Send className="w-6 h-6 text-success" />
              </div>
              <h3 className="font-display text-lg font-medium mb-1">
                Order Created!
              </h3>
              <p className="text-[13px] text-text-muted mb-4">
                Payment link has been sent to the customer. The order confirms
                automatically once payment is received via the gateway.
              </p>
              {charged && charged.currency !== "NGN" && (
                <p className="text-[13px] mb-4">
                  The link charges{" "}
                  <strong className="font-mono">
                    {charged.currency} {charged.amount}
                  </strong>{" "}
                  on Nomba
                </p>
              )}
              {paymentUrl && (
                <div className="mb-4 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line">
                  <div className="text-[11px] text-text-faint mb-1">
                    Payment Link
                  </div>
                  <div className="inline-block bg-white p-3 rounded-[14px] my-2">
                    <QRCodeSVG value={paymentUrl} size={160} level="M" />
                  </div>
                  <div className="flex items-center gap-2 justify-center flex-wrap">
                    <code className="text-[11px] text-accent-glow font-mono break-all">
                      {paymentUrl}
                    </code>
                  </div>
                  <div className="flex items-center gap-2 justify-center flex-wrap mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Copy className="w-3 h-3" />}
                      onClick={() => {
                        navigator.clipboard.writeText(paymentUrl);
                        fireToast("Copied", "Payment link copied to clipboard");
                      }}
                    >
                      Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<MessageCircle className="w-3 h-3 text-[#25D366]" />}
                      onClick={() => {
                        const waNumber = (
                          watchedOrder?.contact_whatsapp ||
                          watchedOrder?.contact_phone ||
                          ""
                        ).replace(/\D/g, "");
                        const text = `Hi${
                          watchedOrder?.contact_name ? ` ${watchedOrder.contact_name}` : ""
                        }, here's your payment link${
                          watchedOrder?.order_number
                            ? ` for order ${watchedOrder.order_number}`
                            : ""
                        }: ${paymentUrl}`;
                        const shareUrl = waNumber
                          ? `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`
                          : `https://wa.me/?text=${encodeURIComponent(text)}`;
                        window.open(shareUrl, "_blank", "noopener");
                      }}
                    >
                      Share
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          <Button variant="primary" onClick={reset}>
            New Quick Sale
          </Button>
        </Card>
      )}
    </div>
  );
}
