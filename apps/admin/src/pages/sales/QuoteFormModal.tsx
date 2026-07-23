import { useState, useCallback, useMemo, useRef } from "react";
import { Search, X, Plus, Minus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button, MoneyText } from "@/components/ui/primitives";
import { Select, NumberField, ConfirmDialog } from "@/components/ui/controls";
import { FormGrid, Field, TextInput } from "@/components/ui/Form";
import {
  AddressAutocomplete,
  type PlaceAddress,
} from "@/components/ui/AddressAutocomplete";
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
import { useZoneQuote } from "@/lib/logistics-api";
import { useCreateQuotation } from "./hooks";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { toastReport } from "@/lib/error-report";
import * as salesApi from "./api";
import { FULFILMENT_OPTIONS } from "./constants";
import type { FulfilmentType, QuotationCreateInput } from "./types";

interface QuoteLine {
  id: string;
  variant_id: string;
  label: string;
  sku: string;
  quantity: number;
  unit_price: number;
  discount: number;
  // Snapshot overrides from a styled head-size/lace/colour pick — see
  // ResolvedLine. Falls back to `label`/undefined for every other kind.
  product_name_snapshot?: string;
  variant_label_snapshot?: string;
}

interface ContactHit {
  id: string;
  label: string;
  sub: string;
}

const ngn = (v: number) => `₦${v.toLocaleString()}`;

export function QuoteFormModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateQuotation();
  const toast = useToastStore();
  const fireToast = (
    title: string,
    body: string,
    type = "order",
    priority: "normal" | "high" = "normal",
  ) => {
    if (priority === "high") {
      toastReport("Sales → Quotation", title, body || "Something went wrong.");
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
  const [formStep, setFormStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Customer
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [contactHits, setContactHits] = useState<ContactHit[]>([]);

  // Step 2: Products
  const [lines, setLines] = useState<QuoteLine[]>([]);
  // A styled pick awaiting its head-size/lace/colour choice before it can be
  // added to the quote; null when nothing is pending.
  const [pendingStyled, setPendingStyled] = useState<ProductHit | null>(null);

  // Step 3: Terms
  const [validUntil, setValidUntil] = useState("");
  const [payTerms, setPayTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [deliveryType, setDeliveryType] = useState<FulfilmentType>("walk_in");
  const [addressText, setAddressText] = useState("");
  const [shippingFee, setShippingFee] = useState("");
  // The delivery-zone engine's own rate for the picked address — the SAME
  // rate-card the website/order-link checkouts charge. Compared against the
  // (editable) shippingFee field so a manual change always prompts a
  // confirmation relative to the real system rate. Matters here too: an
  // unvalidated quote carries its shipping_fee_ngn straight through to the
  // real order when accepted and converted.
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

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.unit_price * l.quantity - l.discount, 0),
    [lines],
  );

  const contactDebounce = useRef<ReturnType<typeof setTimeout>>();
  const handleContactSearch = useCallback((q: string) => {
    setContactSearch(q);
    clearTimeout(contactDebounce.current);
    if (q.length < 2) {
      setContactHits([]);
      return;
    }
    contactDebounce.current = setTimeout(async () => {
      try {
        const res = await salesApi.searchContacts(q);
        setContactHits(
          (res.data ?? []).map((c) => ({
            id: c.contact_id,
            label: c.display_name,
            sub: [c.primary_phone, c.email].filter(Boolean).join(" · ") || "",
          })),
        );
      } catch {
        setContactHits([]);
      }
    }, 300);
  }, []);

  const addResolvedLines = (resolved: ResolvedLine[]) => {
    setLines((prev) => {
      const next = [...prev];
      for (const l of resolved) {
        const i = next.findIndex((x) => x.variant_id === l.variant_id);
        if (i >= 0)
          next[i] = { ...next[i], quantity: next[i].quantity + l.quantity };
        else
          next.push({
            id: crypto.randomUUID(),
            variant_id: l.variant_id,
            label: l.label,
            sku: l.sku,
            quantity: l.quantity,
            unit_price: l.unit_price,
            discount: 0,
            product_name_snapshot: l.product_name_snapshot,
            variant_label_snapshot: l.variant_label_snapshot,
          });
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
      const { lines: resolved } = await resolvePick(hit);
      if (resolved.length === 0) {
        fireToast(
          "Nothing to add",
          "That product has no active variant to quote.",
          "order",
          "high",
        );
        return;
      }
      addResolvedLines(resolved);
    } catch {
      fireToast("Error", "Failed to add product", "order", "high");
    }
  };

  const handleStyledPick = async (pick: StyledPick) => {
    const hit = pendingStyled;
    setPendingStyled(null);
    if (!hit) return;
    try {
      const { lines: resolved } = await resolveStyledPick(hit, pick);
      if (resolved.length === 0) {
        fireToast(
          "Nothing to add",
          "That product has no active variant to quote.",
          "order",
          "high",
        );
        return;
      }
      addResolvedLines(resolved);
    } catch {
      fireToast("Error", "Failed to add product", "order", "high");
    }
  };

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
  // explicit "yes, really" — staff can still override, but never silently.
  const handleShippingBlur = () => {
    if (systemFee == null) return;
    const typed = Number(shippingFee) || 0;
    if (typed === systemFee || typed === confirmedFee) return;
    setFeeConfirm({ from: systemFee, to: typed });
  };

  const handleSubmit = async () => {
    if (!contactId || lines.length === 0) return;
    const input: QuotationCreateInput = {
      contact_id: contactId,
      lines: lines.map((l) => ({
        variant_id: l.variant_id,
        quantity: l.quantity,
        unit_price_ngn: l.unit_price,
        line_discount_ngn: l.discount || undefined,
        // The shop-facing name (styled product or bundle) resolved at pick
        // time — without this the quote falls back to the raw base-product
        // name/SKU it sells through. A styled pick carries the pure name +
        // its size/lace/colour spec separately; every other kind falls back
        // to the combined display label.
        product_name_snapshot: l.product_name_snapshot ?? l.label,
        variant_label_snapshot: l.variant_label_snapshot,
        sku_snapshot: l.sku,
      })),
      valid_until: validUntil || undefined,
      payment_terms: payTerms || undefined,
      notes: notes || undefined,
      internal_notes: internalNotes || undefined,
      delivery_type: deliveryType,
      shipping_fee_ngn: Number(shippingFee) || undefined,
    };
    try {
      await create.mutateAsync(input);
      fireToast(
        "Quotation Created",
        "Quotation has been created successfully.",
      );
      handleClose();
    } catch {
      fireToast(
        "Quotation Failed",
        "Failed to create quotation.",
        "order",
        "high",
      );
    }
  };

  const handleClose = () => {
    setFormStep(1);
    setContactId(null);
    setContactName("");
    setContactSearch("");
    setLines([]);
    setValidUntil("");
    setPayTerms("");
    setNotes("");
    setInternalNotes("");
    setAddressText("");
    setShippingFee("");
    setSystemFee(null);
    setZoneStatus(null);
    setConfirmedFee(null);
    setFeeConfirm(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="New Quotation" size="lg">
      {/* Step indicators */}
      <div className="flex gap-2 mb-5">
        {(["Customer", "Products", "Terms", "Review"] as const).map(
          (label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold ${formStep > i + 1 ? "bg-success text-white" : formStep === i + 1 ? "bg-accent-deep text-[#F4E9D9]" : "bg-text-primary/[0.08] text-text-faint"}`}
              >
                {i + 1}
              </div>
              <span
                className={`text-[12px] font-semibold ${formStep === i + 1 ? "text-text-primary" : "text-text-faint"}`}
              >
                {label}
              </span>
              {i < 3 && <div className="w-6 h-px bg-line" />}
            </div>
          ),
        )}
      </div>

      {/* Step 1: Customer */}
      {formStep === 1 && (
        <div className="space-y-3">
          {contactId ? (
            <div className="flex items-center gap-3 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line">
              <div className="text-[14px] font-semibold flex-1">
                {contactName}
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
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
              <input
                autoFocus
                placeholder="Search customer…"
                value={contactSearch}
                onChange={(e) => handleContactSearch(e.target.value)}
                className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
              />
              {contactHits.length > 0 && (
                <div className="absolute z-50 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] dropglass py-1 max-h-[200px] overflow-y-auto">
                  {contactHits.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setContactId(r.id);
                        setContactName(r.label);
                        setContactSearch(r.label);
                        setContactHits([]);
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-text-primary/[0.06]"
                    >
                      <div className="text-[13px] font-semibold">{r.label}</div>
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
          )}
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={!contactId}
              onClick={() => setFormStep(2)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Products */}
      {formStep === 2 && (
        <div className="space-y-3">
          <ProductPicker onPick={handlePick} autoFocus />

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

          {lines.length > 0 && (
            <div className="space-y-2">
              {lines.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center gap-3 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">
                      {l.label}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setLines((p) =>
                          p.map((x) =>
                            x.id === l.id
                              ? { ...x, quantity: Math.max(1, x.quantity - 1) }
                              : x,
                          ),
                        )
                      }
                      className="w-6 h-6 rounded bg-text-primary/[0.06] grid place-items-center"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-6 text-center text-[13px] tabular-nums">
                      {l.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setLines((p) =>
                          p.map((x) =>
                            x.id === l.id
                              ? { ...x, quantity: x.quantity + 1 }
                              : x,
                          ),
                        )
                      }
                      className="w-6 h-6 rounded bg-text-primary/[0.06] grid place-items-center"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <MoneyText
                    ngn={l.unit_price * l.quantity}
                    className="w-24 text-right text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setLines((p) => p.filter((x) => x.id !== l.id))
                    }
                    className="text-text-faint hover:text-danger"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="flex justify-between text-[14px] font-semibold pt-2 px-1">
                <span>Subtotal</span>
                <MoneyText ngn={subtotal} />
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setFormStep(1)}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={lines.length === 0}
              onClick={() => setFormStep(3)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Terms */}
      {formStep === 3 && (
        <div className="space-y-4">
          <FormGrid>
            <Field label="Valid Until">
              <TextInput
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </Field>
            <Field label="Delivery">
              <Select
                value={deliveryType}
                onChange={(v) => setDeliveryType(v as FulfilmentType)}
                options={
                  FULFILMENT_OPTIONS as unknown as {
                    value: FulfilmentType;
                    label: string;
                  }[]
                }
              />
            </Field>
            <Field label="Payment Terms" hint="optional">
              <TextInput
                value={payTerms}
                onChange={(e) => setPayTerms(e.target.value)}
                placeholder="e.g. 50% deposit, balance on delivery"
              />
            </Field>
          </FormGrid>

          {deliveryType === "dispatch" && (
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
                  free-delivery — confirm the real fee with Logistics before
                  dispatch.
                </p>
              )}
              {!zoneQuote.isPending &&
                systemFee != null &&
                (zoneStatus === "priced" || zoneStatus === "free") && (
                  <p className="text-[12px] text-text-faint">
                    System rate for this address: {ngn(systemFee)}
                    {Number(shippingFee) !== systemFee && " (overridden below)"}
                  </p>
                )}
            </div>
          )}

          {feeConfirm && (
            <ConfirmDialog
              open
              onClose={() => {
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

          <Field label="Notes to customer" hint="optional">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-[13px] py-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 resize-none"
            />
          </Field>
          <Field label="Internal notes" hint="not visible to customer">
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              className="w-full px-[13px] py-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 resize-none"
            />
          </Field>
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setFormStep(2)}>
              Back
            </Button>
            <Button variant="primary" size="sm" onClick={() => setFormStep(4)}>
              Review
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Review */}
      {formStep === 4 && (
        <div className="space-y-4">
          <div className="text-[13px] space-y-2">
            <div className="flex justify-between">
              <span className="text-text-muted">Customer</span>
              <span className="font-semibold">{contactName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Items</span>
              <span>{lines.reduce((s, l) => s + l.quantity, 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Valid Until</span>
              <span>{validUntil || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Delivery</span>
              <span className="capitalize">
                {deliveryType.replace(/_/g, " ")}
              </span>
            </div>
            <div className="h-px bg-line my-2" />
            {lines.map((l) => (
              <div key={l.id} className="flex justify-between">
                <span className="truncate flex-1 mr-3">
                  {l.label} × {l.quantity}
                </span>
                <MoneyText ngn={l.unit_price * l.quantity} />
              </div>
            ))}
            {Number(shippingFee) > 0 && (
              <div className="flex justify-between">
                <span className="text-text-muted">Shipping</span>
                <MoneyText ngn={Number(shippingFee)} />
              </div>
            )}
            <div className="h-px bg-line my-2" />
            <div className="flex justify-between text-[15px] font-semibold">
              <span>Total</span>
              <MoneyText ngn={subtotal + (Number(shippingFee) || 0)} />
            </div>
          </div>
          {create.isError && (
            <p className="text-[12px] text-danger">
              {(create.error as Error)?.message ?? "Failed to create quotation"}
            </p>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setFormStep(3)}>
              Back
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={create.isPending}
            >
              {create.isPending ? "Creating…" : "Create Quotation"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
