/**
 * ChangeOrderModal — repair an order that was recorded wrong (§6.2).
 *
 * The whole point of this screen is that it is the SAME cart the sale was
 * taken on: the shared ProductPicker (base / styled / bundle / service) and the
 * StyledVariantPicker for head-size × lace × colour, exactly as Quick Sale.
 * Staff shouldn't have to learn a second way to choose a wig just because the
 * first attempt was wrong.
 *
 * Everything below the cart is about telling the truth before committing:
 *
 *   • the live difference — computed server-side by the same code that will do
 *     the change, so what's on screen is what will happen, not a guess;
 *   • the consequences — the warnings the backend raises (studio work already
 *     under way, a parcel already with the courier, stock that has to
 *     pre-order, a refund the change creates), each of which must be ticked
 *     before the Save button unlocks;
 *   • the reason, which is mandatory. An amendment moves money on an order the
 *     customer has already paid; "who changed what, and why" has to be
 *     answerable months later.
 *
 * Delivery details live here too, so "swap the wig AND fix her address" is one
 * change and one message to the customer rather than two.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  AlertTriangle,
  Store,
  Truck,
  ArrowRight,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Modal } from "@/components/ui/Modal";
import { Button, MoneyText, Pill } from "@/components/ui/primitives";
import { NumberField, Select, Toggle } from "@/components/ui/controls";
import { Field, TextInput, TextArea } from "@/components/ui/Form";
import { GeoComboBox } from "@/components/ui/GeoComboBox";
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
import {
  fetchGeoOptions,
  fetchDeliveryQuote,
  GEO_FALLBACK,
  type GeoOptions,
} from "@/lib/order-checkout-geo";
import { useBusinessStore } from "@/stores/business";
import { describeError } from "@/lib/error-report";
import { FULFILMENT_OPTIONS } from "./constants";
import { usePreviewAmendment, useAmendOrder } from "./hooks";
import type {
  SalesOrder,
  FulfilmentType,
  AmendmentLineInput,
  AmendmentPreview,
  AmendmentPreviewInput,
  AmendmentReasonCategory,
  AmendmentWarning,
  DeliveryAddress,
} from "./types";

/** A row in the editable cart. `line_id` marks a line that already exists. */
interface EditLine {
  key: string;
  line_id?: string;
  variant_id?: string;
  service_offering_id?: string;
  styled_id?: string;
  line_kind?: "product" | "styled" | "bundle" | "service";
  name: string;
  variant_label?: string | null;
  sku?: string | null;
  quantity: number;
  unit_price: number;
  image_url?: string | null;
}

const REASON_OPTIONS: { value: AmendmentReasonCategory; label: string }[] = [
  { value: "wrong_item", label: "We recorded the wrong product" },
  { value: "customer_change", label: "Customer changed her mind" },
  { value: "stock_substitution", label: "Substituting for stock reasons" },
  { value: "price_correction", label: "Price correction" },
  { value: "delivery_change", label: "Delivery details only" },
  { value: "other", label: "Other" },
];

const ngn = (v: number | string) =>
  `₦${Number(v || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

function lineFromOrder(l: NonNullable<SalesOrder["lines"]>[number]): EditLine {
  return {
    key: l.line_id,
    line_id: l.line_id,
    variant_id: l.variant_id || undefined,
    service_offering_id: l.service_offering_id || undefined,
    styled_id: l.styled_id || undefined,
    line_kind: (l.line_kind as EditLine["line_kind"]) || undefined,
    name: l.product_name_snapshot,
    variant_label: l.variant_label_snapshot,
    sku: l.sku_snapshot,
    quantity: Number(l.quantity),
    unit_price: Number(l.unit_price_ngn),
  };
}

function lineFromResolved(r: ResolvedLine): EditLine {
  return {
    key: crypto.randomUUID(),
    variant_id: r.variant_id || undefined,
    service_offering_id: r.service_offering_id,
    styled_id: r.styled_id,
    line_kind: r.service_offering_id
      ? "service"
      : r.styled_id
        ? "styled"
        : "product",
    name: r.product_name_snapshot ?? r.label,
    variant_label: r.variant_label_snapshot ?? null,
    sku: r.sku,
    quantity: r.quantity,
    unit_price: r.unit_price,
    image_url: r.image_url,
  };
}

export function ChangeOrderModal({
  order,
  open,
  onClose,
  onSaved,
}: {
  order: SalesOrder;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const activeBiz = useBusinessStore((s) => s.activeKey);
  const preview = usePreviewAmendment(order.order_id);
  const amend = useAmendOrder(order.order_id);

  // ── Cart ──────────────────────────────────────────────────
  const [lines, setLines] = useState<EditLine[]>(() =>
    (order.lines ?? []).map(lineFromOrder),
  );
  const [pendingStyled, setPendingStyled] = useState<ProductHit | null>(null);

  // ── Delivery ──────────────────────────────────────────────
  const snapshot: DeliveryAddress = order.delivery_address_snapshot ?? {};
  const [fulfilment, setFulfilment] = useState<FulfilmentType>(
    order.order_type,
  );
  const [geo, setGeo] = useState<GeoOptions>(GEO_FALLBACK);
  const [line1, setLine1] = useState(snapshot.line1 ?? "");
  const [line2, setLine2] = useState(snapshot.line2 ?? "");
  const [city, setCity] = useState(snapshot.city ?? "");
  const [addrState, setAddrState] = useState(snapshot.state ?? "");
  const [country, setCountry] = useState(snapshot.country ?? "Nigeria");
  const [countryCode, setCountryCode] = useState(snapshot.country_code ?? "NG");
  const [zoneCode, setZoneCode] = useState(snapshot.zone_code ?? "");
  const [recipientName, setRecipientName] = useState(
    snapshot.recipient_name ?? order.contact_name ?? "",
  );
  const [recipientPhone, setRecipientPhone] = useState(
    snapshot.recipient_phone ?? order.contact_phone ?? "",
  );
  const [shippingFee, setShippingFee] = useState(
    String(order.shipping_fee_ngn ?? "0"),
  );
  const [systemFee, setSystemFee] = useState<number | null>(null);
  const [quotingFee, setQuotingFee] = useState(false);
  const [addressEdited, setAddressEdited] = useState(false);

  // ── Why ───────────────────────────────────────────────────
  const [reason, setReason] = useState("");
  const [reasonCategory, setReasonCategory] =
    useState<AmendmentReasonCategory>("wrong_item");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [plan, setPlan] = useState<AmendmentPreview | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  // ── Payload ───────────────────────────────────────────────
  const addressPayload = useMemo<DeliveryAddress | undefined>(() => {
    if (!addressEdited) return undefined;
    return {
      line1,
      line2: line2 || null,
      city,
      state: addrState,
      country,
      country_code: countryCode,
      zone_code: zoneCode || undefined,
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
    };
  }, [
    addressEdited,
    line1,
    line2,
    city,
    addrState,
    country,
    countryCode,
    zoneCode,
    recipientName,
    recipientPhone,
  ]);

  const payload = useMemo<AmendmentPreviewInput>(() => {
    const mapped: AmendmentLineInput[] = lines.map((l) =>
      l.line_id
        ? {
            line_id: l.line_id,
            quantity: l.quantity,
            unit_price_ngn: l.unit_price,
          }
        : l.service_offering_id
          ? {
              service_offering_id: l.service_offering_id,
              line_kind: "service" as const,
              quantity: l.quantity,
              unit_price_ngn: l.unit_price,
            }
          : {
              variant_id: l.variant_id,
              quantity: l.quantity,
              unit_price_ngn: l.unit_price,
              product_name_snapshot: l.name,
              variant_label_snapshot: l.variant_label ?? undefined,
              sku_snapshot: l.sku ?? undefined,
              ...(l.styled_id
                ? { styled_id: l.styled_id, line_kind: "styled" as const }
                : {}),
            },
    );
    return {
      lines: mapped,
      shipping_fee_ngn: Number(shippingFee) || 0,
      order_type: fulfilment,
      delivery_address: addressPayload,
    };
  }, [lines, shippingFee, fulfilment, addressPayload]);

  // ── Live dry run ──────────────────────────────────────────
  // Debounced so a quantity spinner doesn't fire a request per click, and
  // sequence-guarded so a slow earlier response can't overwrite a newer one.
  const seqRef = useRef(0);
  const runPreview = useCallback(() => {
    if (!lines.length) {
      setPlan(null);
      setPlanError("An order needs at least one item.");
      return;
    }
    const seq = ++seqRef.current;
    preview
      .mutateAsync(payload)
      .then((res) => {
        if (seq !== seqRef.current) return;
        setPlan(res);
        setPlanError(null);
      })
      .catch((err) => {
        if (seq !== seqRef.current) return;
        setPlan(null);
        setPlanError(describeError(err).message);
      });
    // preview.mutateAsync is stable for the life of the mutation object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, lines.length]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(runPreview, 350);
    return () => clearTimeout(t);
  }, [open, runPreview]);

  // Any edit invalidates a previous acknowledgement — the operator must
  // re-read consequences that may now be different.
  useEffect(() => setAcknowledged(false), [payload]);

  // ── Delivery-zone rate (the same engine every checkout prices from) ──
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
  const totalQty = useMemo(
    () => Math.max(1, lines.reduce((s, l) => s + l.quantity, 0)),
    [lines],
  );
  const effectiveZone = isNigeria
    ? zoneCode ||
      (isLagos
        ? (geo.lagos_lgas.find((o) => norm(o.name) === norm(city))?.code ?? "")
        : (geo.nigeria_states.find((o) => norm(o.name) === norm(addrState))
            ?.code ?? ""))
    : countryCode ||
      (geo.countries.find((o) => norm(o.name) === norm(country))?.code ?? "");

  useEffect(() => {
    if (fulfilment !== "dispatch" || !effectiveZone || !addressEdited) {
      setSystemFee(null);
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
        if (q?.fee_ngn != null) {
          setSystemFee(q.fee_ngn);
          setShippingFee(String(q.fee_ngn));
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
  }, [fulfilment, effectiveZone, totalQty, activeBiz, addressEdited]);

  const touchAddress = () => setAddressEdited(true);

  // ── Cart edits ────────────────────────────────────────────
  const addResolved = (resolved: ResolvedLine[]) =>
    setLines((prev) => [...prev, ...resolved.map(lineFromResolved)]);

  const handlePick = async (hit: ProductHit) => {
    if (hit.kind === "styled") {
      setPendingStyled(hit);
      return;
    }
    try {
      const { lines: resolved } = await resolvePick(hit);
      if (!resolved.length) {
        setPlanError("That product has no active variant to sell.");
        return;
      }
      addResolved(resolved);
    } catch (err) {
      setPlanError(describeError(err).message);
    }
  };

  const handleStyledPick = async (pick: StyledPick) => {
    const hit = pendingStyled;
    setPendingStyled(null);
    if (!hit) return;
    try {
      const { lines: resolved } = await resolveStyledPick(hit, pick);
      if (!resolved.length) {
        setPlanError("That styled product has no sellable variant.");
        return;
      }
      addResolved(resolved);
    } catch (err) {
      setPlanError(describeError(err).message);
    }
  };

  const removeLine = (key: string) =>
    setLines((prev) => prev.filter((l) => l.key !== key));
  const setQty = (key: string, qty: number) =>
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, qty) } : l)),
    );
  const setPrice = (key: string, price: number) =>
    setLines((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, unit_price: Math.max(0, price) } : l,
      ),
    );

  // ── Commit ────────────────────────────────────────────────
  const warnings: AmendmentWarning[] = plan?.warnings ?? [];
  const needsAck = warnings.length > 0;
  const canSave =
    !!plan &&
    plan.changed &&
    lines.length > 0 &&
    reason.trim().length >= 3 &&
    (!needsAck || acknowledged) &&
    !amend.isPending;

  const handleSave = async () => {
    setSubmitError(null);
    try {
      const res = await amend.mutateAsync({
        ...payload,
        reason: reason.trim(),
        reason_category: reasonCategory,
        notify_customer: notifyCustomer,
        // Only the operator's actual tick — never a blanket true. If the order
        // moved on while this modal was open and the server now finds a
        // consequence the preview didn't show, it answers requires_confirmation
        // instead of committing, and the branch below re-presents it.
        acknowledge_warnings: acknowledged,
      });
      if (res.requires_confirmation) {
        // The server found a consequence the preview hadn't surfaced (the order
        // moved on while the modal was open). Show it and make them look again.
        setPlan((p) =>
          p ? { ...p, warnings: res.warnings ?? p.warnings } : p,
        );
        setAcknowledged(false);
        setSubmitError(
          "This order changed while you were editing it — read the updated warnings and confirm again.",
        );
        return;
      }
      const diff = Number(res.difference_ngn ?? 0);
      // The reconciler walks the same adjacency fallback the sale did, so the
      // size that was out of stock may well have been filled from the sibling
      // one away. Say so now — the alternative is the operator (or the Studio)
      // meeting it for the first time on the picklist.
      const substituted = res.stock?.substituted?.length ?? 0;
      const resizeNote = substituted
        ? ` ${substituted === 1 ? "One item" : `${substituted} items`} will be resized from a size-adjacent base in stock — the picklist carries the instruction.`
        : "";
      onSaved(
        (diff > 0
          ? `Order updated. ${ngn(diff)} more is now due — the customer has been sent the balance.`
          : diff < 0
            ? `Order updated. ${ngn(Math.abs(diff))} is now in credit on this order.`
            : "Order updated.") + resizeNote,
      );
      onClose();
    } catch (err) {
      setSubmitError(describeError(err).message);
    }
  };

  const difference = Number(plan?.difference_ngn ?? 0);
  const balanceAfter = Number(plan?.balance_after_ngn ?? 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Change order ${order.order_number}`}
      footer={
        <>
          <div className="mr-auto text-[12px] text-text-faint">
            {preview.isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Working out the difference…
              </span>
            ) : plan && !plan.changed ? (
              "Nothing has changed yet."
            ) : plan ? (
              <span>
                New total <strong>{ngn(plan.after.total_ngn)}</strong>
                {difference !== 0 && (
                  <>
                    {" · "}
                    <span
                      className={
                        difference > 0 ? "text-warn" : "text-success"
                      }
                    >
                      {difference > 0 ? "+" : "−"}
                      {ngn(Math.abs(difference))}
                    </span>
                  </>
                )}
              </span>
            ) : null}
          </div>
          <Button variant="ghost" onClick={onClose} disabled={amend.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave}>
            {amend.isPending ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* ── Items ── */}
        <section>
          <div className="micro mb-2">Items</div>
          <ProductPicker onPick={handlePick} />

          {pendingStyled && (
            <div className="mt-3">
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
            </div>
          )}

          <div className="mt-3 space-y-2">
            {lines.map((l) => (
              <div
                key={l.key}
                className="flex flex-wrap items-center gap-3 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line"
              >
                <div className="w-10 h-10 shrink-0 rounded-[8px] overflow-hidden bg-text-primary/[0.06]">
                  {l.image_url && (
                    <img
                      src={l.image_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-[140px]">
                  <div className="text-[13px] font-semibold truncate">
                    {l.name}
                  </div>
                  <div className="text-[11px] text-text-faint truncate">
                    {[l.variant_label, l.sku].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {!l.line_id && (
                    <Pill tone="accent">New</Pill>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    onClick={() => setQty(l.key, l.quantity - 1)}
                    className="w-7 h-7 rounded-lg bg-text-primary/[0.06] grid place-items-center text-[13px] font-bold"
                  >
                    −
                  </button>
                  <span className="w-8 text-center tabular-nums text-[13px]">
                    {l.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    onClick={() => setQty(l.key, l.quantity + 1)}
                    className="w-7 h-7 rounded-lg bg-text-primary/[0.06] grid place-items-center text-[13px] font-bold"
                  >
                    +
                  </button>
                </div>
                <div className="w-[130px]">
                  <NumberField
                    value={String(l.unit_price)}
                    onChange={(v) => setPrice(l.key, Number(v) || 0)}
                    suffix="NGN"
                  />
                </div>
                <MoneyText
                  ngn={l.unit_price * l.quantity}
                  className="text-[14px] w-24 text-right"
                />
                <button
                  type="button"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => removeLine(l.key)}
                  className="text-text-faint hover:text-danger transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {!lines.length && (
              <p className="text-[12px] text-danger">
                An order needs at least one item. Add the replacement product
                above.
              </p>
            )}
          </div>
        </section>

        {/* ── Delivery ── */}
        <section>
          <div className="micro mb-2">Delivery</div>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Country">
                <GeoComboBox
                  options={geo.countries}
                  value={country}
                  onChange={(name) => {
                    touchAddress();
                    setCountry(name);
                    setCountryCode("");
                    setZoneCode("");
                  }}
                  onSelect={(item) => {
                    touchAddress();
                    setCountry(item.name);
                    setCountryCode(item.code);
                    setAddrState("");
                    setCity("");
                    setZoneCode(item.code === "NG" ? "" : item.code);
                  }}
                  placeholder="Start typing the country…"
                />
              </Field>
              {isNigeria ? (
                <Field label="State">
                  <GeoComboBox
                    options={geo.nigeria_states}
                    value={addrState}
                    onChange={(name) => {
                      touchAddress();
                      setAddrState(name);
                      setZoneCode("");
                    }}
                    onSelect={(item) => {
                      touchAddress();
                      setAddrState(item.name);
                      setCity("");
                      setZoneCode(item.name === "Lagos" ? "" : item.code);
                    }}
                    placeholder="Select the state…"
                  />
                </Field>
              ) : (
                <Field label="State / Province">
                  <TextInput
                    value={addrState}
                    onChange={(e) => {
                      touchAddress();
                      setAddrState(e.target.value);
                    }}
                  />
                </Field>
              )}
              {isLagos ? (
                <Field label="City / LGA">
                  <GeoComboBox
                    options={geo.lagos_lgas}
                    value={city}
                    onChange={(name) => {
                      touchAddress();
                      setCity(name);
                      setZoneCode("");
                    }}
                    onSelect={(item) => {
                      touchAddress();
                      setCity(item.name);
                      setZoneCode(item.code);
                    }}
                    placeholder="Select the LGA…"
                  />
                </Field>
              ) : (
                <Field label="City">
                  <TextInput
                    value={city}
                    onChange={(e) => {
                      touchAddress();
                      setCity(e.target.value);
                    }}
                  />
                </Field>
              )}
              <Field label="Address line 1">
                <TextInput
                  value={line1}
                  onChange={(e) => {
                    touchAddress();
                    setLine1(e.target.value);
                  }}
                  placeholder="House number and street"
                />
              </Field>
              <Field label="Address line 2" hint="optional">
                <TextInput
                  value={line2}
                  onChange={(e) => {
                    touchAddress();
                    setLine2(e.target.value);
                  }}
                />
              </Field>
              <Field label="Recipient name">
                <TextInput
                  value={recipientName}
                  onChange={(e) => {
                    touchAddress();
                    setRecipientName(e.target.value);
                  }}
                />
              </Field>
              <Field label="Recipient phone">
                <TextInput
                  value={recipientPhone}
                  onChange={(e) => {
                    touchAddress();
                    setRecipientPhone(e.target.value);
                  }}
                />
              </Field>
              <Field
                label="Delivery fee (NGN)"
                hint={
                  quotingFee
                    ? "checking the rate…"
                    : systemFee != null
                      ? `system rate ${ngn(systemFee)}`
                      : undefined
                }
              >
                <NumberField
                  value={shippingFee}
                  onChange={setShippingFee}
                  suffix="NGN"
                />
              </Field>
            </div>
          )}
          {fulfilment !== "dispatch" && (
            <Field label="Delivery fee (NGN)">
              <NumberField
                value={shippingFee}
                onChange={setShippingFee}
                suffix="NGN"
              />
            </Field>
          )}
        </section>

        {/* ── What this will do ── */}
        <section>
          <div className="micro mb-2">What this will do</div>
          {planError && (
            <div className="p-3 rounded-[11px] border border-danger/30 bg-danger/[0.06] text-[12.5px] text-danger">
              {planError}
            </div>
          )}
          {!planError && plan && (
            <div className="space-y-3">
              <div className="rounded-[11px] border border-line bg-text-primary/[0.02] p-3">
                {plan.line_changes.length === 0 && !plan.delivery_changed ? (
                  <p className="text-[12.5px] text-text-muted">
                    No changes yet.
                  </p>
                ) : (
                  <ul className="space-y-1.5 text-[12.5px]">
                    {plan.line_changes.map((c, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Pill
                          tone={
                            c.action === "added"
                              ? "success"
                              : c.action === "removed"
                                ? "danger"
                                : "info"
                          }
                        >
                          {c.action}
                        </Pill>
                        <span className="min-w-0">
                          {c.name}
                          {c.action === "quantity" && (
                            <span className="text-text-muted">
                              {" "}
                              ({c.from} → {c.to})
                            </span>
                          )}
                          {c.action === "price" && (
                            <span className="text-text-muted">
                              {" "}
                              ({ngn(c.from ?? 0)} → {ngn(c.to ?? 0)})
                            </span>
                          )}
                          {(c.action === "added" || c.action === "removed") && (
                            <span className="text-text-muted">
                              {" "}
                              ×{c.quantity}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                    {plan.delivery_changed && (
                      <li className="flex items-start gap-2">
                        <Pill tone="info">delivery</Pill>
                        <span>Delivery details updated.</span>
                      </li>
                    )}
                  </ul>
                )}
              </div>

              {/* Money, before → after */}
              <div className="rounded-[11px] border border-line p-3 grid grid-cols-3 gap-3 text-[13px]">
                <div>
                  <div className="micro">Was</div>
                  <MoneyText
                    ngn={Number(plan.before.total_ngn)}
                    className="text-[16px]"
                  />
                </div>
                <div className="grid place-items-center">
                  <ArrowRight className="w-4 h-4 text-text-faint" />
                </div>
                <div className="text-right">
                  <div className="micro">Now</div>
                  <MoneyText
                    ngn={Number(plan.after.total_ngn)}
                    className="text-[16px]"
                  />
                </div>
                <div className="col-span-3 border-t border-line pt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-text-muted">
                    Already paid {ngn(plan.amount_paid_ngn)}
                  </span>
                  {balanceAfter > 0 ? (
                    <Pill tone="warn">
                      {ngn(balanceAfter)} still to collect
                    </Pill>
                  ) : balanceAfter < 0 ? (
                    <Pill tone="info">
                      {ngn(Math.abs(balanceAfter))} credit due to the customer
                    </Pill>
                  ) : (
                    <Pill tone="success">Fully paid</Pill>
                  )}
                </div>
              </div>

              {/* Consequences */}
              {warnings.length > 0 && (
                <div className="rounded-[11px] border border-warn/30 bg-warn/[0.06] p-3">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-warn mb-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Read this before you save
                  </div>
                  <ul className="space-y-1.5 text-[12.5px] list-disc pl-4">
                    {warnings.map((w) => (
                      <li key={w.code}>{w.message}</li>
                    ))}
                  </ul>
                  <label className="mt-3 flex items-start gap-2 text-[12.5px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                      className="mt-0.5 accent-[var(--accent)]"
                    />
                    <span>
                      I&rsquo;ve read the above and want to make this change.
                    </span>
                  </label>
                </div>
              )}

              {!plan.revenue_recognised && (
                <p className="text-[12px] text-text-faint inline-flex items-start gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  This order hasn&rsquo;t been settled yet, so nothing has been
                  posted to the books — the change simply moves the stock hold
                  and updates the proforma invoice.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ── Why ── */}
        <section>
          <div className="micro mb-2">Why are you changing it?</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Reason">
              <Select
                value={reasonCategory}
                onChange={(v) => setReasonCategory(v as AmendmentReasonCategory)}
                options={REASON_OPTIONS}
              />
            </Field>
            <Field label="Notify the customer">
              <Toggle
                checked={notifyCustomer}
                onChange={setNotifyCustomer}
                label={
                  notifyCustomer
                    ? "Send her the change + the new balance"
                    : "Don't send anything (you're handling it yourself)"
                }
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field
              label="Notes"
              hint="required — this is what the audit trail will say"
            >
              <TextArea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="e.g. We recorded the Classic Frontal by mistake; she ordered the Styled Bodywave Copper."
              />
            </Field>
          </div>
          {submitError && (
            <p className="mt-2 text-[12px] text-danger">{submitError}</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
