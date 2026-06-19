import { useState, useCallback, useMemo, useRef } from "react";
import { Search, X, Plus, Minus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button, MoneyText } from "@/components/ui/primitives";
import { Select, NumberField } from "@/components/ui/controls";
import { FormGrid, Field, TextInput } from "@/components/ui/Form";
import { useCreateQuotation } from "./hooks";
import { useToastStore } from "@/components/notifications/NotificationToast";
import * as salesApi from "./api";
import { FULFILMENT_OPTIONS } from "./constants";
import type { FulfilmentType, QuotationCreateInput } from "./types";

interface QuoteLine {
  id: string;
  variant_id: string;
  label: string;
  quantity: number;
  unit_price: number;
  discount: number;
}

interface ContactHit {
  id: string;
  label: string;
  sub: string;
}

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
  const [productSearch, setProductSearch] = useState("");
  const [productHits, setProductHits] = useState<
    { id: string; label: string; sub: string }[]
  >([]);
  const [lines, setLines] = useState<QuoteLine[]>([]);

  // Step 3: Terms
  const [validUntil, setValidUntil] = useState("");
  const [payTerms, setPayTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [deliveryType, setDeliveryType] = useState<FulfilmentType>("walk_in");
  const [shippingFee, setShippingFee] = useState("");

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

  const searchProducts = useCallback(async (q: string) => {
    setProductSearch(q);
    if (q.length < 2) {
      setProductHits([]);
      return;
    }
    try {
      const res = await salesApi.searchProducts(q);
      setProductHits(
        res.data.map((p) => ({ id: p.product_id, label: p.name, sub: p.slug })),
      );
    } catch {
      setProductHits([]);
    }
  }, []);

  const addProduct = async (r: { id: string; label: string }) => {
    setProductSearch("");
    setProductHits([]);
    try {
      const variants = await salesApi.getProductVariants(r.id);
      for (const v of variants.filter((vr) => vr.is_active)) {
        setLines((prev) => {
          if (prev.find((l) => l.variant_id === v.variant_id)) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              variant_id: v.variant_id,
              label: `${r.label} — ${v.variant_name}`,
              quantity: 1,
              unit_price: Number(
                v.price_storefront_ngn ?? v.price_pos_ngn ?? 0,
              ),
              discount: 0,
            },
          ];
        });
      }
    } catch {
      /* ignore */
    }
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
    setShippingFee("");
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
                className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
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
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
            <input
              autoFocus
              placeholder="Search products…"
              value={productSearch}
              onChange={(e) => searchProducts(e.target.value)}
              className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
            />
            {productHits.length > 0 && (
              <div className="absolute z-50 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] dropglass py-1 max-h-[200px] overflow-y-auto">
                {productHits.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => addProduct(r)}
                    className="w-full px-4 py-2.5 text-left hover:bg-text-primary/[0.06]"
                  >
                    <div className="text-[13px] font-semibold">{r.label}</div>
                    <div className="text-[11px] text-text-faint">{r.sub}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

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
            <Field label="Shipping Fee (NGN)" hint="optional">
              <NumberField
                value={shippingFee}
                onChange={setShippingFee}
                placeholder="0.00"
                suffix="NGN"
              />
            </Field>
          </FormGrid>
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
