import { useEffect, useState } from "react";
import { Plus, FlaskConical, Play, Send, AlertTriangle } from "lucide-react";
import {
  Button,
  Card,
  Pill,
  MoneyText,
  Skeleton,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field, TextInput } from "@/components/ui/Form";
import { NumberField, Select, ErrorState } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import {
  CHANNEL_OPTIONS,
  GOAL_TYPE_LABELS,
  GOAL_TYPE_OPTIONS,
  SCENARIO_STATUS_META,
  SCENARIO_STATUS_TABS,
  SCOPE_TYPE_OPTIONS,
  fmtPct,
  marginTone,
} from "./constants";
import {
  useScenarios,
  useScenario,
  useCreateScenario,
  useComputeScenario,
  useProposalMutations,
} from "./hooks";
import type {
  Scenario,
  ScenarioResult,
  Slider,
  ComputeSliderInput,
  GoalType,
  ScopeType,
} from "./types";

export function ScenariosTab({
  canEdit,
  onGoToProposals,
}: {
  canEdit: boolean;
  onGoToProposals: () => void;
}) {
  const [status, setStatus] = useState("");
  const { data, isLoading, isError, refetch } = useScenarios(
    status || undefined,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const cols: Column<Scenario>[] = [
    {
      key: "name",
      header: "Scenario",
      render: (s) => (
        <div>
          <div className="font-semibold text-[13px]">{s.scenario_name}</div>
          <div className="text-[11px] text-text-faint">
            {GOAL_TYPE_LABELS[s.goal_type]}
          </div>
        </div>
      ),
    },
    {
      key: "goal",
      header: "Goal",
      align: "right",
      width: "110px",
      render: (s) =>
        s.goal_value == null ? (
          <span className="text-text-faint">—</span>
        ) : (
          <span className="font-mono text-[13px]">
            {s.goal_type === "target_price" ||
            s.goal_type === "target_revenue" ? (
              <MoneyText ngn={Number(s.goal_value)} className="text-[13px]" />
            ) : (
              `${s.goal_value}%`
            )}
          </span>
        ),
    },
    {
      key: "units",
      header: "Units",
      align: "right",
      width: "90px",
      render: (s) => (
        <span className="font-mono text-xs text-text-muted">
          {s.computed_units_analysed ?? "—"}
        </span>
      ),
    },
    {
      key: "avgmargin",
      header: "Avg margin",
      align: "right",
      width: "100px",
      render: (s) =>
        s.computed_avg_margin_pct == null ? (
          <span className="text-text-faint">—</span>
        ) : (
          <span
            className={cn(
              "font-mono text-[13px]",
              metricColor(s.computed_avg_margin_pct),
            )}
          >
            {fmtPct(s.computed_avg_margin_pct)}
          </span>
        ),
    },
    {
      key: "revenue",
      header: "Proj. revenue",
      align: "right",
      width: "130px",
      render: (s) =>
        s.computed_projected_revenue_ngn == null ? (
          <span className="text-text-faint">—</span>
        ) : (
          <MoneyText
            ngn={Number(s.computed_projected_revenue_ngn)}
            className="text-[13px]"
          />
        ),
    },
    {
      key: "status",
      header: "Status",
      width: "110px",
      render: (s) => {
        const meta = SCENARIO_STATUS_META[s.status];
        return <Pill tone={meta.tone}>{meta.label}</Pill>;
      },
    },
  ];

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <StatusTabs
          tabs={SCENARIO_STATUS_TABS}
          value={status}
          onChange={setStatus}
        />
        {canEdit && (
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setCreating(true)}
          >
            New scenario
          </Button>
        )}
      </div>

      <DataTable
        columns={cols}
        rows={data ?? []}
        rowKey={(s) => s.scenario_id}
        onRowClick={(s) => setOpenId(s.scenario_id)}
        loading={isLoading}
        empty={{
          icon: <FlaskConical className="w-7 h-7" />,
          title: "No scenarios",
          message:
            "Model a margin/price/revenue goal across products, run sensitivity, then promote to a proposal.",
          action: canEdit ? (
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setCreating(true)}
            >
              New scenario
            </Button>
          ) : undefined,
        }}
      />

      {openId && (
        <ScenarioDrawer
          id={openId}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onGoToProposals={onGoToProposals}
        />
      )}

      <NewScenarioDrawer open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function StatusTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide border transition-all",
            value === t.value
              ? "bg-accent/20 text-accent-glow border-accent/30"
              : "bg-text-primary/[0.04] text-text-muted border-transparent hover:bg-text-primary/[0.08]",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Detail drawer ────────────────────────────────────────────────────────────
function ScenarioDrawer({
  id,
  canEdit,
  onClose,
  onGoToProposals,
}: {
  id: string;
  canEdit: boolean;
  onClose: () => void;
  onGoToProposals: () => void;
}) {
  const { data, isLoading, isError, refetch } = useScenario(id);
  const compute = useComputeScenario();
  const { create: createProposal } = useProposalMutations();

  // Local slider values, seeded from the server detail.
  const [sliderVals, setSliderVals] = useState<Record<string, number>>({});
  const [promoted, setPromoted] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const seed: Record<string, number> = {};
    for (const s of data.sliders) seed[s.slider_key] = s.scenario_value;
    setSliderVals(seed);
  }, [data]);

  const meta = data ? SCENARIO_STATUS_META[data.status] : null;

  const recompute = () => {
    if (!data) return;
    const sliders: ComputeSliderInput[] = data.sliders.map((s) => ({
      slider_key: s.slider_key,
      baseline_value: s.baseline_value,
      scenario_value: sliderVals[s.slider_key] ?? s.scenario_value,
      notes: s.notes ?? undefined,
    }));
    compute.mutate({ id, sliders: sliders.length ? sliders : undefined });
  };

  const promote = () => {
    if (!data) return;
    createProposal.mutate(
      { scenario_id: id, title: data.scenario_name },
      { onSuccess: (p) => setPromoted(p.proposal_number) },
    );
  };

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={data?.scenario_name ?? "Scenario"}
      subtitle={meta ? <Pill tone={meta.tone}>{meta.label}</Pill> : undefined}
      footer={
        data ? (
          <>
            {canEdit && (
              <Button
                variant="secondary"
                disabled={compute.isPending}
                onClick={recompute}
                icon={<Play className="w-4 h-4" />}
              >
                {compute.isPending ? "Computing…" : "Recompute"}
              </Button>
            )}
            {canEdit && data.status === "computed" && (
              <Button
                variant="primary"
                disabled={createProposal.isPending}
                onClick={promote}
                icon={<Send className="w-4 h-4" />}
              >
                {createProposal.isPending
                  ? "Promoting…"
                  : "Promote to proposal"}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" style={{ height: 96 }} />
        </div>
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <div className="space-y-5">
          {/* Goal summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Mini label="Goal">{GOAL_TYPE_LABELS[data.goal_type]}</Mini>
            <Mini label="Channel">{data.channel ?? "All"}</Mini>
            <Mini label="Units analysed">
              {data.computed_units_analysed ?? "—"}
            </Mini>
            <Mini label="Avg margin">
              <span className={metricColor(data.computed_avg_margin_pct)}>
                {fmtPct(data.computed_avg_margin_pct)}
              </span>
            </Mini>
          </div>

          {promoted && (
            <div className="flex items-center gap-2 text-[13px] rounded-xl p-3 border text-accent-glow bg-accent/10 border-accent/25">
              <Send className="w-4 h-4" />
              <span>
                Proposal{" "}
                <span className="font-mono font-semibold">{promoted}</span>{" "}
                created.{" "}
                <button
                  onClick={onGoToProposals}
                  className="font-semibold underline"
                >
                  Open Proposals
                </button>
              </span>
            </div>
          )}

          {/* Sliders */}
          {data.sliders.length > 0 && (
            <Card className="p-4">
              <div className="micro mb-3">Sensitivity sliders</div>
              <div className="space-y-4">
                {data.sliders.map((s) => (
                  <SliderRow
                    key={s.slider_id}
                    slider={s}
                    value={sliderVals[s.slider_key] ?? s.scenario_value}
                    disabled={!canEdit}
                    onChange={(v) =>
                      setSliderVals((p) => ({ ...p, [s.slider_key]: v }))
                    }
                  />
                ))}
              </div>
            </Card>
          )}

          {/* Results */}
          <ResultsTable results={data.results} />
        </div>
      )}
    </Drawer>
  );
}

function SliderRow({
  slider,
  value,
  disabled,
  onChange,
}: {
  slider: Slider;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  // Range around the baseline so the slider has a useful span (±30%).
  const span = Math.max(Math.abs(slider.baseline_value) * 0.5, 10);
  const min = Math.round((slider.baseline_value - span) * 100) / 100;
  const max = Math.round((slider.baseline_value + span) * 100) / 100;
  const delta =
    slider.baseline_value !== 0
      ? ((value - slider.baseline_value) / Math.abs(slider.baseline_value)) *
        100
      : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1.5">
        <span className="font-semibold capitalize">
          {slider.slider_key.replace(/_/g, " ")}
        </span>
        <span
          className={cn(
            "font-mono",
            delta >= 0 ? "text-success" : "text-danger",
          )}
        >
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}%
        </span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={(max - min) / 100 || 1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-[rgb(var(--accent-deep))] h-2 rounded-full cursor-pointer disabled:opacity-50"
        />
        <span className="font-mono text-[12px] w-[90px] text-right tabular-nums">
          {value.toLocaleString("en-NG")}
        </span>
      </div>
      {slider.notes && (
        <div className="text-[11px] text-text-faint mt-1">{slider.notes}</div>
      )}
    </div>
  );
}

function ResultsTable({ results }: { results: ScenarioResult[] }) {
  if (results.length === 0) {
    return (
      <Card className="p-5 text-center text-[13px] text-text-muted">
        No results yet — run <span className="font-semibold">Recompute</span> to
        evaluate this scenario.
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="p-3 border-b hairline text-[13px] font-semibold">
        Results · {results.length} variants
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-text-faint text-left border-b hairline">
              <th className="p-[8px_12px] font-semibold">Variant</th>
              <th className="p-[8px_12px] font-semibold text-right">Cost</th>
              <th className="p-[8px_12px] font-semibold text-right">Current</th>
              <th className="p-[8px_12px] font-semibold text-right">
                Proposed
              </th>
              <th className="p-[8px_12px] font-semibold text-right">Margin</th>
              <th className="p-[8px_12px] font-semibold text-center">Floor</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.result_id} className="border-b hairline last:border-0">
                <td className="p-[8px_12px] font-mono text-[10.5px] text-text-faint">
                  {r.variant_id.slice(0, 8)}…
                </td>
                <td className="p-[8px_12px] text-right">
                  <MoneyText ngn={Number(r.cost_ngn)} className="text-[12px]" />
                </td>
                <td className="p-[8px_12px] text-right">
                  {r.current_price_ngn != null ? (
                    <MoneyText
                      ngn={Number(r.current_price_ngn)}
                      className="text-[12px] text-text-muted"
                    />
                  ) : (
                    <span className="text-text-faint">—</span>
                  )}
                </td>
                <td className="p-[8px_12px] text-right">
                  <MoneyText
                    ngn={Number(r.proposed_price_ngn)}
                    className="text-[12px] text-accent-glow"
                  />
                </td>
                <td
                  className={cn(
                    "p-[8px_12px] text-right font-mono",
                    metricColor(r.proposed_margin_pct),
                  )}
                >
                  {fmtPct(r.proposed_margin_pct)}
                </td>
                <td className="p-[8px_12px] text-center">
                  {r.floor_breached ? (
                    <span title={r.floor_breach_notes ?? "Floor breached"}>
                      <Pill tone="danger" dot={false}>
                        Breach
                      </Pill>
                    </span>
                  ) : (
                    <Pill tone="success" dot={false}>
                      OK
                    </Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Mini({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[11px] border border-line p-3">
      <div className="micro mb-1">{label}</div>
      <div className="font-mono text-[14px]">{children}</div>
    </div>
  );
}

// ── New scenario form ────────────────────────────────────────────────────────
function NewScenarioDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateScenario();
  const [name, setName] = useState("");
  const [goalType, setGoalType] = useState<GoalType>("target_margin");
  const [goalValue, setGoalValue] = useState("");
  const [channel, setChannel] = useState("storefront");
  const [scopeType, setScopeType] = useState<ScopeType>("all_active");
  const [units, setUnits] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setGoalType("target_margin");
    setGoalValue("");
    setChannel("storefront");
    setScopeType("all_active");
    setUnits("");
  }, [open]);

  const needsValue = goalType !== "sensitivity_only";
  const valueIsNgn =
    goalType === "target_price" || goalType === "target_revenue";

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        scenario_name: name.trim(),
        goal_type: goalType,
        goal_value:
          needsValue && goalValue.trim() !== "" ? Number(goalValue) : undefined,
        channel,
        scope_type: scopeType,
        assumed_monthly_units: units.trim() !== "" ? Number(units) : undefined,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New scenario"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={create.isPending || !name.trim()}
            onClick={submit}
          >
            {create.isPending ? "Creating…" : "Create scenario"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.isError && (
          <div className="flex items-start gap-2 text-[12.5px] text-danger bg-danger/10 border border-danger/25 rounded-xl p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            {create.error instanceof Error
              ? create.error.message
              : "Could not create scenario."}
          </div>
        )}
        <Field label="Scenario name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q3 margin reset"
          />
        </Field>
        <Field label="Goal type">
          <Select
            value={goalType}
            onChange={(v) => setGoalType(v)}
            options={GOAL_TYPE_OPTIONS}
          />
        </Field>
        {needsValue && (
          <Field label={valueIsNgn ? "Goal value (₦)" : "Goal value (%)"}>
            <NumberField
              value={goalValue}
              onChange={setGoalValue}
              suffix={valueIsNgn ? "₦" : "%"}
              placeholder="0"
            />
          </Field>
        )}
        <Field label="Channel">
          <Select
            value={channel}
            onChange={setChannel}
            options={CHANNEL_OPTIONS}
          />
        </Field>
        <Field label="Scope">
          <Select
            value={scopeType}
            onChange={(v) => setScopeType(v)}
            options={SCOPE_TYPE_OPTIONS}
          />
        </Field>
        <Field
          label="Assumed monthly units"
          hint="optional — for revenue projection"
        >
          <NumberField
            value={units}
            onChange={setUnits}
            allowDecimal={false}
            placeholder="0"
          />
        </Field>
      </div>
    </Drawer>
  );
}

function metricColor(pct: number | null | undefined): string {
  const tone = marginTone(pct);
  return tone === "danger"
    ? "text-danger"
    : tone === "warn"
      ? "text-warn"
      : tone === "success"
        ? "text-success"
        : "text-text-primary";
}
