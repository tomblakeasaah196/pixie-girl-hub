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
  CheckCircle2,
  Smartphone,
  MessageCircle,
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
import {
  AddressAutocomplete,
  type PlaceAddress,
} from "@/components/ui/AddressAutocomplete";
import { useZoneQuote } from "@/lib/logistics-api";
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
} from "./constants";
import {
  useCreateOrder,
  useOrderPaymentWatch,
  usePaymentSettings,
} from "./hooks";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { toastReport } from "@/lib/error-report";
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
  /** Sellable units behind this line at pick time — drives the in-stock /
   *  made-to-order badge. Null/undefined = no stock reading (e.g. a service). */
  available?: number | null;
}

interface SearchResult {
  id: string;
  label: string;
  sub: string;
}

const CURRENCY_OPTIONS = [
  { value: "NGN", label: "NGN" },
  { value: "USD", label: "USD" },
  { value: "GBP", label: "GBP" },
  { value: "EUR", label: "EUR" },
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
}: {
  available?: number | null;
  quantity: number;
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
          ? `Only ${available} left — ${quantity - available} will be made to order`
          : `In stock · ${available} left`}
      </div>
    );
  }

  // Out of stock. Pre-orders switched off brand-wide means a genuine sold-out.
  if (cfg && cfg.preorder_enabled === false) {
    return (
      <div className="mt-1 text-[11px] font-medium text-red-400">
        Out of stock
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
  const [step, setStep] = useState(1);

  // Step 1: Channel
  const [channel, setChannel] = useState<SalesChannel>("instagram");

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
  const [fulfilment, setFulfilment] = useState<FulfilmentType>("walk_in");
  const [addressText, setAddressText] = useState("");
  const [shippingFee, setShippingFee] = useState("");
  // The delivery-zone engine's own rate for the picked address — the SAME
  // rate-card the website/order-link checkouts charge. null until an address
  // with a resolvable zone is picked. Compared against the (editable)
  // shippingFee field so a manual change always prompts a confirmation
  // relative to the real system rate, not a chain of prior overrides.
  const zoneQuote = useZoneQuote();
  const [systemFee, setSystemFee] = useState<number | null>(null);
  const [zoneStatus, setZoneStatus] = useState<
    "priced" | "free" | "pending" | "unserviceable" | null
  >(null);
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
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const toast = useToastStore();
  const activeBiz = useBusinessStore((s) => s.activeKey);

  // Watch the created order so the counter screen flips to "Paid" on its own
  // once the gateway confirms — no manual payment entry (anti-pocketing).
  const paymentWatch = useOrderPaymentWatch(sentOrderId);
  const watchedOrder = paymentWatch.data;
  const isPaid = watchedOrder
    ? Number(watchedOrder.balance_due_ngn) <= 0 ||
      !["draft", "pending_payment"].includes(watchedOrder.status)
    : false;
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
  const vatAmount = applyVat ? subtotal * 0.075 : 0;
  const shipping = Number(shippingFee) || 0;
  const total = subtotal + vatAmount + shipping;

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
  const handleAddressPick = async (place: PlaceAddress) => {
    setConfirmedFee(null);
    if (place.latitude == null || place.longitude == null) {
      setSystemFee(null);
      setZoneStatus(null);
      return;
    }
    try {
      const q = await zoneQuote.mutateAsync({
        lat: place.latitude,
        lng: place.longitude,
        country: place.country_code || undefined,
      });
      setZoneStatus(q.fee_status ?? (q.fee_ngn != null ? "priced" : "unserviceable"));
      if (q.fee_ngn != null) {
        setSystemFee(q.fee_ngn);
        setShippingFee(String(q.fee_ngn));
      } else {
        setSystemFee(null);
      }
    } catch {
      setSystemFee(null);
      setZoneStatus(null);
    }
  };

  // Any manual edit that lands away from the system's own rate needs an
  // explicit "yes, really" — staff can still override (an unconfigured zone,
  // a goodwill discount, a phone-negotiated deal), but never silently.
  const handleShippingBlur = () => {
    if (systemFee == null) return;
    const typed = Number(shippingFee) || 0;
    if (typed === systemFee || typed === confirmedFee) return;
    setFeeConfirm({ from: systemFee, to: typed });
  };

  // ── Submit ───────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!contactId || cart.length === 0) return;
    setSubmitting(true);
    try {
      const input: OrderCreateInput = {
        contact_id: contactId,
        sales_channel: channel,
        order_type: fulfilment,
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
        shipping_fee_ngn: shipping || undefined,
        payment_plan:
          instalmentsEnabled && paymentPlan === "instalment"
            ? "instalment"
            : "full",
      };
      const order = await createOrder.mutateAsync(input);
      // Pre-order confirmation (000086): if a line went out of stock it was
      // recorded as made-to-order — tell the staff member so they can set the
      // customer's expectation before taking payment.
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
      const link = await salesApi.createPaymentLink(order.order_id, {
        amount_ngn: firstCharge,
        currency: currency !== "NGN" ? currency : undefined,
      });
      setPaymentUrl(link.checkout_url);
      setSentOrderId(order.order_id);
      setStep(6);
      fireToast(
        "Order Created",
        inStore
          ? `Order ${order.order_number} ready — ask the customer to scan & pay.`
          : `Order ${order.order_number} created — payment link sent.`,
      );
    } catch {
      fireToast(
        "Order Failed",
        "Failed to create order. Please try again.",
        "order",
        "high",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep(1);
    setChannel("instagram");
    setContactId(null);
    setContactName("");
    setContactSearch("");
    setCart([]);
    setCurrency("NGN");
    setApplyVat(false);
    setCoupon("");
    setPaymentPlan("full");
    setFulfilment("walk_in");
    setAddressText("");
    setShippingFee("");
    setSystemFee(null);
    setZoneStatus(null);
    setConfirmedFee(null);
    setFeeConfirm(null);
    setSentOrderId(null);
    setBundleId(null);
    setPaymentUrl(null);
    setCaptureUrl(null);
    setCaptureSubmissionId(null);
    setShowQr(false);
  };

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-4">
      {/* Step 1: Channel — grouped Digital / Physical per V2.2 §6.4 */}
      <Card className="p-5">
        <div className="micro mb-3">Sales Channel</div>
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
                      "px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors",
                      ch.value === channel
                        ? "border-accent/50 text-accent-glow bg-accent/[0.1]"
                        : "border-line text-text-muted hover:text-text-primary",
                    )}
                  >
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
        <Card className="p-5">
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
            <ProductPicker onPick={handlePick} />
          </div>

          {pendingStyled && (
            <StyledVariantPicker
              styledId={pendingStyled.id}
              productName={pendingStyled.label}
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
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">
                      {line.label}
                    </div>
                    <div className="text-[11px] text-text-faint">
                      {line.sku}
                    </div>
                    <StockBadge
                      available={line.available}
                      quantity={line.quantity}
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

          {instalmentsEnabled && (
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
                <Field label="Delivery Address">
                  <AddressAutocomplete
                    value={addressText}
                    onChange={setAddressText}
                    onPlaceSelected={handleAddressPick}
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
                {zoneQuote.isPending && (
                  <p className="text-[12px] text-text-faint">
                    Looking up the delivery rate for this address…
                  </p>
                )}
                {!zoneQuote.isPending && zoneStatus === "unserviceable" && (
                  <p className="text-[12px] text-amber-300">
                    No delivery zone covers this address — enter the fee
                    manually.
                  </p>
                )}
                {!zoneQuote.isPending && zoneStatus === "pending" && (
                  <p className="text-[12px] text-amber-300">
                    This zone resolved to ₦0 but isn&rsquo;t marked
                    free-delivery — confirm the real fee with Logistics
                    before dispatch.
                  </p>
                )}
                {!zoneQuote.isPending &&
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
                  <strong>{addressText || "this address"}</strong> from{" "}
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
            <div className="flex justify-between">
              <span className="text-text-muted">Items</span>
              <span>{cart.reduce((s, l) => s + l.quantity, 0)}</span>
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
              <MoneyText
                ngn={total}
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
