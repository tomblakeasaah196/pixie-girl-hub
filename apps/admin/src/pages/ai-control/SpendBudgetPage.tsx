/**
 * Spend & Budget page (Q7).
 *
 * Two independent meters — internal AI (staff Praxis chat, training,
 * insight narration) and storefront AI (Shop AI Search, Shade Finder).
 * They have separate hard caps so a Praxis training spike CAN'T take
 * the storefront down again, and vice versa. Revenue-features-die-last
 * is enforced by leaving the storefront hard cap null (uncapped by
 * default — the CEO opts in to a ceiling).
 *
 * The page also shows the per-vendor + per-feature spend breakdown
 * (last 30 days by default) for the "which model is eating the
 * budget" question the model catalogue can then answer with a swap.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Gauge,
  ArrowLeft,
  Loader2,
  Edit3,
  AlertCircle,
  Check,
  ShieldAlert,
  Plus,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { toastReport } from "@/lib/error-report";
import { money, formatDate } from "@/lib/format";
import {
  aiGovernanceApi,
  type SpendMeter,
  type SpendMeterSide,
  type BudgetPeriod,
} from "@/lib/ai-governance-api";

export function SpendBudgetPage() {
  useBreadcrumbs([
    { label: "AI Control", href: "/ai-control" },
    { label: "Spend & Budget" },
  ]);
  const qc = useQueryClient();

  const meterQ = useQuery({
    queryKey: ["ai", "spend", "meter"],
    queryFn: () => aiGovernanceApi.spendMeter(),
    refetchInterval: 60_000,
  });
  const periodsQ = useQuery({
    queryKey: ["ai", "budget", "periods"],
    queryFn: () => aiGovernanceApi.listPeriods(),
  });

  const activePeriod = meterQ.data?.current_period ?? null;
  const [editingCaps, setEditingCaps] = useState(false);
  const [openingPeriod, setOpeningPeriod] = useState(false);

  // Aggregate the daily rollup for the past 30 days by feature and by vendor.
  // Stabilise `daily` via useMemo so the aggregations below don't re-run on
  // every render just because a `??` produced a fresh empty-array literal.
  const daily = useMemo(() => meterQ.data?.daily ?? [], [meterQ.data]);
  const byFeature = useMemo(() => aggregate(daily, "feature_key"), [daily]);
  const byVendor = useMemo(() => aggregate(daily, "vendor"), [daily]);
  const grandTotal = useMemo(
    () => daily.reduce((n, d) => n + Number(d.cost_ngn || 0), 0),
    [daily],
  );

  return (
    <div className="max-w-[1080px] mx-auto space-y-7">
      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Gauge className="w-5 h-5" />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-[22px] font-medium">
            Spend & Budget
          </h2>
          <p className="text-text-muted text-[13px]">
            Tiered caps — a Praxis training spike can never take the storefront
            down (or vice versa). Soft cap warns; hard cap blocks the feature
            side.
          </p>
        </div>
        <Link
          to="/ai-control"
          className="text-[12px] text-text-muted hover:text-text-primary inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> AI Control
        </Link>
      </header>

      {/* Active period */}
      {meterQ.isLoading ? (
        <Card className="p-6">
          <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
        </Card>
      ) : !activePeriod ? (
        <Card className="p-6 text-center">
          <p className="text-[13px] text-text-muted mb-3">
            No active budget period. Open one to start meter-tracking spend.
          </p>
          <button
            onClick={() => setOpeningPeriod(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow"
          >
            <Plus className="w-3.5 h-3.5" />
            Open a period
          </button>
        </Card>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PeriodMeter
            title="Internal AI"
            subtitle="Praxis chat, training, insight narration"
            side={activePeriod.internal}
            neverBlocksLabel={false}
          />
          <PeriodMeter
            title="Storefront AI"
            subtitle="Shop AI Search, Shade Finder"
            side={activePeriod.storefront}
            neverBlocksLabel={activePeriod.storefront.hard_cap_ngn == null}
          />
          <div className="md:col-span-2 flex items-center justify-between text-[12.5px] text-text-faint">
            <span>
              Period · {formatDate(activePeriod.period_start)} →{" "}
              {formatDate(activePeriod.period_end)}
            </span>
            <button
              onClick={() => setEditingCaps(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-panel-2 border hairline px-3 py-1.5 text-[12px] hover:border-accent/40"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Edit caps
            </button>
          </div>
        </section>
      )}

      {/* Spend by feature */}
      <section>
        <h3 className="font-display text-[16px] mb-2.5">
          Recent spend by feature
        </h3>
        <Card className="p-0 overflow-hidden">
          {daily.length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">
              No AI calls yet in this window.
            </p>
          ) : (
            <SpendTable
              rows={byFeature}
              grandTotal={grandTotal}
              labelHeader="Feature"
            />
          )}
        </Card>
      </section>

      {/* Spend by vendor */}
      <section>
        <h3 className="font-display text-[16px] mb-2.5">
          Recent spend by vendor
        </h3>
        <Card className="p-0 overflow-hidden">
          {daily.length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">
              No AI calls yet in this window.
            </p>
          ) : (
            <SpendTable
              rows={byVendor}
              grandTotal={grandTotal}
              labelHeader="Vendor"
            />
          )}
        </Card>
      </section>

      {/* Past periods */}
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-display text-[16px]">Past periods</h3>
          <button
            onClick={() => setOpeningPeriod(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-panel-2 border hairline px-3 py-1.5 text-[12px] hover:border-accent/40"
          >
            <Plus className="w-3.5 h-3.5" />
            Open new period
          </button>
        </div>
        <Card className="p-0 overflow-hidden">
          {periodsQ.isLoading ? (
            <div className="p-4">
              <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
            </div>
          ) : (periodsQ.data ?? []).length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">
              No budget periods yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[560px] w-full text-[12.5px]">
                <thead className="bg-panel-2 text-text-faint uppercase tracking-widest text-[10px]">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Period</th>
                    <th className="text-right px-3 py-2 font-semibold">
                      Internal (spend / hard cap)
                    </th>
                    <th className="text-right px-3 py-2 font-semibold">
                      Storefront (spend / hard cap)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(periodsQ.data ?? []).map((p) => (
                    <PeriodRow key={p.period_id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {editingCaps && activePeriod && (
        <CapsEditor
          period={activePeriod}
          onClose={() => setEditingCaps(false)}
          onSaved={() => {
            setEditingCaps(false);
            qc.invalidateQueries({ queryKey: ["ai", "spend", "meter"] });
            qc.invalidateQueries({ queryKey: ["ai", "budget", "periods"] });
          }}
        />
      )}
      {openingPeriod && (
        <OpenPeriodModal
          onClose={() => setOpeningPeriod(false)}
          onSaved={() => {
            setOpeningPeriod(false);
            qc.invalidateQueries({ queryKey: ["ai", "spend", "meter"] });
            qc.invalidateQueries({ queryKey: ["ai", "budget", "periods"] });
          }}
        />
      )}
    </div>
  );
}

// ── Meter card ─────────────────────────────────────────────

function PeriodMeter({
  title,
  subtitle,
  side,
  neverBlocksLabel,
}: {
  title: string;
  subtitle: string;
  side: SpendMeterSide;
  neverBlocksLabel: boolean;
}) {
  const spend = Number(side.actual_spend_ngn || 0);
  const soft = Number(side.soft_cap_ngn || 0);
  const hard = Number(side.hard_cap_ngn || 0);
  const cap = hard || soft || 0;
  const pct = cap > 0 ? Math.min(100, (spend / cap) * 100) : 0;
  const barColour =
    side.hard_cap_breached
      ? "bg-red-500"
      : side.soft_cap_breached
        ? "bg-amber-400"
        : "bg-green-400";
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-display text-[15px]">{title}</div>
          <p className="text-[11.5px] text-text-faint">{subtitle}</p>
        </div>
        {side.hard_cap_breached && (
          <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-widest text-red-300 border border-red-500/40 rounded-full px-2 py-[1px]">
            <ShieldAlert className="w-3 h-3" /> Hard cap breached
          </span>
        )}
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[22px] font-mono">
            {money(spend)}
          </span>
          <span className="text-[11.5px] text-text-faint">
            {neverBlocksLabel
              ? "uncapped · never blocks"
              : side.hard_cap_ngn != null
                ? `of ${money(hard)} hard cap`
                : "no cap set"}
          </span>
        </div>
        {cap > 0 && (
          <div className="mt-2 h-1.5 rounded-full bg-panel-2 overflow-hidden">
            <div
              className={`h-full ${barColour}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <div className="mt-2 flex items-center justify-between text-[11px] text-text-faint">
          <span>
            {side.actual_calls_count.toLocaleString()} call
            {side.actual_calls_count === 1 ? "" : "s"}
          </span>
          <span>
            Soft{" "}
            {side.soft_cap_ngn != null ? money(soft) : "—"}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ── Spend table (by feature or by vendor) ─────────────────

interface AggRow {
  key: string;
  calls: number;
  cost_ngn: number;
  failed: number;
}
function aggregate(
  rows: SpendMeter["daily"],
  keyName: "feature_key" | "vendor",
): AggRow[] {
  const map = new Map<string, AggRow>();
  for (const r of rows) {
    const key = String(r[keyName] || "?");
    const prev = map.get(key) ?? { key, calls: 0, cost_ngn: 0, failed: 0 };
    prev.calls += r.calls || 0;
    prev.cost_ngn += Number(r.cost_ngn || 0);
    prev.failed += r.failed || 0;
    map.set(key, prev);
  }
  return Array.from(map.values()).sort((a, b) => b.cost_ngn - a.cost_ngn);
}

function SpendTable({
  rows,
  grandTotal,
  labelHeader,
}: {
  rows: AggRow[];
  grandTotal: number;
  labelHeader: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[520px] w-full text-[12.5px]">
        <thead className="bg-panel-2 text-text-faint uppercase tracking-widest text-[10px]">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">{labelHeader}</th>
            <th className="text-right px-3 py-2 font-semibold">Calls</th>
            <th className="text-right px-3 py-2 font-semibold">Failures</th>
            <th className="text-right px-3 py-2 font-semibold">Spend</th>
            <th className="text-right px-3 py-2 font-semibold">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const share = grandTotal > 0 ? (r.cost_ngn / grandTotal) * 100 : 0;
            return (
              <tr key={r.key} className="border-t hairline">
                <td className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-accent-glow">
                  {r.key}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.calls.toLocaleString()}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono ${r.failed > 0 ? "text-red-300" : "text-text-faint"}`}
                >
                  {r.failed.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {money(r.cost_ngn)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-text-muted">
                  {share.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Past period row ────────────────────────────────────────

function PeriodRow({ p }: { p: BudgetPeriod }) {
  const internalSpend =
    Number(p.actual_spend_ngn || 0) -
    Number(p.storefront_actual_spend_ngn || 0);
  const storefrontSpend = Number(p.storefront_actual_spend_ngn || 0);
  return (
    <tr className="border-t hairline">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span>
            {formatDate(p.period_start)} → {formatDate(p.period_end)}
          </span>
          {p.is_active && (
            <span className="text-[10px] uppercase tracking-widest text-green-300 border border-green-500/30 rounded-full px-1.5 py-[1px]">
              active
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {money(internalSpend)} /{" "}
        <span className="text-text-faint">{money(Number(p.hard_cap_ngn))}</span>
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {money(storefrontSpend)} /{" "}
        <span className="text-text-faint">
          {p.storefront_hard_cap_ngn != null
            ? money(Number(p.storefront_hard_cap_ngn))
            : "uncapped"}
        </span>
      </td>
    </tr>
  );
}

// ── Edit caps modal ────────────────────────────────────────

function CapsEditor({
  period,
  onClose,
  onSaved,
}: {
  period: NonNullable<SpendMeter["current_period"]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [softIn, setSoftIn] = useState(String(period.internal.soft_cap_ngn ?? ""));
  const [hardIn, setHardIn] = useState(String(period.internal.hard_cap_ngn ?? ""));
  const [softSf, setSoftSf] = useState(
    period.storefront.soft_cap_ngn == null
      ? ""
      : String(period.storefront.soft_cap_ngn),
  );
  const [hardSf, setHardSf] = useState(
    period.storefront.hard_cap_ngn == null
      ? ""
      : String(period.storefront.hard_cap_ngn),
  );
  const [uncapStorefront, setUncap] = useState(
    period.storefront.hard_cap_ngn == null,
  );
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      const parseNum = (s: string) => {
        const n = Number(s);
        return Number.isFinite(n) && n >= 0 ? n : undefined;
      };
      await aiGovernanceApi.setBudgetCaps(period.period_id, {
        soft_cap_ngn: parseNum(softIn),
        hard_cap_ngn: parseNum(hardIn),
        // Distinguish undefined (leave alone) from null (explicitly uncap).
        storefront_soft_cap_ngn: uncapStorefront ? null : parseNum(softSf),
        storefront_hard_cap_ngn: uncapStorefront ? null : parseNum(hardSf),
      });
    },
    onSuccess: onSaved,
    onError: (e) => {
      toastReport("AI Control → Spend & Budget", "Save caps", e);
      setErr(e instanceof Error ? e.message : "Couldn’t save caps.");
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-accent-glow" />
          Edit caps
        </span>
      }
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {save.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Save caps
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Internal · soft cap ₦"
            value={softIn}
            onChange={setSoftIn}
          />
          <NumberField
            label="Internal · hard cap ₦"
            value={hardIn}
            onChange={setHardIn}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Storefront · soft cap ₦"
            value={softSf}
            onChange={setSoftSf}
            disabled={uncapStorefront}
          />
          <NumberField
            label="Storefront · hard cap ₦"
            value={hardSf}
            onChange={setHardSf}
            disabled={uncapStorefront}
          />
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <input
            type="checkbox"
            checked={uncapStorefront}
            onChange={(e) => setUncap(e.target.checked)}
            className="accent-accent"
          />
          Leave storefront uncapped ({" "}
          <span className="italic">revenue features die last</span> )
        </label>
        {err && (
          <div className="text-[12px] text-danger inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {err}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Open new period modal ──────────────────────────────────

function OpenPeriodModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthLater = (() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(monthLater);
  const [soft, setSoft] = useState("75000");
  const [hard, setHard] = useState("80000");
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      await aiGovernanceApi.openPeriod({
        period_start: start,
        period_end: end,
        soft_cap_ngn: Number(soft) || 0,
        hard_cap_ngn: Number(hard) || 0,
      });
    },
    onSuccess: onSaved,
    onError: (e) => {
      toastReport("AI Control → Spend & Budget", "Open period", e);
      setErr(e instanceof Error ? e.message : "Couldn’t open period.");
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-accent-glow" />
          Open budget period
        </span>
      }
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {save.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Open period
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[11.5px] text-text-muted mb-1">
            Period start
          </span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
          />
        </label>
        <label className="block">
          <span className="block text-[11.5px] text-text-muted mb-1">
            Period end
          </span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
          />
        </label>
        <NumberField
          label="Internal · soft cap ₦"
          value={soft}
          onChange={setSoft}
        />
        <NumberField
          label="Internal · hard cap ₦"
          value={hard}
          onChange={setHard}
        />
      </div>
      <p className="mt-3 text-[11.5px] text-text-faint">
        Storefront caps can be set independently after the period opens. Leave
        them uncapped to keep revenue features online no matter what internal
        AI spends.
      </p>
      {err && (
        <div className="mt-2 text-[12px] text-danger inline-flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          {err}
        </div>
      )}
    </Modal>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">{label}</span>
      <input
        type="number"
        min={0}
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-accent/40 disabled:opacity-50"
      />
    </label>
  );
}
