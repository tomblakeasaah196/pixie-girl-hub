import { useState, useCallback, useMemo, useRef } from "react";
import {
  Search,
  User,
  X,
  Truck,
  Store,
  Send,
  QrCode,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, Button, MoneyText } from "@/components/ui/primitives";
import { Toggle, Select, NumberField } from "@/components/ui/controls";
import { FormGrid, Field, TextInput } from "@/components/ui/Form";
import {
  AddressAutocomplete,
  type PlaceAddress,
} from "@/components/ui/AddressAutocomplete";
import { ProductPicker } from "@/components/catalogue/ProductPicker";
import { resolvePick, type ProductHit } from "@/lib/product-search";
import { SALES_CHANNELS, FULFILMENT_OPTIONS } from "./constants";
import { useCreateOrder } from "./hooks";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { onboardingApi } from "@/lib/smartcomm-api";
import { useBusinessStore } from "@/stores/business";
import * as salesApi from "./api";
import { ServiceQuickAdd, type ServiceOffering } from "./ServiceQuickAdd";
import { api } from "@/lib/api";
import type { SalesChannel, FulfilmentType, OrderCreateInput } from "./types";

interface CartLine {
  id: string;
  variant_id: string;
  // Set when this line is a service (walk-in revamp/install) instead of a product.
  service_offering_id?: string;
  label: string;
  sku: string;
  unit_price: number;
  quantity: number;
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

  // Step 3: Products
  const [cart, setCart] = useState<CartLine[]>([]);
  // Own-wig check-in (walk-in revamp): take the customer's wig into custody.
  const [ownWig, setOwnWig] = useState(false);
  const [wigCondition, setWigCondition] = useState("");

  // Step 4: Config
  const [currency, setCurrency] = useState("NGN");
  const [applyVat, setApplyVat] = useState(true);
  const [coupon, setCoupon] = useState("");
  const [fulfilment, setFulfilment] = useState<FulfilmentType>("walk_in");
  const [addressText, setAddressText] = useState("");
  const [, setAddress] = useState<PlaceAddress | null>(null);
  const [shippingFee, setShippingFee] = useState("");

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

  const fireToast = (
    title: string,
    body: string,
    type = "order",
    priority: "normal" | "high" = "normal",
  ) => {
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

  // ── Product pick (type-first picker → resolved order lines) ──
  const handlePick = async (hit: ProductHit) => {
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
      setCart((prev) => {
        const next = [...prev];
        for (const l of lines) {
          const i = next.findIndex((c) => c.variant_id === l.variant_id);
          if (i >= 0)
            next[i] = { ...next[i], quantity: next[i].quantity + l.quantity };
          else next.push({ id: crypto.randomUUID(), ...l });
        }
        return next;
      });
    } catch {
      fireToast("Error", "Failed to add product", "order", "high");
    }
  };

  // ── Add a service (walk-in revamp/install) to the cart ──
  const addService = (s: ServiceOffering) =>
    setCart((prev) => {
      const i = prev.findIndex((c) => c.service_offering_id === s.service_id);
      if (i >= 0)
        return prev.map((c, j) =>
          j === i ? { ...c, quantity: c.quantity + 1 } : c,
        );
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          variant_id: "",
          service_offering_id: s.service_id,
          label: s.name,
          sku: "Service",
          unit_price: Number(s.base_price_ngn) || 0,
          quantity: 1,
        },
      ];
    });

  const removeLine = (id: string) =>
    setCart((prev) => prev.filter((l) => l.id !== id));

  const updateQty = (id: string, qty: number) =>
    setCart((prev) =>
      prev.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, qty) } : l)),
    );

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
              },
        ),
        bundle_id: bundleId || undefined,
        coupon_code: coupon || undefined,
        shipping_fee_ngn: shipping || undefined,
      };
      const order = await createOrder.mutateAsync(input);
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
      const link = await salesApi.createPaymentLink(order.order_id, {
        amount_ngn: Number(order.balance_due_ngn),
        currency: currency !== "NGN" ? currency : undefined,
      });
      setPaymentUrl(link.checkout_url);
      setSentOrderId(order.order_id);
      setStep(6);
      fireToast(
        "Order Created",
        `Order ${order.order_number} created — payment link sent.`,
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
    setApplyVat(true);
    setCoupon("");
    setFulfilment("walk_in");
    setAddressText("");
    setAddress(null);
    setShippingFee("");
    setSentOrderId(null);
    setBundleId(null);
    setPaymentUrl(null);
    setCaptureUrl(null);
    setShowQr(false);
  };

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-4">
      {/* Step 1: Channel */}
      <Card className="p-5">
        <div className="micro mb-3">Sales Channel</div>
        <div className="flex flex-wrap gap-1.5">
          {SALES_CHANNELS.map((ch) => (
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
                  placeholder="Search by name, email, or phone…"
                  value={contactSearch}
                  onChange={(e) => handleContactSearch(e.target.value)}
                  className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
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
                      setCaptureUrl(res.url);
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
                  <p className="text-[12px] text-text-muted mb-2">
                    Share the order capture link — customer fills their details
                    and is auto-selected.
                  </p>
                  <div className="flex items-center gap-2 justify-center">
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

          {/* Sell a service beside any retail item (Stylist Studio) */}
          <div className="mb-4">
            <ServiceQuickAdd onAdd={addService} />
          </div>

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
                    onPlaceSelected={(p) => setAddress(p)}
                  />
                </Field>
                <Field label="Shipping Fee (NGN)">
                  <NumberField
                    value={shippingFee}
                    onChange={setShippingFee}
                    placeholder="0.00"
                    suffix="NGN"
                  />
                </Field>
              </div>
            )}
          </div>

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
              icon={<Send className="w-4 h-4" />}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Sending…" : "Create Order & Send Pay Link"}
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
          <div className="w-14 h-14 rounded-full bg-success/10 grid place-items-center mx-auto mb-3">
            <Send className="w-6 h-6 text-success" />
          </div>
          <h3 className="font-display text-lg font-medium mb-1">
            Order Created!
          </h3>
          <p className="text-[13px] text-text-muted mb-4">
            Payment link has been sent to the customer. The order will be
            confirmed once payment is received via the gateway.
          </p>
          {paymentUrl && (
            <div className="mb-4 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line">
              <div className="text-[11px] text-text-faint mb-1">
                Payment Link
              </div>
              <div className="flex items-center gap-2 justify-center">
                <code className="text-[11px] text-accent-glow font-mono break-all">
                  {paymentUrl}
                </code>
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
              </div>
            </div>
          )}
          <Button variant="primary" onClick={reset}>
            New Quick Sale
          </Button>
        </Card>
      )}
    </div>
  );
}
