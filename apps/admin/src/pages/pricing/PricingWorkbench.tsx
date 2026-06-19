import { useState } from "react";
import { Calculator, AlertTriangle, TrendingUp, Layers, Play, CheckCircle, Database } from "lucide-react";
import { Button, Card, Pill, MoneyText, Skeleton } from "@/components/ui/primitives";
import { Field } from "@/components/ui/Form";
import { NumberField, Select } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { cn } from "@/lib/cn";
import { useQuery } from "@tanstack/react-query";
import { getScenario } from "./api";
import { useScenarioMutations, useProposalMutations } from "./hooks";
import { CHANNEL_FEES, grossUp, marginPct, markupPct, priceFromMargin } from "./constants";
import type { GoalType, ScenarioResultItem } from "./types";

function fmtNgn(n: number | string) {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "—";
  return `₦${num.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

export function PricingWorkbench() {
  const [view, setView] = useState<"calculator" | "builder">("calculator");

  return (
    <div className="space-y-5">
      {/* Mode Toggle */}
      <div className="flex gap-2 border-b hairline pb-3">
        <button
          onClick={() => setView("calculator")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors",
            view === "calculator" ? "bg-accent/15 text-accent-glow" : "text-text-muted hover:bg-text-primary/[0.04]"
          )}
        >
          <Calculator className="w-4 h-4" />
          Local Scratchpad
        </button>
        <button
          onClick={() => setView("builder")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors",
            view === "builder" ? "bg-accent/15 text-accent-glow" : "text-text-muted hover:bg-text-primary/[0.04]"
          )}
        >
          <Database className="w-4 h-4" />
          Bulk Scenario Builder
        </button>
      </div>

      {view === "calculator" ? <LocalCalculator /> : <ScenarioBuilder />}
    </div>
  );
}

// ── 1. Local Scratchpad (Client-Side Math Only) ───────────────────────────────

function LocalCalculator() {
  const [cost, setCost] = useState("");
  const [mode, setMode] = useState<"margin" | "price">("margin");
  const [targetMargin, setTargetMargin] = useState("50");
  const [targetPrice, setTargetPrice] = useState("");
  const [floor, setFloor] = useState("");
  const [result, setResult] = useState<any>(null);

  const handleCompute = () => {
    const c = parseFloat(cost) || 0;
    if (c <= 0) return;

    const tm = parseFloat(targetMargin) || 0;
    const tp = parseFloat(targetPrice) || 0;
    const f = parseFloat(floor) || null;

    const basePrice = mode === "margin" ? priceFromMargin(c, tm) : tp;
    const actualMargin = marginPct(c, basePrice);

    // Generate local sensitivity ±10%
    const grid = [-10, -5, 0, 5, 10].map((delta) => {
      const m = actualMargin + delta;
      return { margin: m, price: priceFromMargin(c, m) };
    });

    // Generate channel gross-ups
    const channels = Object.entries(CHANNEL_FEES).map(([key, fee]) => {
      const gross = grossUp(basePrice, key);
      const mg = marginPct(c, gross);
      return { channel: key, fee, gross, net: basePrice, marginAtGross: mg };
    });

    setResult({ basePrice, actualMargin, markup: markupPct(c, basePrice), grid, channels, floorBreached: f !== null && basePrice < f });
  };

  return (
    <div className="space-y-5 animate-in fade-in zoom-in-95 duration-200">
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="True Cost (NGN)">
            <NumberField value={cost} onChange={setCost} suffix="₦" placeholder="0.00" />
          </Field>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted mb-2">Target Mode</div>
            <div className="flex gap-1 p-1 glass rounded-[11px]">
              {(["margin", "price"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setResult(null); }}
                  className={cn("flex-1 px-3 py-2 rounded-[9px] text-[12px] font-semibold transition-all", mode === m ? "bg-accent-deep text-[#F4E9D9]" : "text-text-muted hover:text-text-primary")}
                >
                  {m === "margin" ? "Target Margin" : "Target Price"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end">
            <Button variant="primary" disabled={!cost} onClick={handleCompute} className="w-full sm:w-auto">
              Calculate Matrix
            </Button>
          </div>
        </div>

        <div className="mt-4 flex gap-4">
          <div className="flex-1">
            {mode === "margin" ? (
              <Field label="Target Margin (%)">
                <NumberField value={targetMargin} onChange={setTargetMargin} suffix="%" />
              </Field>
            ) : (
              <Field label="Target Retail Price (₦)">
                <NumberField value={targetPrice} onChange={setTargetPrice} suffix="₦" />
              </Field>
            )}
          </div>
          <div className="flex-1">
            <Field label="Price Floor Guard (₦)">
              <NumberField value={floor} onChange={setFloor} suffix="₦" placeholder="Optional minimum" />
            </Field>
          </div>
        </div>
      </Card>

      {result && (
        <div className="space-y-5">
          {result.floorBreached && (
            <div className="flex items-center gap-2 text-danger text-[13px] bg-danger/10 border border-danger/25 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Computed price is below your floor guard. Consider raising the margin target.
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4 border-l-[3px] border-l-[rgb(var(--accent))]">
              <div className="micro mb-1">Retail Base Price</div>
              <div className="font-mono text-[22px] font-bold">{fmtNgn(result.basePrice)}</div>
            </Card>
            <Card className="p-4 border-l-[3px] border-l-[rgb(var(--success))]">
              <div className="micro mb-1">Gross Margin</div>
              <div className={cn("font-mono text-[22px] font-bold", result.actualMargin < 20 ? "text-danger" : result.actualMargin < 35 ? "text-warn" : "text-success")}>
                {fmtPct(result.actualMargin)}
              </div>
            </Card>
            <Card className="p-4 border-l-[3px] border-l-[rgb(var(--info))]">
              <div className="micro mb-1">Markup</div>
              <div className="font-mono text-[22px] font-bold">{fmtPct(result.markup)}</div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="p-4 border-b hairline flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-text-faint" />
              <span className="font-semibold text-[14px]">Channel Gross-Up Matrix</span>
              <span className="text-[12px] text-text-faint ml-2">(net + fee) ÷ (1 − %fee)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="micro p-[8px_14px] border-b hairline bg-text-primary/[0.02] text-left">Channel</th>
                    <th className="micro p-[8px_14px] border-b hairline bg-text-primary/[0.02] text-right">List Price</th>
                    <th className="micro p-[8px_14px] border-b hairline bg-text-primary/[0.02] text-right">Margin @ Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {result.channels.map((c: any, i: number) => (
                    <tr key={c.channel} className={cn("border-b hairline last:border-0", i % 2 === 1 && "bg-text-primary/[0.015]")}>
                      <td className="p-[10px_14px]">
                        <div className="flex items-center gap-2">
                          <span>{c.fee.icon}</span><span className="font-semibold">{c.fee.label}</span>
                        </div>
                      </td>
                      <td className="p-[10px_14px] text-right font-mono font-bold text-accent-glow">{fmtNgn(c.gross)}</td>
                      <td className="p-[10px_14px] text-right"><Pill tone={c.marginAtGross < 20 ? "danger" : "success"} dot={false}>{fmtPct(c.marginAtGross)}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── 2. Bulk Scenario Builder (Backend Workflow) ───────────────────────────────

function ScenarioBuilder() {
  const [name, setName] = useState("");
  const [scope, setScope] = useState("all_active");
  const [goal, setGoal] = useState<GoalType>("target_margin");
  const [val, setVal] = useState("");

  const { create, compute } = useScenarioMutations();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [proposeModalOpen, setProposeModalOpen] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["scenario-detail", activeId],
    queryFn: () => getScenario(activeId!),
    enabled: !!activeId,
    refetchInterval: (d) => (d?.status === "draft" ? 2000 : false),
  });

  const handleRun = () => {
    if (!name || !val) return;
    create.mutate(
      { scenario_name: name, scope_type: scope as any, goal_type: goal, goal_value: parseFloat(val) },
      {
        onSuccess: (res) => {
          compute.mutate(
            { id: res.scenario_id },
            { onSuccess: () => setActiveId(res.scenario_id) }
          );
        },
      }
    );
  };

  const cols: Column<ScenarioResultItem>[] = [
    { key: "variant", header: "Variant ID", render: (r) => <span className="font-mono text-[11px] text-text-muted">{r.variant_id.slice(0, 8)}...</span> },
    { key: "cost", header: "Cost", align: "right", render: (r) => <span className="font-mono text-[12px]">{fmtNgn(r.cost_ngn)}</span> },
    { key: "current", header: "Current", align: "right", render: (r) => <span className="font-mono text-[12px] text-text-faint">{r.current_price_ngn ? fmtNgn(r.current_price_ngn) : "—"}</span> },
    { key: "proposed", header: "Proposed", align: "right", render: (r) => <span className="font-mono text-[13px] font-bold text-accent-glow">{fmtNgn(r.proposed_price_ngn)}</span> },
    { key: "margin", header: "New Margin", align: "right", render: (r) => <Pill tone={r.proposed_margin_pct < 20 ? "danger" : "success"} dot={false}>{fmtPct(r.proposed_margin_pct)}</Pill> },
    { key: "floor", header: "Floor Guard", render: (r) => r.floor_breached ? <span className="text-[11px] text-danger font-semibold">Breached</span> : <span className="text-[11px] text-success">OK</span> },
  ];

  return (
    <div className="space-y-5 animate-in fade-in zoom-in-95 duration-200">
      <Card className="p-5 border-[1.5px] border-accent/20 bg-accent/[0.02]">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Field label="Scenario Name"><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full h-[42px] px-[13px] rounded-[11px] bg-background border border-line text-text-primary outline-none focus:border-accent/50" placeholder="e.g. Q3 Catalog Markups" /></Field>
          <Field label="Scope">
            <Select value={scope} onChange={setScope} options={[ { value: "all_active", label: "All Active Variants" }, { value: "specific_variants", label: "Specific Variants (Manual)" } ]} />
          </Field>
          <Field label="Goal Strategy">
            <Select value={goal} onChange={(v) => setGoal(v as GoalType)} options={[ { value: "target_margin", label: "Target Margin (%)" }, { value: "target_price", label: "Fixed Target Price (₦)" } ]} />
          </Field>
          <Field label={goal === "target_margin" ? "Target Margin (%)" : "Target Value"}>
            <NumberField value={val} onChange={setVal} suffix={goal === "target_margin" ? "%" : ""} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" icon={<Play className="w-4 h-4" />} onClick={handleRun} disabled={create.isPending || compute.isPending || !name || !val}>
            {create.isPending || compute.isPending ? "Computing DB Scenario..." : "Run Bulk Scenario"}
          </Button>
        </div>
      </Card>

      {isLoading && <Skeleton className="h-64 w-full rounded-2xl" />}

      {detail && detail.status === "computed" && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-4"><div className="micro">Variants Evaluated</div><div className="font-mono text-xl">{(detail as any).computed_units_analysed ?? detail.results.length}</div></Card>
            <Card className="p-4"><div className="micro">Avg Proposed Price</div><div className="font-mono text-xl text-accent-glow">{(detail as any).computed_avg_new_price_ngn ? fmtNgn((detail as any).computed_avg_new_price_ngn) : "—"}</div></Card>
            <Card className="p-4"><div className="micro">Avg Margin</div><div className="font-mono text-xl text-success">{(detail as any).computed_avg_margin_pct ? fmtPct((detail as any).computed_avg_margin_pct) : "—"}</div></Card>
            <Button variant="primary" className="h-full w-full" onClick={() => setProposeModalOpen(true)}>
              Propose This Scenario
            </Button>
          </div>
          <DataTable columns={cols} rows={detail.results || []} rowKey={(r) => r.variant_id} />
        </div>
      )}

      {/* Proposal Submission Modal strictly tied to this Scenario */}
      {activeId && (
        <SubmitProposalDrawer
          scenarioId={activeId}
          open={proposeModalOpen}
          onClose={() => setProposeModalOpen(false)}
        />
      )}
    </div>
  );
}

// ── 3. Submit Proposal Drawer (Enforces Workflow) ─────────────────────────────

function SubmitProposalDrawer({ scenarioId, open, onClose }: { scenarioId: string; open: boolean; onClose: () => void }) {
  const { create } = useProposalMutations();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  const submit = () => {
    if (!title) return;
    create.mutate(
      { scenario_id: scenarioId, title, description: desc },
      { onSuccess: onClose }
    );
  };

  return (
    <Drawer open={open} onClose={onClose} title="Submit Price Proposal" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={create.isPending || !title} onClick={submit}>
          {create.isPending ? "Submitting..." : "Send to CEO for Approval"}
        </Button>
      </>
    }>
      <div className="space-y-4">
        <div className="bg-info/10 text-info border border-info/20 p-3 rounded-xl text-[13px] flex items-start gap-2">
          <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>This proposal will lock in the computed prices from your scenario. Once approved by the CEO, these prices will be automatically applied to the active product variants.</p>
        </div>
        <Field label="Proposal Title">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Holiday Markup Adjustment" className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50" />
        </Field>
        <Field label="Justification / Description">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Provide reasoning for this price change..." rows={4} className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 resize-none text-[13px]" />
        </Field>
      </div>
    </Drawer>
  );
}
