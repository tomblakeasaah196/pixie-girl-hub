import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  AlertTriangle,
  ShieldAlert,
  Check,
  ArrowRight,
  DollarSign,
} from "lucide-react";
import { Button, Card, Pill, MoneyText } from "@/components/ui/primitives";
import { Field } from "@/components/ui/Form";
import { NumberField, Select } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import type { BaseProduct, Variant } from "@/lib/catalogue";
import {
  ProductVariantPicker,
  Banner,
  LabeledSlider,
  useDebounced,
} from "./parts";
import {
  BASIS_OPTIONS,
  CHANNEL_OPTIONS,
  COST_SOURCE_META,
  SLIDER_BOUNDS,
  fmtPct,
  marginTone,
} from "./constants";
import { useRecommend, useApplyPrice, useSetVariantUsd } from "./hooks";
import type { Basis, Recommendation } from "./types";

export function AdvisorTab({
  canEdit,
  onGoToProposals,
}: {
  canEdit: boolean;
  onGoToProposals: () => void;
}) {
  const [product, setProduct] = useState<BaseProduct | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [channel, setChannel] = useState("storefront");
  const [basis, setBasis] = useState<Basis>("margin");
  const [target, setTarget] = useState("50");
  const [netOfFee, setNetOfFee] = useState(false);
  const [costOverride, setCostOverride] = useState("");

  const recommend = useRecommend();
  const apply = useApplyPrice();
  const setUsd = useSetVariantUsd();

  const [rec, setRec] = useState<Recommendation | null>(null);
  const [applyMsg, setApplyMsg] = useState<
    | { kind: "applied"; price: number }
    | { kind: "proposed"; number: string }
    | { kind: "error"; text: string }
    | null
  >(null);
  const [usd, setUsdInput] = useState("");
  const [usdSaved, setUsdSaved] = useState(false);

  // Reset the target default when the basis changes.
  useEffect(() => {
    if (basis === "margin") setTarget("50");
    else if (basis === "markup") setTarget("100");
    else setTarget("");
  }, [basis]);

  // Stable payload, debounced so we don't hammer the endpoint on every keystroke.
  const payload = useMemo(() => {
    if (!variantId) return null;
    const targetNum = target.trim() === "" ? undefined : Number(target);
    const costNum =
      costOverride.trim() === "" ? undefined : Number(costOverride);
    return {
      variant_id: variantId,
      channel,
      basis,
      target_value: targetNum,
      net_of_channel_fee: netOfFee,
      cost_override_ngn: costNum,
    };
  }, [variantId, channel, basis, target, netOfFee, costOverride]);

  const debouncedPayload = useDebounced(payload, 300);
  const payloadKey = debouncedPayload ? JSON.stringify(debouncedPayload) : "";

  useEffect(() => {
    if (!debouncedPayload) {
      setRec(null);
      return;
    }
    let cancelled = false;
    recommend.mutate(debouncedPayload, {
      onSuccess: (data) => {
        if (cancelled) return;
        setRec(data);
        setUsdInput(data.price_usd != null ? data.price_usd : "");
      },
    });
    return () => {
      cancelled = true;
    };
    // recommend is stable from useMutation; key drives the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  // Clear apply feedback when inputs change.
  useEffect(() => {
    setApplyMsg(null);
    setUsdSaved(false);
  }, [payloadKey]);

  const onVariant = (id: string | null, v: Variant | null) => {
    setVariantId(id);
    setRec(null);
    void v;
  };

  const bounds = SLIDER_BOUNDS[basis];
  const targetNum = Number(target) || 0;

  const handleApply = () => {
    if (!rec) return;
    apply.mutate(
      {
        variant_id: rec.variant_id,
        channel: rec.channel,
        new_price_ngn: Number(rec.suggested_price_ngn),
      },
      {
        onSuccess: (res) => {
          if (res.applied) {
            setApplyMsg({
              kind: "applied",
              price: Number(res.new_price_ngn ?? rec.suggested_price_ngn),
            });
          } else {
            setApplyMsg({
              kind: "proposed",
              number: res.proposal_number ?? "—",
            });
          }
        },
        onError: (e) =>
          setApplyMsg({
            kind: "error",
            text: e instanceof Error ? e.message : "Could not apply.",
          }),
      },
    );
  };

  const handleSaveUsd = () => {
    if (!variantId) return;
    const priceUsd = usd.trim() === "" ? null : Number(usd);
    setUsd.mutate(
      { variantId, priceUsd },
      { onSuccess: () => setUsdSaved(true) },
    );
  };

  const costNoneNeedsInput = rec?.cost_source === "none";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
      {/* ── Inputs ── */}
      <Card className="p-5 space-y-4 self-start">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-glow" />
          <span className="font-display text-[15px] font-medium">
            Price advisor
          </span>
        </div>

        <ProductVariantPicker
          productId={product?.product_id ?? null}
          variantId={variantId}
          onProduct={setProduct}
          onVariant={onVariant}
        />

        <Field label="Channel">
          <Select
            value={channel}
            onChange={setChannel}
            options={CHANNEL_OPTIONS}
          />
        </Field>

        <Field label="Basis">
          <div className="flex gap-1 p-1 glass rounded-[11px]">
            {BASIS_OPTIONS.map((b) => (
              <button
                key={b.value}
                type="button"
                onClick={() => setBasis(b.value)}
                className={cn(
                  "flex-1 px-2 py-2 rounded-[9px] text-[11.5px] font-semibold transition-all",
                  basis === b.value
                    ? "bg-accent-deep text-[#F4E9D9]"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </Field>

        {bounds ? (
          <Field label={`Target ${basis} · ${fmtPct(targetNum, 0)}`}>
            <div className="flex items-center gap-3">
              <LabeledSlider
                value={targetNum}
                onChange={(v) => setTarget(String(v))}
                min={bounds.min}
                max={bounds.max}
                step={bounds.step}
              />
              <NumberField
                value={target}
                onChange={setTarget}
                suffix="%"
                className="w-24"
              />
            </div>
          </Field>
        ) : (
          <Field label="Target price (NGN)">
            <NumberField
              value={target}
              onChange={setTarget}
              suffix="₦"
              placeholder="0.00"
            />
          </Field>
        )}

        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="text-[12.5px] text-text-primary">
            Price net of channel fee
          </span>
          <input
            type="checkbox"
            checked={netOfFee}
            onChange={(e) => setNetOfFee(e.target.checked)}
            className="accent-accent-deep w-4 h-4"
          />
        </label>

        {costNoneNeedsInput && (
          <Field label="Cost override (NGN)" hint="cost is hidden">
            <NumberField
              value={costOverride}
              onChange={setCostOverride}
              suffix="₦"
              placeholder="Enter a cost"
            />
          </Field>
        )}
      </Card>

      {/* ── Result ── */}
      <div className="space-y-4">
        {!variantId ? (
          <Card className="p-10 text-center">
            <div className="w-[64px] h-[64px] rounded-[20px] mx-auto mb-4 grid place-items-center text-accent-glow bg-accent/10 border border-accent/20">
              <Sparkles className="w-7 h-7" />
            </div>
            <h3 className="font-display text-lg font-medium mb-1">
              Pick a product
            </h3>
            <p className="text-text-muted text-[13px] max-w-[340px] mx-auto">
              Search a product and choose a variant. The advisor suggests a
              price from your cost, target, channel fees and floors.
            </p>
          </Card>
        ) : recommend.isError ? (
          <Banner tone="danger" icon={<AlertTriangle className="w-4 h-4" />}>
            {recommend.error instanceof Error
              ? recommend.error.message
              : "Could not compute a price."}
          </Banner>
        ) : !rec ? (
          <Card className="p-8">
            <div className="h-6 w-40 rounded bg-text-primary/[0.06] animate-pulse mb-4" />
            <div className="h-10 w-56 rounded bg-text-primary/[0.08] animate-pulse mb-5" />
            <div className="grid grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 rounded bg-text-primary/[0.05] animate-pulse"
                />
              ))}
            </div>
          </Card>
        ) : (
          <ResultCard rec={rec} />
        )}

        {/* Cost-hidden note */}
        {rec && costNoneNeedsInput && (
          <Banner tone="info" icon={<ShieldAlert className="w-4 h-4" />}>
            Cost is hidden — enter a cost on the left or ask for Cost-Vault
            access to see margins.
          </Banner>
        )}

        {/* Apply */}
        {rec && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[12.5px] text-text-muted">
                {rec.delta_pct == null ? (
                  "No current price to compare."
                ) : (
                  <span>
                    Change vs current:{" "}
                    <span
                      className={cn(
                        "font-mono font-bold",
                        rec.delta_pct >= 0 ? "text-success" : "text-danger",
                      )}
                    >
                      {rec.delta_pct >= 0 ? "+" : ""}
                      {rec.delta_pct.toFixed(1)}%
                    </span>
                  </span>
                )}
              </div>
              <Button
                variant="primary"
                disabled={!canEdit || apply.isPending}
                onClick={handleApply}
                icon={<Check className="w-4 h-4" />}
              >
                {apply.isPending ? "Applying…" : "Apply price"}
              </Button>
            </div>

            {!canEdit && (
              <p className="text-[11.5px] text-text-faint">
                You can preview prices but need{" "}
                <span className="font-semibold">pricing.edit</span> to apply.
              </p>
            )}

            {applyMsg?.kind === "applied" && (
              <Banner tone="accent" icon={<Check className="w-4 h-4" />}>
                Applied instantly — new price{" "}
                <MoneyText
                  ngn={applyMsg.price}
                  className="text-[14px] text-accent-glow"
                />
                .
              </Banner>
            )}
            {applyMsg?.kind === "proposed" && (
              <Banner tone="warn" icon={<ArrowRight className="w-4 h-4" />}>
                Sent for CEO approval — proposal{" "}
                <span className="font-mono font-semibold">
                  {applyMsg.number}
                </span>
                .{" "}
                <button
                  onClick={onGoToProposals}
                  className="font-semibold underline"
                >
                  View in Proposals
                </button>
              </Banner>
            )}
            {applyMsg?.kind === "error" && (
              <Banner
                tone="danger"
                icon={<AlertTriangle className="w-4 h-4" />}
              >
                {applyMsg.text}
              </Banner>
            )}
          </Card>
        )}

        {/* USD price */}
        {rec && (
          <Card className="p-4">
            <div className="flex items-end gap-3 flex-wrap">
              <Field label="USD price (storefront $)" hint="optional">
                <div className="w-[180px]">
                  <NumberField
                    value={usd}
                    onChange={setUsdInput}
                    suffix="$"
                    placeholder="—"
                    disabled={!canEdit}
                  />
                </div>
              </Field>
              <Button
                variant="secondary"
                disabled={!canEdit || setUsd.isPending}
                onClick={handleSaveUsd}
                icon={<DollarSign className="w-4 h-4" />}
              >
                {setUsd.isPending ? "Saving…" : "Save USD"}
              </Button>
              {usdSaved && (
                <span className="text-[12px] text-success mb-2.5">Saved.</span>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function ResultCard({ rec }: { rec: Recommendation }) {
  const cs = COST_SOURCE_META[rec.cost_source];
  return (
    <Card className="overflow-hidden">
      {/* Hero */}
      <div className="p-5 border-b hairline">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold truncate">
              {rec.product_name}
            </div>
            <div className="font-mono text-[11px] text-text-faint">
              {[rec.variant_name, rec.sku].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {rec.rounded && (
              <Pill tone="neutral" dot={false}>
                Rounded
              </Pill>
            )}
            <Pill tone={rec.within_threshold ? "success" : "warn"}>
              {rec.within_threshold ? "Within threshold" : "Needs approval"}
            </Pill>
          </div>
        </div>

        <div className="mt-4 flex items-end gap-3 flex-wrap">
          <div>
            <div className="micro mb-1">Suggested price</div>
            <MoneyText
              ngn={Number(rec.suggested_price_ngn)}
              className="text-[34px] text-accent-glow leading-none"
            />
          </div>
          {rec.current_price_ngn != null && (
            <div className="pb-1">
              <div className="micro mb-1">Current</div>
              <MoneyText
                ngn={Number(rec.current_price_ngn)}
                className="text-[16px] text-text-muted"
              />
            </div>
          )}
        </div>

        {rec.floor_breached && (
          <div className="mt-3">
            <Pill tone="danger">
              Floor breached
              {rec.floor_ngn != null
                ? ` · min ₦${Number(rec.floor_ngn).toLocaleString("en-NG")}`
                : ""}
            </Pill>
          </div>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 divide-x divide-[rgb(var(--text)/0.06)]">
        <div className="p-4">
          <div className="micro mb-1">Margin</div>
          <div
            className={cn(
              "font-mono text-[20px] font-bold",
              metricColor(rec.margin_pct),
            )}
          >
            {fmtPct(rec.margin_pct)}
          </div>
        </div>
        <div className="p-4">
          <div className="micro mb-1">Markup</div>
          <div className="font-mono text-[20px] font-bold">
            {fmtPct(rec.markup_pct)}
          </div>
        </div>
        <div className="p-4">
          <div className="micro mb-1 flex items-center gap-1.5">
            Cost{" "}
            <Pill tone={cs.tone} dot={false}>
              {cs.label}
            </Pill>
          </div>
          <div className="font-mono text-[16px]">
            {rec.cost_source === "none" ? (
              <span className="text-text-faint">hidden</span>
            ) : (
              <MoneyText ngn={Number(rec.cost_ngn)} className="text-[16px]" />
            )}
          </div>
        </div>
      </div>

      {/* Breakdown lines */}
      <div className="px-5 py-4 border-t hairline space-y-2 text-[12.5px]">
        <Line label="Net (after channel fee)">
          <MoneyText ngn={Number(rec.net_ngn)} className="text-[13px]" />
        </Line>
        {rec.channel_fee &&
          (rec.channel_fee.pct > 0 || rec.channel_fee.fixed_ngn > 0) && (
            <Line label="Channel fee">
              <span className="font-mono text-text-muted">
                {rec.channel_fee.pct > 0
                  ? `${rec.channel_fee.pct.toFixed(1)}%`
                  : ""}
                {rec.channel_fee.pct > 0 && rec.channel_fee.fixed_ngn > 0
                  ? " + "
                  : ""}
                {rec.channel_fee.fixed_ngn > 0
                  ? `₦${rec.channel_fee.fixed_ngn.toLocaleString("en-NG")}`
                  : ""}
              </span>
            </Line>
          )}
        {rec.vat_rate > 0 && (
          <Line label={`VAT (${rec.vat_rate.toFixed(1)}%)`}>
            <MoneyText
              ngn={Number(rec.vat_amount_ngn)}
              className="text-[13px] text-text-muted"
            />
          </Line>
        )}
        {rec.price_usd != null && (
          <Line label="USD price">
            <span className="font-mono text-text-muted">${rec.price_usd}</span>
          </Line>
        )}
      </div>
    </Card>
  );
}

function Line({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      {children}
    </div>
  );
}

function metricColor(pct: number): string {
  const tone = marginTone(pct);
  return tone === "danger"
    ? "text-danger"
    : tone === "warn"
      ? "text-warn"
      : tone === "success"
        ? "text-success"
        : "text-text-primary";
}
