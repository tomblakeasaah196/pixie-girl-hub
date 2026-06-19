import { useState, useCallback, useMemo } from "react";
import {
  Search, User, Package, Layers, Box, X, Truck, Store,
  Send, QrCode, Copy,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, Button, MoneyText } from "@/components/ui/primitives";
import { Toggle, Select, NumberField } from "@/components/ui/controls";
import { FormGrid, Field, TextInput } from "@/components/ui/Form";
import { AddressAutocomplete, type PlaceAddress } from "@/components/ui/AddressAutocomplete";
import { SALES_CHANNELS, FULFILMENT_OPTIONS } from "./constants";
import { useCreateOrder } from "./hooks";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { onboardingApi } from "@/lib/smartcomm-api";
import { useBusinessStore } from "@/stores/business";
import * as salesApi from "./api";
import type {
  SalesChannel,
  FulfilmentType,
  OrderCreateInput,
} from "./types";

type ProductType = "base" | "styled" | "bundle";

interface CartLine {
  id: string;
  variant_id: string;
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

const PRODUCT_TYPES: { key: ProductType; label: string; icon: typeof Package }[] = [
  { key: "base", label: "Base Product", icon: Package },
  { key: "styled", label: "Styled Product", icon: Layers },
  { key: "bundle", label: "Bundle", icon: Box },
];

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
  const [channel, setChannel] = useState<SalesChannel>("pos");

  // Step 2: Customer
  const [contactSearch, setContactSearch] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactResults, setContactResults] = useState<SearchResult[]>([]);
  const [showQr, setShowQr] = useState(false);

  // Step 3: Products
  const [productType, setProductType] = useState<ProductType>("base");
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<SearchResult[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);

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

  const fireToast = (title: string, body: string, type = "order", priority: "normal" | "high" = "normal") => {
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
  const searchContacts = useCallback(async (q: string) => {
    setContactSearch(q);
    if (q.length < 2) { setContactResults([]); return; }
    try {
      const { data } = await import("@/lib/api").then(m =>
        m.api.get<{ data: Array<{ contact_id: string; display_name: string; email: string | null }> }>(
          `/contacts?q=${encodeURIComponent(q)}&page_size=6`
        )
      );
      setContactResults(
        data.map((c) => ({
          id: c.contact_id,
          label: c.display_name,
          sub: c.email ?? "",
        })),
      );
    } catch { setContactResults([]); }
  }, []);

  const pickContact = (r: SearchResult) => {
    setContactId(r.id);
    setContactName(r.label);
    setContactSearch(r.label);
    setContactResults([]);
    setStep(3);
  };

  // ── Product search ───────────────────────────────────────
  const searchProducts = useCallback(async (q: string) => {
    setProductSearch(q);
    if (q.length < 2) { setProductResults([]); return; }
    try {
      if (productType === "base") {
        const res = await salesApi.searchProducts(q);
        setProductResults(res.data.map((p) => ({ id: p.product_id, label: p.name, sub: p.slug })));
      } else if (productType === "styled") {
        const res = await salesApi.searchStyledProducts(q);
        setProductResults(res.data.map((p) => ({
          id: p.styled_product_id,
          label: p.name,
          sub: `${p.styled_code} · ${p.retail_price_ngn ? `₦${Number(p.retail_price_ngn).toLocaleString()}` : "No price"}`,
        })));
      } else {
        const bundles = await salesApi.searchBundles(q);
        const lower = q.toLowerCase();
        setProductResults(
          bundles
            .filter((b) => b.display_name.toLowerCase().includes(lower) || b.bundle_code.toLowerCase().includes(lower))
            .slice(0, 10)
            .map((b) => ({
              id: b.bundle_id,
              label: b.display_name,
              sub: `${b.bundle_code} · ${b.bundle_price_ngn ? `₦${Number(b.bundle_price_ngn).toLocaleString()}` : b.pricing_model}`,
            })),
        );
      }
    } catch { setProductResults([]); }
  }, [productType]);

  const pickProduct = async (r: SearchResult) => {
    setProductSearch("");
    setProductResults([]);
    if (productType === "base") {
      try {
        const variants = await salesApi.getProductVariants(r.id);
        const active = variants.filter((v) => v.is_active);
        for (const v of active) {
          const price = Number(v.price_storefront_ngn ?? v.price_pos_ngn ?? 0);
          setCart((prev) => {
            const existing = prev.find((l) => l.variant_id === v.variant_id);
            if (existing) return prev.map((l) => l.variant_id === v.variant_id ? { ...l, quantity: l.quantity + 1 } : l);
            return [...prev, {
              id: crypto.randomUUID(),
              variant_id: v.variant_id,
              label: `${r.label} — ${v.variant_name}`,
              sku: v.sku,
              unit_price: price,
              quantity: 1,
            }];
          });
        }
      } catch { /* toast error */ }
    } else if (productType === "styled") {
      try {
        const sp = await salesApi.getStyledProduct(r.id);
        setCart((prev) => {
          if (prev.find((l) => l.variant_id === sp.base_variant_id)) return prev;
          return [...prev, {
            id: crypto.randomUUID(),
            variant_id: sp.base_variant_id,
            label: sp.name,
            sku: r.sub.split(" · ")[0],
            unit_price: Number(sp.retail_price_ngn ?? 0),
            quantity: 1,
          }];
        });
      } catch { fireToast("Error", "Failed to load styled product", "order", "high"); }
    } else {
      try {
        const bundle = await salesApi.getBundle(r.id);
        setBundleId(bundle.bundle_id);
        for (const comp of bundle.components) {
          let variantId = comp.variant_id;
          let variantName = comp.role;
          let variantSku = "";
          let price = Number(bundle.bundle_price_ngn ?? 0) / (bundle.components.length || 1);
          if (comp.product_id) {
            const variants = await salesApi.getProductVariants(comp.product_id);
            const match = comp.variant_id
              ? variants.find((v) => v.variant_id === comp.variant_id)
              : variants.find((v) => v.is_active);
            if (match) {
              variantId = match.variant_id;
              variantName = match.variant_name;
              variantSku = match.sku;
              price = Number(match.price_storefront_ngn ?? match.price_pos_ngn ?? price);
            }
          }
          if (!variantId) continue;
          setCart((prev) => {
            if (prev.find((l) => l.variant_id === variantId)) return prev;
            return [...prev, {
              id: crypto.randomUUID(),
              variant_id: variantId!,
              label: `${bundle.display_name} — ${variantName}`,
              sku: variantSku || comp.bundle_product_id.slice(0, 8),
              unit_price: price,
              quantity: comp.quantity,
            }];
          });
        }
      } catch { fireToast("Error", "Failed to load bundle", "order", "high"); }
    }
  };

  const removeLine = (id: string) => setCart((prev) => prev.filter((l) => l.id !== id));

  const updateQty = (id: string, qty: number) =>
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, qty) } : l)));

  // ── Submit ───────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!contactId || cart.length === 0) return;
    setSubmitting(true);
    try {
      const input: OrderCreateInput = {
        contact_id: contactId,
        sales_channel: channel,
        order_type: fulfilment,
        lines: cart.map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
          unit_price_ngn: l.unit_price || undefined,
        })),
        bundle_id: bundleId || undefined,
        coupon_code: coupon || undefined,
        shipping_fee_ngn: shipping || undefined,
      };
      const order = await createOrder.mutateAsync(input);
      const link = await salesApi.createPaymentLink(order.order_id, {
        amount_ngn: Number(order.balance_due_ngn),
        currency: currency !== "NGN" ? currency : undefined,
      });
      setPaymentUrl(link.checkout_url);
      setSentOrderId(order.order_id);
      setStep(6);
      fireToast("Order Created", `Order ${order.order_number} created — payment link sent.`);
    } catch {
      fireToast("Order Failed", "Failed to create order. Please try again.", "order", "high");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep(1);
    setChannel("pos");
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
              onClick={() => { setChannel(ch.value as SalesChannel); if (step < 2) setStep(2); }}
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
                <div className="text-[14px] font-semibold truncate">{contactName}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setContactId(null); setContactName(""); setContactSearch(""); }}>
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
                  onChange={(e) => searchContacts(e.target.value)}
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
                        <div className="text-[13px] font-semibold">{r.label}</div>
                        {r.sub && <div className="text-[11px] text-text-faint">{r.sub}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" icon={<QrCode className="w-3.5 h-3.5" />} onClick={async () => {
                  if (captureUrl) { setShowQr(!showQr); return; }
                  setQrLoading(true);
                  try {
                    const res = await onboardingApi.createLink({ business: activeBiz ?? "pixiegirl", source: "walkin" });
                    setCaptureUrl(res.url);
                    setShowQr(true);
                  } catch { fireToast("Error", "Failed to generate capture link", "order", "high"); }
                  finally { setQrLoading(false); }
                }} disabled={qrLoading}>
                  {qrLoading ? "Generating…" : "QR Code"}
                </Button>
              </div>
              {showQr && captureUrl && (
                <div className="p-4 rounded-[11px] bg-text-primary/[0.03] border border-line text-center">
                  <p className="text-[12px] text-text-muted mb-2">
                    Share the order capture link — customer fills their details and is auto-selected.
                  </p>
                  <div className="flex items-center gap-2 justify-center">
                    <code className="text-[11px] text-text-faint font-mono break-all">{captureUrl}</code>
                    <Button variant="ghost" size="sm" icon={<Copy className="w-3 h-3" />} onClick={() => {
                      navigator.clipboard.writeText(captureUrl);
                      fireToast("Copied", "Capture link copied to clipboard");
                    }}>
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

          <div className="flex gap-1.5 mb-4">
            {PRODUCT_TYPES.map((pt) => {
              const on = pt.key === productType;
              const Icon = pt.icon;
              return (
                <button
                  key={pt.key}
                  type="button"
                  onClick={() => { setProductType(pt.key); setProductSearch(""); setProductResults([]); }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 h-8 rounded-[9px] text-[12px] font-semibold border transition-colors",
                    on
                      ? "border-accent/50 text-accent-glow bg-accent/[0.1]"
                      : "border-line text-text-muted hover:text-text-primary",
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {pt.label}
                </button>
              );
            })}
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
            <input
              placeholder={`Search ${productType === "bundle" ? "bundles" : "products"}…`}
              value={productSearch}
              onChange={(e) => searchProducts(e.target.value)}
              className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
            />
            {productResults.length > 0 && (
              <div className="absolute z-40 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] dropglass overflow-hidden py-1 max-h-[240px] overflow-y-auto">
                {productResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => pickProduct(r)}
                    className="w-full px-4 py-2.5 text-left hover:bg-text-primary/[0.06] transition-colors"
                  >
                    <div className="text-[13px] font-semibold">{r.label}</div>
                    <div className="text-[11px] text-text-faint">{r.sub}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {cart.length > 0 && (
            <div className="space-y-2">
              {cart.map((line) => (
                <div key={line.id} className="flex items-center gap-3 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">{line.label}</div>
                    <div className="text-[11px] text-text-faint">{line.sku}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => updateQty(line.id, line.quantity - 1)} className="w-7 h-7 rounded-lg bg-text-primary/[0.06] grid place-items-center text-[13px] font-bold">−</button>
                    <span className="w-8 text-center tabular-nums text-[13px]">{line.quantity}</span>
                    <button type="button" onClick={() => updateQty(line.id, line.quantity + 1)} className="w-7 h-7 rounded-lg bg-text-primary/[0.06] grid place-items-center text-[13px] font-bold">+</button>
                  </div>
                  <MoneyText ngn={line.unit_price * line.quantity} className="text-[14px] w-24 text-right" />
                  <button type="button" onClick={() => removeLine(line.id)} className="text-text-faint hover:text-danger transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {!step || step < 4 ? (
                <Button variant="primary" size="sm" className="mt-3" onClick={() => setStep(4)}>
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
              <Select value={currency} onChange={setCurrency} options={CURRENCY_OPTIONS} />
            </Field>
            <Field label="Coupon Code" hint="optional">
              <TextInput value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Enter coupon" />
            </Field>
          </FormGrid>

          <div className="flex items-center gap-6 mt-4">
            <Toggle checked={applyVat} onChange={setApplyVat} label="Apply VAT (7.5%)" />
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
                    {f.value === "walk_in" ? <Store className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
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
                  <NumberField value={shippingFee} onChange={setShippingFee} placeholder="0.00" suffix="NGN" />
                </Field>
              </div>
            )}
          </div>

          {step < 5 && (
            <Button variant="primary" size="sm" className="mt-4" onClick={() => setStep(5)}>
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
              <span>{SALES_CHANNELS.find((c) => c.value === channel)?.label}</span>
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
              <MoneyText ngn={total} currency={currency} className="text-[16px]" />
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
              {submitting ? "Sending…" : "Send Invoice & Pay Link"}
            </Button>
          </div>

          {createOrder.isError && (
            <p className="text-[12px] text-danger mt-3">
              {(createOrder.error as Error)?.message ?? "Failed to create order"}
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
          <h3 className="font-display text-lg font-medium mb-1">Invoice Sent!</h3>
          <p className="text-[13px] text-text-muted mb-4">
            Payment link has been sent to the customer. The order will be confirmed once payment is received via the gateway.
          </p>
          {paymentUrl && (
            <div className="mb-4 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line">
              <div className="text-[11px] text-text-faint mb-1">Payment Link</div>
              <div className="flex items-center gap-2 justify-center">
                <code className="text-[11px] text-accent-glow font-mono break-all">{paymentUrl}</code>
                <Button variant="ghost" size="sm" icon={<Copy className="w-3 h-3" />} onClick={() => {
                  navigator.clipboard.writeText(paymentUrl);
                  fireToast("Copied", "Payment link copied to clipboard");
                }}>
                  Copy
                </Button>
              </div>
            </div>
          )}
          <Button variant="primary" onClick={reset}>New Quick Sale</Button>
        </Card>
      )}
    </div>
  );
}
