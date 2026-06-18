import { useState } from "react";
import { Calculator, AlertTriangle, TrendingUp } from "lucide-react";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { Field } from "@/components/ui/Form";
import { NumberField } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { useComputeScenario } from "./hooks";
import { CHANNEL_FEES } from "./constants";
import type { ScenarioResult, SavedScenario } from "./types";

function fmtNgn(n: number) {
  return `₦${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

// Fee gross-up: gross = (net + fixed_fee) / (1 - pct_fee)
function grossUp(net: number, pct: number, fixed: number) {
  if (pct >= 1) return net + fixed;
  return (net + fixed) / (1 - pct);
}

export function PricingWorkbench({
  onSaveScenario,
}: {
  onSaveScenario?: (s: SavedScenario) => void;
}) {
  const [mode, setMode] = useState<"margin" | "price">("margin");
  const [cost, setCost] = useState("");
  const [targetMargin, setTargetMargin] = useState("50");
  const [targetPrice, setTargetPrice] = useState("");
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [scenarioName, setScenarioName] = useState("");

  const compute = useComputeScenario();

  const costNum = parseFloat(cost) || 0;
  const marginNum = parseFloat(targetMargin) || 50;
  const priceNum = parseFloat(targetPrice) || 0;

  // Compute channel prices locally using the gross-up formula
  const computeChannelPrices = (netPrice: number) =>
    Object.entries(CHANNEL_FEES).map(([channel, fee]) => {
      const gross = grossUp(netPrice, fee.pct_fee, fee.fixed_fee_ngn);
      const marginAtGross = costNum > 0 ? ((gross - costNum) / gross) * 100 : 0;
      return { channel, fee, gross, net: netPrice, marginAtGross };
    });

  const handleCompute = () => {
    if (!costNum) return;
    const input =
      mode === "margin"
        ? { cost_ngn: costNum, target_margin_pct: marginNum }
        : { cost_ngn: costNum, target_price_ngn: priceNum };

    compute.mutate(input, {
      onSuccess: (data) => setResult(data),
    });
  };

  const handleSave = () => {
    if (!result || !scenarioName) return;
    const scenario: SavedScenario = {
      id: crypto.randomUUID(),
      name: scenarioName,
      cost_ngn: costNum,
      target_margin_pct: mode === "margin" ? marginNum : undefined,
      target_price_ngn: mode === "price" ? priceNum : undefined,
      result,
      saved_at: new Date().toISOString(),
    };
    onSaveScenario?.(scenario);
    setScenarioName("");
  };

  const isBelowFloor = result && floor != null && result.base_price < floor;
  const channelPrices = result ? computeChannelPrices(result.base_price) : [];

  return (
    <div className="space-y-5">
      {/* Input panel */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calculator className="w-4 h-4 text-accent-glow" />
          <span className="font-display text-[15px] font-medium">Pricing Workbench</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="True Cost (NGN)">
            <NumberField
              value={cost}
              onChange={setCost}
              placeholder="0.00"
              suffix="₦"
            />
          </Field>

          <div>
            <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted mb-2">
              Mode
            </div>
            <div className="flex gap-1 p-1 glass rounded-[11px]">
              {(["margin", "price"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-[9px] text-[12px] font-semibold transition-all",
                    mode === m
                      ? "bg-accent-deep text-[#F4E9D9]"
                      : "text-text-muted hover:text-text-primary",
                  )}
                >
                  {m === "margin" ? "Target Margin" : "Target Price"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end">
            <Button
              variant="primary"
              disabled={compute.isPending || !costNum}
              onClick={handleCompute}
              className="w-full sm:w-auto"
            >
              {compute.isPending ? "Calculating…" : "Calculate"}
            </Button>
          </div>
        </div>

        {/* Mode-specific input */}
        <div className="mt-4">
          {mode === "margin" ? (
            <Field label={`Target Margin: ${targetMargin}%`}>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="90"
                  step="0.5"
                  value={targetMargin}
                  onChange={(e) => setTargetMargin(e.target.value)}
                  className="flex-1 accent-[rgb(var(--accent-deep))] h-2 rounded-full cursor-pointer"
                />
                <NumberField
                  value={targetMargin}
                  onChange={setTargetMargin}
                  suffix="%"
                  className="w-24"
                />
              </div>
            </Field>
          ) : (
            <Field label="Target Retail Price (NGN)">
              <NumberField value={targetPrice} onChange={setTargetPrice} suffix="₦" placeholder="0.00" />
            </Field>
          )}
        </div>

        {/* Floor guard */}
        <div className="mt-4 flex items-center gap-3">
          <Field label="Price Floor (optional)">
            <NumberField
              value={floor != null ? String(floor) : ""}
              onChange={(v) => setFloor(v ? parseFloat(v) : null)}
              suffix="₦"
              placeholder="Minimum price"
            />
          </Field>
        </div>
      </Card>

      {/* Results */}
      {result && (
        <>
          {isBelowFloor && (
            <div className="flex items-center gap-2 text-danger text-[13px] bg-danger/10 border border-danger/25 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Computed price {fmtNgn(result.base_price)} is below your floor of {fmtNgn(floor!)}.
              Consider raising the margin target or reducing cost.
            </div>
          )}

          {/* Key metrics */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4 border-l-[3px] border-l-[rgb(var(--accent))]">
              <div className="micro mb-1">Retail Price</div>
              <div className="font-mono text-[22px] font-bold">{fmtNgn(result.base_price)}</div>
            </Card>
            <Card className="p-4 border-l-[3px] border-l-[rgb(var(--success))]">
              <div className="micro mb-1">Gross Margin</div>
              <div
                className={cn(
                  "font-mono text-[22px] font-bold",
                  result.target_margin_pct < 20 ? "text-danger" : result.target_margin_pct < 35 ? "text-warn" : "text-success",
                )}
              >
                {fmtPct(result.target_margin_pct)}
              </div>
            </Card>
            <Card className="p-4 border-l-[3px] border-l-[rgb(var(--info))]">
              <div className="micro mb-1">Markup</div>
              <div className="font-mono text-[22px] font-bold">{fmtPct(result.markup_pct)}</div>
            </Card>
          </div>

          {/* Sensitivity grid */}
          {result.sensitivity_grid && result.sensitivity_grid.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b hairline flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-text-faint" />
                <span className="font-semibold text-[14px]">Sensitivity Grid</span>
                <span className="text-[12px] text-text-faint">Margin → Price at your cost basis</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-center text-[12px]">
                  <thead>
                    <tr>
                      <th className="micro p-[8px_12px] border-b hairline bg-text-primary/[0.02] text-left">Margin %</th>
                      <th className="micro p-[8px_12px] border-b hairline bg-text-primary/[0.02]">Price (₦)</th>
                      <th className="micro p-[8px_12px] border-b hairline bg-text-primary/[0.02]">vs Cost</th>
                      <th className="micro p-[8px_12px] border-b hairline bg-text-primary/[0.02]">Floor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.sensitivity_grid.map((row) => {
                      const isTarget = Math.abs(row.margin - result.target_margin_pct) < 0.5;
                      const isBelowFloorRow = floor != null && row.price < floor;
                      return (
                        <tr
                          key={row.margin}
                          className={cn(
                            "border-b hairline last:border-0 transition-colors",
                            isTarget && "bg-accent/[0.08]",
                          )}
                        >
                          <td className={cn("p-[7px_12px] font-mono font-semibold text-left", isTarget && "text-accent-glow")}>
                            {fmtPct(row.margin)}
                            {isTarget && " ◀"}
                          </td>
                          <td className={cn("p-[7px_12px] font-mono", isBelowFloorRow ? "text-danger" : isTarget ? "text-accent-glow font-bold" : "")}>
                            {fmtNgn(row.price)}
                          </td>
                          <td className="p-[7px_12px] text-text-muted font-mono">
                            {costNum > 0 ? `+${fmtPct(((row.price - costNum) / costNum) * 100)}` : "—"}
                          </td>
                          <td className="p-[7px_12px]">
                            {isBelowFloorRow ? (
                              <Pill tone="danger" dot={false}>Below</Pill>
                            ) : (
                              <Pill tone="success" dot={false}>OK</Pill>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Channel price grid */}
          <Card className="overflow-hidden">
            <div className="p-4 border-b hairline">
              <span className="font-semibold text-[14px]">Channel Price Grid</span>
              <span className="text-[12px] text-text-faint ml-2">Gross-up formula: (net + fee) ÷ (1 − %fee)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="micro p-[8px_14px] border-b hairline bg-text-primary/[0.02] text-left">Channel</th>
                    <th className="micro p-[8px_14px] border-b hairline bg-text-primary/[0.02] text-right">Net Price</th>
                    <th className="micro p-[8px_14px] border-b hairline bg-text-primary/[0.02] text-right">Platform Fee</th>
                    <th className="micro p-[8px_14px] border-b hairline bg-text-primary/[0.02] text-right">List Price</th>
                    <th className="micro p-[8px_14px] border-b hairline bg-text-primary/[0.02] text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {channelPrices.map(({ channel, fee, gross, net, marginAtGross }, i) => {
                    const feeAmount = gross - net;
                    return (
                      <tr
                        key={channel}
                        className={cn(
                          "border-b hairline last:border-0",
                          i % 2 === 1 && "bg-text-primary/[0.015]",
                        )}
                      >
                        <td className="p-[10px_14px]">
                          <div className="flex items-center gap-2">
                            <span>{fee.icon}</span>
                            <span className="font-semibold">{fee.label}</span>
                          </div>
                          <div className="text-[11px] text-text-faint mt-0.5">
                            {fee.pct_fee > 0 ? `${(fee.pct_fee * 100).toFixed(1)}%` : ""}
                            {fee.pct_fee > 0 && fee.fixed_fee_ngn > 0 ? " + " : ""}
                            {fee.fixed_fee_ngn > 0 ? `₦${fee.fixed_fee_ngn}` : ""}
                            {fee.pct_fee === 0 && fee.fixed_fee_ngn === 0 ? "No fee" : ""}
                          </div>
                        </td>
                        <td className="p-[10px_14px] text-right font-mono">{fmtNgn(net)}</td>
                        <td className="p-[10px_14px] text-right font-mono text-warn">
                          {feeAmount > 0 ? `+${fmtNgn(feeAmount)}` : "—"}
                        </td>
                        <td className="p-[10px_14px] text-right font-mono font-bold text-accent-glow">
                          {fmtNgn(gross)}
                        </td>
                        <td className="p-[10px_14px] text-right">
                          <Pill
                            tone={marginAtGross < 20 ? "danger" : marginAtGross < 35 ? "warn" : "success"}
                            dot={false}
                          >
                            {fmtPct(marginAtGross)}
                          </Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Save scenario */}
          {onSaveScenario && (
            <div className="flex gap-3 items-end">
              <Field label="Save as Scenario">
                <input
                  type="text"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  placeholder="Scenario name…"
                  className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
                />
              </Field>
              <Button
                variant="secondary"
                disabled={!scenarioName}
                onClick={handleSave}
                className="shrink-0"
              >
                Save
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
