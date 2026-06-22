/**
 * Performance — appraisal cycles, weighted-KPI balance, and reviews.
 * Surfaces the existing appraisal backend (cycles → scores → reviews) with the
 * quarterly weighted KPIs (Customer Feedback 40 / Sales 25 / Quality 20 /
 * Cleanliness 15). Permission-gated on hr_payroll; CEO bypasses.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gauge, Plus, ScrollText, CheckCircle2 } from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { DeniedState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import {
  listPerfCycles,
  createPerfCycle,
  kpiWeightSummary,
  listPerfReviews,
  advancePerfReview,
  type PerfCycle,
} from "@/lib/hr-api";
import { TabBar, statusTone, useNotify, errMsg } from "./hr-shared";

const NEXT_STATUS: Record<string, string | undefined> = {
  draft: "submitted",
  submitted: "reviewed",
  reviewed: "approved",
  approved: "finalised",
};

function CreateCycleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const now = new Date();
  const [form, setForm] = useState({
    cycle_name: `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`,
    cycle_type: "quarterly",
    starts_on: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10),
    ends_on: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0).toISOString().slice(0, 10),
  });
  const mut = useMutation({
    mutationFn: () => createPerfCycle(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["perf"] }); notify("Cycle created"); onClose(); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  return (
    <Modal open={open} onClose={onClose} title="New appraisal cycle"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!form.cycle_name || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Creating…" : "Create cycle"}
          </Button>
        </>
      }>
      <div className="space-y-3">
        <input value={form.cycle_name} onChange={(e) => setForm({ ...form, cycle_name: e.target.value })}
          placeholder="Cycle name"
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        <select value={form.cycle_type} onChange={(e) => setForm({ ...form, cycle_type: e.target.value })}
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
          {["monthly", "quarterly", "semi_annual", "annual", "ad_hoc"].map((t) => (
            <option key={t} value={t}>{t.replace("_", " ")}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })}
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
          <input type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })}
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        </div>
      </div>
    </Modal>
  );
}

function CyclesTab({ onCreate }: { onCreate: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["perf", "cycles"], queryFn: listPerfCycles });
  const { data: kpi } = useQuery({ queryKey: ["perf", "kpi-weights"], queryFn: kpiWeightSummary });
  return (
    <div className="space-y-4">
      {kpi && (
        <Card className="flex items-center justify-between gap-3 p-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">KPI weighting</div>
            <div className="text-xs text-text-muted">Weights must total {kpi.target}%.</div>
          </div>
          <Pill tone={kpi.balanced ? "success" : "warn"}>{kpi.total}% {kpi.balanced ? "balanced" : "off-balance"}</Pill>
        </Card>
      )}
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>New cycle</Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-32 rounded-[var(--radius)]" />
      ) : !data?.length ? (
        <EmptyState icon={<Gauge className="h-6 w-6" />} title="No appraisal cycles yet"
          message="Create a quarterly cycle to score staff against the weighted KPIs." />
      ) : (
        <div className="space-y-2">
          {data.map((c: PerfCycle) => (
            <Card key={c.cycle_id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-primary">{c.cycle_name}</span>
                  <Pill tone={statusTone(c.status === "closed" ? "approved" : "pending")}>{c.status}</Pill>
                </div>
                <div className="text-xs text-text-muted">{c.starts_on} – {c.ends_on} · {c.cycle_type.replace("_", " ")}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewsTab() {
  const qc = useQueryClient();
  const notify = useNotify();
  const can = useAuthStore((s) => s.can);
  const { data, isLoading } = useQuery({ queryKey: ["perf", "reviews"], queryFn: () => listPerfReviews() });
  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => advancePerfReview(id, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["perf", "reviews"] }); notify("Review advanced"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius)]" />;
  if (!data?.length)
    return <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No reviews yet"
      message="Reviews are generated from scored cycles." />;
  return (
    <div className="space-y-2">
      {data.map((r) => {
        const next = NEXT_STATUS[r.status];
        return (
          <Card key={r.review_id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-primary">{r.staff_name || "Staff"}</span>
                <Pill tone={statusTone(r.status === "finalised" || r.status === "approved" ? "approved" : "pending")}>{r.status}</Pill>
                {r.acknowledged_by_employee && <Pill tone="success">acknowledged</Pill>}
              </div>
              <div className="text-xs text-text-muted">
                Score {Number(r.overall_weighted_score).toFixed(2)} · {r.overall_rating_band.replace("_", " ")}
              </div>
            </div>
            {next && can("hr_payroll", "approve") && (
              <Button size="sm" variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                disabled={advance.isPending} onClick={() => advance.mutate({ id: r.review_id, status: next })}>
                Mark {next}
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default function PerformancePage() {
  useBreadcrumbs([{ label: "Performance" }]);
  const can = useAuthStore((s) => s.can);
  const [tab, setTab] = useState("cycles");
  const [createOpen, setCreateOpen] = useState(false);

  if (!can("hr_payroll", "view")) {
    return <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8"><DeniedState message="You don't have access to Performance." /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8">
      <div>
        <h1 className="font-display text-2xl text-text-primary">Performance</h1>
        <p className="text-sm text-text-muted">Appraisal cycles, weighted KPIs and reviews.</p>
      </div>

      <TabBar active={tab} onChange={setTab}
        tabs={[{ key: "cycles", label: "Cycles" }, { key: "reviews", label: "Reviews" }]} />

      {tab === "cycles" && <CyclesTab onCreate={() => setCreateOpen(true)} />}
      {tab === "reviews" && <ReviewsTab />}

      <CreateCycleModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
