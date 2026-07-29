/**
 * Production run drawers — open a run, put products and money on it, and
 * receive the finished units.
 *
 * The module is worked by two very different people. The CEO in Lagos needs
 * the landed cost that prices every product. The factory manager in China
 * needs to say what is being made and what the factory is charging, in CNY,
 * in Chinese — and must never see the Naira cost basis. So every screen here
 * is translated end-to-end, and every NGN figure is rendered only when the
 * server actually sent it (it strips those columns for roles that may not see
 * cost — `cost_redacted`).
 *
 * Cost reaches a run by exactly two routes:
 *   1. PRODUCT LINES — qty × unit cost per product, rolled into one
 *      `factory_unit_cost` component. This is what the factory invoices.
 *   2. RUN-LEVEL COSTS — freight, customs, 3PL, packaging, wastage. Not known
 *      on day one and not attributable to a single product.
 * Both append to `cost_components`; a DB trigger rolls them into the run and
 * the server re-snapshots per-unit landed cost on every write.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Coins,
  ListPlus,
  Package,
  PackageCheck,
  Plus,
  Trash2,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, MoneyText, Pill } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Form";
import { NumberField, Select } from "@/components/ui/controls";
import { ProductPicker } from "@/components/catalogue/ProductPicker";
import { resolvePick, type ProductHit } from "@/lib/product-search";
import { useStockLocations } from "@/pages/stock/hooks";
import { usePos } from "@/pages/purchasing/hooks";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import {
  useAddCostComponent,
  useAddProducts,
  useAdvanceProductionRun,
  useCreateProductionRun,
  useFxRate,
  useProductionRun,
  useReceiveProduction,
} from "./hooks";
import {
  COST_TYPE_META,
  MANUAL_COST_TYPES,
  RUN_CURRENCIES,
  RUN_STATUS_FLOW,
  RUN_STATUS_META,
} from "./constants";
import type { CostType, ProductionRun, RunUnitGroup } from "./types";

// ── Shared bits ───────────────────────────────────────────

/** A product line as the form holds it — strings, because they're inputs. */
interface LineDraft {
  variant_id: string;
  label: string;
  sku: string;
  qty: string;
  unit_cost: string;
}

const EMPTY_LINE: LineDraft = {
  variant_id: "",
  label: "",
  sku: "",
  qty: "1",
  unit_cost: "",
};

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Money in the factory's own currency — never NGN, so never MoneyText. */
function ForeignAmount({
  amount,
  currency,
  className,
}: {
  amount: number;
  currency: string;
  className?: string;
}) {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {currency}{" "}
      {amount.toLocaleString("en", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
    </span>
  );
}

/**
 * The live "…= ₦X" line under a foreign amount. Shown only to roles that may
 * see NGN — for a factory manager the conversion is exactly the number we're
 * hiding, so it renders nothing at all.
 */
function NgnPreview({
  amount,
  currency,
  rate,
  loading,
}: {
  amount: number;
  currency: string;
  rate: number | null | undefined;
  loading?: boolean;
}) {
  const { t } = useTranslation("factory");
  const canSeeCost = !useAuthStore((s) => s.user)?.isFactoryManager;
  if (!canSeeCost || currency === "NGN" || amount <= 0) return null;
  if (loading)
    return (
      <div className="text-[11px] text-text-faint mt-1">{t("fxLoading")}</div>
    );
  if (!rate)
    return (
      <div className="text-[11px] text-warn mt-1 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        {t("fxMissing", { currency })}
      </div>
    );
  return (
    <div className="text-[11px] text-text-muted mt-1">
      {t("fxPreview", { rate: rate.toLocaleString("en") })} ={" "}
      <MoneyText ngn={amount * rate} className="text-[11px]" />
    </div>
  );
}

/**
 * Product-line editor shared by "new run" and "add products". Each line is one
 * product; quantity becomes that many individually-coded production units.
 */
function LineEditor({
  lines,
  setLines,
  currency,
}: {
  lines: LineDraft[];
  setLines: React.Dispatch<React.SetStateAction<LineDraft[]>>;
  currency: string;
}) {
  const { t } = useTranslation("factory");
  const [bulkOpen, setBulkOpen] = useState(false);

  const setField = (i: number, k: keyof LineDraft, v: string) =>
    setLines((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const removeLine = (i: number) =>
    setLines((p) => p.filter((_, j) => j !== i));

  /** Resolve a pick to its first sellable variant — that variant_id is what
   *  makes the finished unit receivable into stock later. */
  const draftFromHit = async (hit: ProductHit): Promise<LineDraft | null> => {
    try {
      const { lines: resolved } = await resolvePick(hit);
      const first = resolved.find((l) => l.variant_id);
      if (!first) return null;
      return {
        variant_id: first.variant_id,
        label: first.label || hit.label,
        sku: first.sku,
        qty: "1",
        unit_cost: "",
      };
    } catch {
      return null;
    }
  };

  const addFromHits = async (hits: ProductHit[]) => {
    const drafts = (await Promise.all(hits.map(draftFromHit))).filter(
      (d): d is LineDraft => d !== null,
    );
    if (!drafts.length) return;
    // Drop the untouched placeholder so ticking 12 products gives 12 lines.
    setLines((p) => {
      const kept = p.filter((l) => l.variant_id || num(l.unit_cost) > 0);
      return [...kept, ...drafts];
    });
    setBulkOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {/* `n`, not `count` — i18next reserves `count` for plural resolution,
            which would look for lineCount_one/_other keys that don't exist. */}
        <span className="text-[13px] text-text-muted">
          {t("lineCount", { n: lines.length })}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={bulkOpen ? "primary" : "ghost"}
            icon={<ListPlus className="w-3.5 h-3.5" />}
            onClick={() => setBulkOpen((v) => !v)}
          >
            {t("bulkAdd")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setLines((p) => [...p, { ...EMPTY_LINE }])}
          >
            {t("addLine")}
          </Button>
        </div>
      </div>

      {bulkOpen && (
        <div className="glass rounded-xl p-4 space-y-2.5">
          <p className="text-[12px] text-text-muted">{t("bulkAddHint")}</p>
          <ProductPicker
            multi
            autoFocus
            addLabel={`${t("addLine")} ·`}
            onPickMany={(hits) => void addFromHits(hits)}
          />
        </div>
      )}

      {lines.map((line, i) => (
        <div key={i} className="glass rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-start gap-2">
            <span className="text-[11px] font-bold text-text-faint uppercase tracking-wide">
              {t("lineN", { n: i + 1 })}
            </span>
            {lines.length > 1 && (
              <button
                onClick={() => removeLine(i)}
                aria-label={t("removeLine")}
                className="text-danger hover:bg-danger/10 px-2 py-0.5 rounded"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <Field label={t("product")}>
            {line.variant_id ? (
              <div className="flex items-center justify-between gap-2 min-h-[38px] px-[11px] py-1.5 rounded-[10px] bg-accent/[0.07] border border-accent/30">
                <span className="text-[13px] text-text-primary truncate">
                  {line.label}
                  {line.sku && (
                    <span className="text-text-faint font-mono ml-1.5 text-[11px]">
                      {line.sku}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => {
                    setField(i, "variant_id", "");
                    setField(i, "label", "");
                    setField(i, "sku", "");
                  }}
                  className="text-[11px] text-text-muted hover:text-danger shrink-0"
                >
                  {t("change")}
                </button>
              </div>
            ) : (
              <ProductPicker
                onPick={(hit) => {
                  void draftFromHit(hit).then((d) => {
                    if (!d) return;
                    setLines((p) =>
                      p.map((l, j) =>
                        j === i
                          ? {
                              ...l,
                              variant_id: d.variant_id,
                              label: d.label,
                              sku: d.sku,
                            }
                          : l,
                      ),
                    );
                  });
                }}
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t("quantity")}>
              <NumberField
                value={line.qty}
                onChange={(v) => setField(i, "qty", v)}
                allowDecimal={false}
                placeholder="1"
              />
            </Field>
            <Field label={t("unitCostIn", { currency })}>
              <NumberField
                value={line.unit_cost}
                onChange={(v) => setField(i, "unit_cost", v)}
                placeholder="0.00"
              />
            </Field>
          </div>

          {num(line.unit_cost) > 0 && num(line.qty) > 0 && (
            <div className="text-[12px] text-text-muted text-right">
              {t("lineTotal")}{" "}
              <ForeignAmount
                amount={num(line.qty) * num(line.unit_cost)}
                currency={currency}
                className="text-text-primary font-semibold"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Create run ────────────────────────────────────────────

export function CreateRunDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("factory");
  const create = useCreateProductionRun();
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [poId, setPoId] = useState("");
  const [arrival, setArrival] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);

  // Only approved-and-later POs are worth producing against; a draft PO has
  // not been committed to the supplier yet.
  const pos = usePos({ status: "approved" });
  const fx = useFxRate(currency);

  const reset = () => {
    setStep(1);
    setTitle("");
    setCurrency("CNY");
    setPoId("");
    setArrival("");
    setNotes("");
    setLines([{ ...EMPTY_LINE }]);
  };
  const close = () => {
    reset();
    onClose();
  };

  const priced = lines.filter((l) => num(l.qty) > 0);
  const totalUnits = priced.reduce((s, l) => s + num(l.qty), 0);
  const totalCost = priced.reduce(
    (s, l) => s + num(l.qty) * num(l.unit_cost),
    0,
  );
  // A PO import brings its own lines, so the product step is optional then.
  const canSubmit = !!title && (totalUnits > 0 || !!poId);

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      {
        title,
        currency,
        po_id: poId || undefined,
        expected_arrival_date: arrival || undefined,
        notes: notes || undefined,
        lines: priced.length
          ? priced.map((l) => ({
              variant_id: l.variant_id || undefined,
              quantity: num(l.qty),
              unit_cost: num(l.unit_cost) || undefined,
            }))
          : undefined,
      },
      { onSuccess: close },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      wide
      title={t("newRun")}
      subtitle={
        <span className="text-[12px] text-text-muted">
          {t("stepOf", { step, total: 2 })}
        </span>
      }
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => (step === 1 ? close() : setStep(1))}
          >
            {step === 1 ? t("cancel") : t("back")}
          </Button>
          {step === 1 ? (
            <Button
              variant="primary"
              disabled={!title}
              onClick={() => setStep(2)}
            >
              {t("next")}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={create.isPending || !canSubmit}
              onClick={submit}
            >
              {create.isPending ? t("creating") : t("createRun")}
            </Button>
          )}
        </>
      }
    >
      {step === 1 && (
        <div className="space-y-4">
          <Field label={t("runTitle")}>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("runTitlePlaceholder")}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
              autoFocus
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore=""
              data-form-type="other"
            />
          </Field>

          <Field label={t("factoryCurrency")} hint={t("factoryCurrencyHint")}>
            <Select
              value={currency}
              onChange={setCurrency}
              ariaLabel={t("factoryCurrency")}
              options={RUN_CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>

          <Field label={t("fromPo")} hint={t("fromPoHint")}>
            <Select
              value={poId}
              onChange={setPoId}
              ariaLabel={t("fromPo")}
              options={[
                { value: "", label: t("noPo") },
                ...(pos.data?.data ?? []).map((p) => ({
                  value: p.po_id,
                  label: [p.po_number, p.supplier_name]
                    .filter(Boolean)
                    .join(" — "),
                })),
              ]}
            />
          </Field>

          <Field label={t("expectedArrival")}>
            <input
              type="date"
              value={arrival}
              onChange={(e) => setArrival(e.target.value)}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
            />
          </Field>

          <Field label={t("notes")}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t("notesPlaceholder")}
              className="w-full px-[13px] py-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px] resize-none"
            />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {poId && (
            <div className="glass rounded-xl p-3 text-[12px] text-text-muted">
              {t("poLinesHint")}
            </div>
          )}
          <LineEditor lines={lines} setLines={setLines} currency={currency} />

          {totalUnits > 0 && (
            <Card className="p-4 space-y-1.5">
              <div className="flex justify-between text-[13px]">
                <span className="text-text-muted">{t("unitsPlanned")}</span>
                <span className="font-mono font-semibold">{totalUnits}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-text-muted">{t("factoryCharge")}</span>
                <ForeignAmount
                  amount={totalCost}
                  currency={currency}
                  className="font-semibold"
                />
              </div>
              <NgnPreview
                amount={totalCost}
                currency={currency}
                rate={fx.data?.rate}
                loading={fx.isLoading}
              />
              <p className="text-[11px] text-text-faint pt-1.5 border-t hairline mt-2">
                {t("otherCostsHint")}
              </p>
            </Card>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ── Add products to an existing run ───────────────────────

function AddProductsDrawer({
  run,
  open,
  onClose,
}: {
  run: ProductionRun;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("factory");
  const add = useAddProducts(run.run_id);
  const [currency, setCurrency] = useState(run.funding_currency || "CNY");
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);
  const fx = useFxRate(currency);

  const priced = lines.filter((l) => num(l.qty) > 0);
  const totalCost = priced.reduce(
    (s, l) => s + num(l.qty) * num(l.unit_cost),
    0,
  );

  const submit = () => {
    if (!priced.length) return;
    add.mutate(
      {
        currency,
        lines: priced.map((l) => ({
          variant_id: l.variant_id || undefined,
          quantity: num(l.qty),
          unit_cost: num(l.unit_cost) || undefined,
        })),
      },
      {
        onSuccess: () => {
          setLines([{ ...EMPTY_LINE }]);
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide
      title={t("addProducts")}
      subtitle={<span className="font-mono text-[12px]">{run.run_number}</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={add.isPending || !priced.length}
            onClick={submit}
          >
            {add.isPending ? t("saving") : t("addProducts")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("factoryCurrency")}>
          <Select
            value={currency}
            onChange={setCurrency}
            ariaLabel={t("factoryCurrency")}
            options={RUN_CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
        </Field>
        <LineEditor lines={lines} setLines={setLines} currency={currency} />
        {totalCost > 0 && (
          <Card className="p-4">
            <div className="flex justify-between text-[13px]">
              <span className="text-text-muted">{t("factoryCharge")}</span>
              <ForeignAmount
                amount={totalCost}
                currency={currency}
                className="font-semibold"
              />
            </div>
            <NgnPreview
              amount={totalCost}
              currency={currency}
              rate={fx.data?.rate}
              loading={fx.isLoading}
            />
          </Card>
        )}
      </div>
    </Drawer>
  );
}

// ── Add a run-level cost ──────────────────────────────────

function AddCostDrawer({
  run,
  open,
  onClose,
}: {
  run: ProductionRun;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("factory");
  const add = useAddCostComponent(run.run_id);
  const [costType, setCostType] = useState<CostType>("freight_international");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(run.funding_currency || "CNY");
  const [rateOverride, setRateOverride] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [incurredAt, setIncurredAt] = useState("");

  const fx = useFxRate(currency);
  // The system rate pre-fills; the operator overrides it when they converted
  // at a different rate, which is common for cash bought outside a bank.
  const effectiveRate =
    num(rateOverride) > 0 ? num(rateOverride) : (fx.data?.rate ?? null);

  useEffect(() => {
    if (open) setRateOverride("");
  }, [open, currency]);

  const submit = () => {
    if (num(amount) <= 0) return;
    add.mutate(
      {
        cost_type: costType,
        amount: num(amount),
        currency,
        fx_rate_used: num(rateOverride) > 0 ? num(rateOverride) : undefined,
        invoice_reference: reference || undefined,
        description: description || undefined,
        incurred_at: incurredAt || undefined,
      },
      {
        onSuccess: () => {
          setAmount("");
          setReference("");
          setDescription("");
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("addCost")}
      subtitle={<span className="font-mono text-[12px]">{run.run_number}</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={add.isPending || num(amount) <= 0}
            onClick={submit}
          >
            {add.isPending ? t("saving") : t("addCost")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("costTypeLabel")}>
          <Select
            value={costType}
            onChange={(v) => setCostType(v as CostType)}
            ariaLabel={t("costTypeLabel")}
            options={MANUAL_COST_TYPES.map((k) => ({
              value: k,
              label: t(COST_TYPE_META[k].i18nKey),
            }))}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("amount")}>
            <NumberField
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
            />
          </Field>
          <Field label={t("currency")}>
            <Select
              value={currency}
              onChange={setCurrency}
              ariaLabel={t("currency")}
              options={RUN_CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
        </div>

        {currency !== "NGN" && (
          <Field label={t("fxRate")} hint={t("fxRateHint")}>
            <NumberField
              value={rateOverride}
              onChange={setRateOverride}
              placeholder={
                fx.data?.rate != null ? String(fx.data.rate) : t("fxNoRate")
              }
            />
          </Field>
        )}

        <NgnPreview
          amount={num(amount)}
          currency={currency}
          rate={effectiveRate}
          loading={fx.isLoading}
        />

        <Field label={t("invoiceReference")}>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t("invoiceReferencePlaceholder")}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
            autoComplete="off"
          />
        </Field>

        <Field label={t("description")}>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("costDescriptionPlaceholder")}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
            autoComplete="off"
          />
        </Field>

        <Field label={t("incurredAt")}>
          <input
            type="date"
            value={incurredAt}
            onChange={(e) => setIncurredAt(e.target.value)}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
          />
        </Field>
      </div>
    </Drawer>
  );
}

// ── Receive finished units into stock ─────────────────────

function ReceiveDrawer({
  run,
  open,
  onClose,
}: {
  run: ProductionRun;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("factory");
  const receive = useReceiveProduction(run.run_id);
  const locations = useStockLocations();
  const [variantId, setVariantId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState("");

  // Only the run's own products can be received — receiving a variant that was
  // never produced here would post stock against the wrong cost basis.
  const options = useMemo(
    () =>
      (run.units ?? [])
        .filter((u) => u.variant_id)
        .map((u) => ({
          value: u.variant_id as string,
          label: `${u.product_name ?? u.variant_name ?? u.sku ?? ""} · ${u.quantity}`,
        })),
    [run.units],
  );
  const outstanding = Math.max(
    0,
    (run.units_planned || 0) - (run.units_received || 0),
  );

  useEffect(() => {
    if (open && options.length === 1) setVariantId(options[0].value);
  }, [open, options]);

  const submit = () => {
    if (!variantId || !locationId || num(qty) <= 0) return;
    receive.mutate(
      { variant_id: variantId, location_id: locationId, quantity: num(qty) },
      {
        onSuccess: () => {
          setQty("");
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("receiveUnits")}
      subtitle={<span className="font-mono text-[12px]">{run.run_number}</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={
              receive.isPending || !variantId || !locationId || num(qty) <= 0
            }
            onClick={submit}
          >
            {receive.isPending ? t("saving") : t("receiveUnits")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[12px] text-text-muted">
          {t("receiveHint", { n: outstanding })}
        </p>

        {options.length === 0 ? (
          <div className="glass rounded-xl p-4 text-[13px] text-text-muted">
            {t("receiveNoProducts")}
          </div>
        ) : (
          <>
            <Field label={t("product")}>
              <Select
                value={variantId}
                onChange={setVariantId}
                ariaLabel={t("product")}
                options={[{ value: "", label: t("selectPrompt") }, ...options]}
              />
            </Field>

            <Field label={t("location")}>
              <Select
                value={locationId}
                onChange={setLocationId}
                ariaLabel={t("location")}
                options={[
                  { value: "", label: t("selectPrompt") },
                  ...(locations.data ?? []).map((l) => ({
                    value: l.location_id,
                    label: l.display_name,
                  })),
                ]}
              />
            </Field>

            <Field label={t("quantity")} hint={t("receiveQtyHint")}>
              <NumberField
                value={qty}
                onChange={setQty}
                allowDecimal={false}
                placeholder={String(outstanding || 1)}
              />
            </Field>

            {run.per_unit_cost_ngn != null && (
              <div className="glass rounded-xl p-3 flex justify-between items-center text-[13px]">
                <span className="text-text-muted">{t("receiveAtCost")}</span>
                <MoneyText
                  ngn={run.per_unit_cost_ngn}
                  className="text-[13px]"
                />
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

// ── Run detail ────────────────────────────────────────────

function UnitsPanel({ units }: { units: RunUnitGroup[] }) {
  const { t } = useTranslation("factory");
  if (!units.length) return null;
  return (
    <div>
      <div className="micro mb-2">{t("productsInRun")}</div>
      <div className="space-y-2">
        {units.map((u, i) => (
          <div
            key={`${u.variant_id ?? "none"}-${u.status}-${i}`}
            className="flex items-center justify-between glass rounded-xl p-3 text-[13px] gap-3"
          >
            <div className="min-w-0">
              <div className="font-semibold truncate">
                {u.product_name ?? u.variant_name ?? t("unnamedProduct")}
              </div>
              <div className="text-xs text-text-faint font-mono truncate">
                {u.sku ?? u.sku_snapshot ?? "—"}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Pill tone="neutral" dot={false}>
                {t(`unitStatus.${u.status}`, u.status)}
              </Pill>
              <span className="font-mono font-semibold">×{u.quantity}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RunDetailDrawer({
  run: initialRun,
  onClose,
  canEdit,
  canReceive,
}: {
  run: ProductionRun;
  onClose: () => void;
  canEdit: boolean;
  canReceive: boolean;
}) {
  const { t } = useTranslation("factory");
  const { data: run } = useProductionRun(initialRun.run_id);
  const advance = useAdvanceProductionRun(initialRun.run_id);
  const current = run ?? initialRun;
  const meta = RUN_STATUS_META[current.status];
  const nextStatuses = RUN_STATUS_FLOW[current.status] ?? [];

  const [costOpen, setCostOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const components = current.components ?? [];
  // The server omits NGN columns entirely for roles that may not see cost, so
  // "is this present" is the only check needed — never a role check here.
  const showsCost = current.total_landed_cost_ngn != null;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        wide
        title={<span className="font-mono">{current.run_number}</span>}
        subtitle={<Pill tone={meta.tone}>{t(meta.i18nKey)}</Pill>}
      >
        <div className="space-y-6">
          <div>
            <h3 className="font-display text-lg font-medium mb-1">
              {current.title}
            </h3>
            <div className="text-[13px] text-text-muted">
              {t("unitsReceivedOf", {
                received: current.units_received,
                planned: current.units_planned,
              })}
            </div>
            {(current.supplier_name || current.po_number) && (
              <div className="text-[12px] text-text-faint mt-1">
                {[current.supplier_name, current.po_number]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
          </div>

          {/* Cost tiles — rendered only when the server sent cost. A factory
              manager sees the run without them, not a row of blanks. */}
          {showsCost ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="micro mb-1">{t("totalCost")}</div>
                <MoneyText
                  ngn={current.total_landed_cost_ngn as number}
                  className="text-[22px]"
                />
              </div>
              {current.per_unit_cost_ngn != null && (
                <div>
                  <div className="micro mb-1">{t("perUnitCost")}</div>
                  <MoneyText
                    ngn={current.per_unit_cost_ngn}
                    className="text-[22px]"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="glass rounded-xl p-3 text-[12px] text-text-muted">
              {t("costHiddenForRole")}
            </div>
          )}

          {/* Actions */}
          {(canEdit || canReceive) && (
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Package className="w-3.5 h-3.5" />}
                  onClick={() => setProductsOpen(true)}
                >
                  {t("addProducts")}
                </Button>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Coins className="w-3.5 h-3.5" />}
                  onClick={() => setCostOpen(true)}
                >
                  {t("addCost")}
                </Button>
              )}
              {canReceive && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<PackageCheck className="w-3.5 h-3.5" />}
                  onClick={() => setReceiveOpen(true)}
                >
                  {t("receiveUnits")}
                </Button>
              )}
            </div>
          )}

          <UnitsPanel units={current.units ?? []} />

          {components.length > 0 && (
            <div>
              <div className="micro mb-2">{t("costComponents")}</div>
              <div className="space-y-2">
                {components.map((c) => (
                  <div
                    key={c.component_id}
                    className="flex items-center justify-between glass rounded-xl p-3 text-[13px] gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate">
                        {t(
                          COST_TYPE_META[c.cost_type]?.i18nKey ?? c.cost_type,
                          COST_TYPE_META[c.cost_type]?.label ?? c.cost_type,
                        )}
                      </div>
                      <div className="text-xs text-text-faint truncate">
                        {[
                          c.description,
                          c.invoice_reference,
                          c.incurred_at ? formatDate(c.incurred_at) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <ForeignAmount
                        amount={Number(c.amount)}
                        currency={c.currency}
                        className="text-[13px] font-semibold"
                      />
                      {c.amount_ngn != null && c.currency !== "NGN" && (
                        <div className="text-[11px] text-text-muted">
                          <MoneyText
                            ngn={Number(c.amount_ngn)}
                            className="text-[11px]"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canEdit && nextStatuses.length > 0 && (
            <div>
              <div className="micro mb-2">{t("advanceStatus")}</div>
              <div className="flex gap-2 flex-wrap">
                {nextStatuses.map((s) => {
                  const m = RUN_STATUS_META[s];
                  return (
                    <Button
                      key={s}
                      size="sm"
                      variant={s === "cancelled" ? "danger" : "secondary"}
                      disabled={advance.isPending}
                      onClick={() => advance.mutate(s)}
                    >
                      → {m ? t(m.i18nKey) : s}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Drawer>

      {costOpen && (
        <AddCostDrawer
          run={current}
          open={costOpen}
          onClose={() => setCostOpen(false)}
        />
      )}
      {productsOpen && (
        <AddProductsDrawer
          run={current}
          open={productsOpen}
          onClose={() => setProductsOpen(false)}
        />
      )}
      {receiveOpen && (
        <ReceiveDrawer
          run={current}
          open={receiveOpen}
          onClose={() => setReceiveOpen(false)}
        />
      )}
    </>
  );
}
