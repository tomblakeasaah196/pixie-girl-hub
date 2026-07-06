/**
 * Rewards tab (meeting §3 reward system) — HR configures behaviour-based
 * rewards (first at work, last to leave, always punctual, prompt data entry,
 * jobs, sales, quality), sees a live leaderboard, and approves the grants the
 * nightly evaluator produces. Monetary rewards flow through the bonus →
 * payroll pipeline; salary increases are applied here explicitly.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Award, Plus, Trophy, Trash2, Play, Check, X } from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { money } from "@/lib/format";
import {
  listRewardRules,
  createRewardRule,
  deleteRewardRule,
  evaluateRewards,
  rewardLeaderboard,
  listRewardGrants,
  applyRewardGrant,
  rejectRewardGrant,
  type RewardMetric,
  type RewardType,
} from "@/lib/hr-api";
import { SectionTitle, StatCard, useNotify, errMsg, statusTone } from "./hr-shared";

const METRICS: { value: RewardMetric; label: string; unit: string }[] = [
  { value: "first_in_days", label: "First at work (days)", unit: "days" },
  { value: "last_out_days", label: "Last to leave (days)", unit: "days" },
  { value: "punctual_days", label: "Punctual days", unit: "days" },
  { value: "data_entries", label: "Prompt data entry (records)", unit: "entries" },
  { value: "styles_completed", label: "Styles completed", unit: "jobs" },
  { value: "sales_count", label: "Sales count", unit: "sales" },
  { value: "quality_avg", label: "Avg quality rating", unit: "★" },
];
const metricLabel = (m: string) => METRICS.find((x) => x.value === m)?.label || m;

const REWARD_TYPES: { value: RewardType; label: string }[] = [
  { value: "fixed_ngn", label: "Fixed ₦ bonus" },
  { value: "pct_salary", label: "% of salary bonus" },
  { value: "salary_increase_pct", label: "Salary increase (%)" },
];

function RuleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify("HR → Rewards: rule");
  const [form, setForm] = useState({
    name: "First at work",
    metric: "first_in_days" as RewardMetric,
    comparator: "gte" as "gte" | "lte",
    threshold: 15,
    reward_type: "fixed_ngn" as RewardType,
    reward_value: 20000,
    description: "",
  });
  const mut = useMutation({
    mutationFn: () =>
      createRewardRule({
        name: form.name,
        metric: form.metric,
        comparator: form.comparator,
        threshold: Number(form.threshold),
        reward_type: form.reward_type,
        reward_value: Number(form.reward_value),
        description: form.description || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "rewards"] });
      notify("Reward rule created");
      onClose();
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  const input = "w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary";
  return (
    <Modal open={open} onClose={onClose} title="New reward rule"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!form.name.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Saving…" : "Create rule"}
          </Button>
        </>
      }>
      <div className="space-y-3">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Rule name" className={input} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
        <div className="grid grid-cols-2 gap-3">
          <select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value as RewardMetric })} className={input}>
            {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select value={form.comparator} onChange={(e) => setForm({ ...form, comparator: e.target.value as "gte" | "lte" })} className={input}>
            <option value="gte">at least (≥)</option>
            <option value="lte">at most (≤)</option>
          </select>
        </div>
        <label className="block text-xs text-text-muted">
          Threshold (per month)
          <input type="number" value={form.threshold}
            onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} className={`mt-1 ${input}`} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <select value={form.reward_type} onChange={(e) => setForm({ ...form, reward_type: e.target.value as RewardType })} className={input}>
            {REWARD_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input type="number" value={form.reward_value}
            onChange={(e) => setForm({ ...form, reward_value: Number(e.target.value) })}
            placeholder="Reward value" className={input} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
        </div>
        <p className="text-xs text-text-faint">
          {form.reward_type === "salary_increase_pct"
            ? "Salary increases are proposed as pending grants you apply explicitly (base salary + a contract amendment)."
            : "Monetary rewards create a pending-approval bonus that pays through the next payroll run."}
        </p>
      </div>
    </Modal>
  );
}

function Leaderboard() {
  const [metric, setMetric] = useState<RewardMetric>("first_in_days");
  const { data, isLoading } = useQuery({
    queryKey: ["hr", "rewards", "leaderboard", metric],
    queryFn: () => rewardLeaderboard(metric),
  });
  const unit = METRICS.find((m) => m.value === metric)?.unit || "";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle icon={<Trophy className="h-4 w-4 text-accent-glow" />}>Leaderboard (this month)</SectionTitle>
        <select value={metric} onChange={(e) => setMetric(e.target.value as RewardMetric)}
          className="rounded-lg border border-line bg-text-primary/[0.04] p-2 text-xs text-text-primary">
          {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      {isLoading ? (
        <Skeleton className="mt-3 h-32 rounded-[var(--radius)]" />
      ) : !data?.rows.length ? (
        <p className="mt-3 text-sm text-text-muted">No standings yet this month.</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {data.rows.map((r, i) => (
            <div key={r.profile_id} className="flex items-center gap-3 rounded-lg border border-line bg-text-primary/[0.02] px-3 py-2">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-display text-xs ${i === 0 ? "bg-accent/25 text-accent-glow" : "bg-text-primary/[0.06] text-text-muted"}`}>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{r.staff_name}</span>
              <span className="font-display text-sm text-text-primary">{r.value} <span className="text-xs text-text-faint">{unit}</span></span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function GrantsPanel() {
  const qc = useQueryClient();
  const notify = useNotify("HR → Rewards: grants");
  const { data, isLoading } = useQuery({
    queryKey: ["hr", "rewards", "grants"],
    queryFn: () => listRewardGrants(),
  });
  const apply = useMutation({
    mutationFn: (id: string) => applyRewardGrant(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr"] }); notify("Salary increase applied", "Base salary updated + amendment recorded."); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectRewardGrant(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr"] }); notify("Reward rejected"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius)]" />;
  if (!data?.length) return <EmptyState icon={<Award className="h-6 w-6" />} title="No rewards granted yet" message="Rewards appear here as employees cross your rule thresholds (checked nightly, or run “Evaluate now”)." />;
  return (
    <div className="space-y-2">
      {data.map((g) => (
        <Card key={g.reward_grant_id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-primary">{g.staff_name || "Staff"}</span>
              <Pill tone={statusTone(g.status === "applied" || g.status === "awarded" ? "approved" : g.status === "rejected" ? "rejected" : "pending")}>{g.status}</Pill>
            </div>
            <div className="text-xs text-text-muted">
              {g.rule_name || metricLabel(g.metric)} · {g.metric_value} · {g.period_month}/{g.period_year}
              {g.amount_ngn ? ` · ${money(Number(g.amount_ngn))} bonus` : ""}
              {g.proposed_salary_ngn ? ` · new salary ${money(Number(g.proposed_salary_ngn))}` : ""}
            </div>
          </div>
          {g.status === "pending" && g.reward_type === "salary_increase_pct" && (
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="primary" icon={<Check className="h-3.5 w-3.5" />}
                disabled={apply.isPending} onClick={() => apply.mutate(g.reward_grant_id)}>Apply</Button>
              <Button size="sm" icon={<X className="h-3.5 w-3.5" />}
                disabled={reject.isPending} onClick={() => reject.mutate(g.reward_grant_id)}>Reject</Button>
            </div>
          )}
          {g.status === "awarded" && (
            <span className="shrink-0 text-xs text-text-faint">pays via payroll</span>
          )}
        </Card>
      ))}
    </div>
  );
}

export function RewardsTab() {
  const qc = useQueryClient();
  const notify = useNotify("HR → Rewards");
  const [ruleOpen, setRuleOpen] = useState(false);
  const { data: rules, isLoading } = useQuery({
    queryKey: ["hr", "rewards", "rules"],
    queryFn: () => listRewardRules(),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteRewardRule(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr", "rewards"] }); notify("Rule removed"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  const evaluate = useMutation({
    mutationFn: () => evaluateRewards(),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["hr", "rewards"] }); notify("Rewards evaluated", `${r.granted} new grant(s)`); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatCard label="Active rules" value={rules?.filter((r) => r.is_active).length ?? 0} />
        <div className="flex gap-2">
          <Button icon={<Play className="h-4 w-4" />} disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>
            {evaluate.isPending ? "Evaluating…" : "Evaluate now"}
          </Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setRuleOpen(true)}>New rule</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle icon={<Award className="h-4 w-4 text-accent-glow" />}>Reward rules</SectionTitle>
          {isLoading ? (
            <Skeleton className="h-40 rounded-[var(--radius)]" />
          ) : !rules?.length ? (
            <EmptyState icon={<Award className="h-6 w-6" />} title="No reward rules yet"
              message="Create a rule like “first at work ≥ 15 days → ₦20,000”." />
          ) : (
            <div className="space-y-2">
              {rules.map((r) => (
                <Card key={r.reward_rule_id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary">{r.name}</span>
                      {!r.is_active && <Pill tone="neutral">inactive</Pill>}
                    </div>
                    <div className="text-xs text-text-muted">
                      {metricLabel(r.metric)} {r.comparator === "lte" ? "≤" : "≥"} {r.threshold} →{" "}
                      {r.reward_type === "fixed_ngn" ? money(Number(r.reward_value))
                        : r.reward_type === "pct_salary" ? `${r.reward_value}% bonus`
                        : `+${r.reward_value}% salary`}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />}
                    disabled={del.isPending} onClick={() => del.mutate(r.reward_rule_id)}>Delete</Button>
                </Card>
              ))}
            </div>
          )}
        </div>
        <Leaderboard />
      </div>

      <div>
        <SectionTitle icon={<Award className="h-4 w-4 text-accent-glow" />}>Granted rewards</SectionTitle>
        <GrantsPanel />
      </div>

      <RuleModal open={ruleOpen} onClose={() => setRuleOpen(false)} />
    </div>
  );
}
